import os from 'node:os';
import path from 'node:path';
import { Worker } from 'bullmq';
import type {
  TimelineJobData,
  TimelineResult,
  CommitRiskPoint,
  OpsAnalysis,
  AnalysisResult,
  SonarMetrics,
} from '@devops-risk-analyzer/shared';
import {
  trivyFindingsToRiskItems,
  secretFindingsToRiskItems,
  hadolintFindingsToRiskItems,
  checkovFindingsToRiskItems,
  gitHygieneToRiskItems,
  githubActionsToRiskItems,
  buildRiskMatrix,
} from '@devops-risk-analyzer/shared';
import { findAnalysis, saveAnalysis } from '@devops-risk-analyzer/db';
import { execa } from 'execa';
import { cloneRepo } from './steps/cloneRepo.js';
import { runTrivy } from './steps/runTrivy.js';
import { runGitleaks } from './steps/runGitleaks.js';
import { runHadolint } from './steps/runHadolint.js';
import { runCheckov } from './steps/runCheckov.js';
import { analyzeGitHygiene } from './steps/analyzeGitHygiene.js';
import { analyzeGithubActions } from './steps/analyzeGithubActions.js';
import { fetchEpssScores } from './steps/fetchEpssScores.js';
import { cleanup } from './cleanup.js';
import { redis } from './redis.js';

const MAX_COMMITS = 30;
const concurrency = parseInt(process.env['WORKER_CONCURRENCY'] ?? '2', 10);

function deriveProjectKey(repoUrl: string): string {
  return repoUrl
    .replace('https://github.com/', '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '_')
    .slice(0, 200);
}

function parseGithubRepo(repoUrl: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(repoUrl);
    const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

interface GithubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
}

async function fetchCommitsFromGithub(
  owner: string,
  repo: string,
  since: string,
  githubToken?: string,
): Promise<GithubCommit[]> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

  const url = `https://api.github.com/repos/${owner}/${repo}/commits?since=${since}&per_page=100`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status} fetching commits for ${owner}/${repo}`);
  }
  return res.json() as Promise<GithubCommit[]>;
}

function emptyOpsAnalysis(): OpsAnalysis {
  return {
    trivy: { critical: 0, high: 0, medium: 0, low: 0, findings: [] },
    secrets: { count: 0, findings: [] },
    hadolint: { errors: 0, warnings: 0, findings: [] },
    checkov: { passed: 0, failed: 0, findings: [] },
    gitHygiene: { uniqueAuthors: 1, recentCommitCount: 0, hasGitignore: true, topContributorCommitShare: 1 },
    githubActions: { workflowCount: 0, findings: [] },
  };
}

function emptyMetrics(): SonarMetrics {
  return { bugs: 0, vulnerabilities: 0, codeSmells: 0, qualityGate: 'OK' };
}

export function createTimelineWorker(): Worker<TimelineJobData, TimelineResult> {
  const worker = new Worker<TimelineJobData, TimelineResult>(
    'timeline',
    async (job) => {
      const { repoUrl, githubToken, forceRefresh } = job.data;
      const jobId = job.id ?? 'unknown';
      const repoDir = path.join(os.tmpdir(), `timeline-${jobId}`);

      console.log(`[timeline] job ${jobId} started — repo=${repoUrl}`);
      await job.updateProgress({ value: 2, stage: 'Fetching commit history' });

      try {
        const parsed = parseGithubRepo(repoUrl);
        if (!parsed) throw new Error(`Invalid GitHub URL: ${repoUrl}`);
        const { owner, repo } = parsed;
        const projectKey = deriveProjectKey(repoUrl);

        // Fetch commits from the past 30 days
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const allCommits = await fetchCommitsFromGithub(owner, repo, since, githubToken);

        // Sort oldest → newest, cap at MAX_COMMITS
        const commits = allCommits
          .slice()
          .sort((a, b) => new Date(a.commit.author.date).getTime() - new Date(b.commit.author.date).getTime())
          .slice(-MAX_COMMITS);

        if (commits.length === 0) {
          console.log(`[timeline] job ${jobId} — no commits found in past 30 days`);
          return {
            repoUrl,
            points: [],
            analyzedAt: new Date().toISOString(),
          };
        }

        await job.log(`Found ${commits.length} commits in the past 30 days`);
        await job.updateProgress({ value: 5, stage: `Found ${commits.length} commits` });

        // Check how many need analysis (vs cached)
        const cacheStatuses = await Promise.all(
          commits.map(c => findAnalysis(repoUrl, c.sha).then(r => !!r).catch(() => false)),
        );
        const uncachedCount = cacheStatuses.filter(v => !v).length;

        // Clone once if there are uncached commits
        let cloned = false;
        if (uncachedCount > 0) {
          await job.log(`Cloning ${repoUrl} (${uncachedCount} commits need analysis)`);
          await cloneRepo(repoUrl, repoDir, githubToken, Math.min(commits.length + 10, 100));
          cloned = true;
          await job.updateProgress({ value: 10, stage: 'Repository cloned' });
        }

        const points: CommitRiskPoint[] = [];
        const progressPerCommit = 85 / commits.length;

        for (let i = 0; i < commits.length; i++) {
          const c = commits[i];
          const shortSha = c.sha.slice(0, 7);
          const message = c.commit.message.split('\n')[0].slice(0, 72);
          const author = c.commit.author.name;
          const date = c.commit.author.date;

          const progressValue = Math.round(10 + progressPerCommit * (i + 1));
          await job.updateProgress({ value: progressValue, stage: `Analyzing commit ${i + 1}/${commits.length}: ${shortSha}` });

          // Cache check
          if (!forceRefresh) {
            const cached = await findAnalysis(repoUrl, c.sha).catch(() => null);
            if (cached?.result.riskMatrix) {
              points.push({
                sha: c.sha,
                shortSha,
                message,
                author,
                date,
                riskMatrix: cached.result.riskMatrix,
              });
              await job.log(`Commit ${shortSha}: cache hit`);
              continue;
            }
          }

          if (!cloned) {
            await job.log(`Cloning ${repoUrl} for uncached commit ${shortSha}`);
            await cloneRepo(repoUrl, repoDir, githubToken, Math.min(commits.length + 10, 100));
            cloned = true;
          }

          // Checkout the specific commit
          await execa('git', ['-C', repoDir, 'checkout', c.sha, '--force']).catch(() => {
            // If shallow, try fetching the commit first
            return execa('git', ['-C', repoDir, 'fetch', '--depth', '1', 'origin', c.sha])
              .then(() => execa('git', ['-C', repoDir, 'checkout', c.sha, '--force']));
          });

          // Run fast scanners (no SonarQube) in parallel
          const [
            trivySettled,
            gitleaksSettled,
            hadolintSettled,
            checkovSettled,
            gitHygieneSettled,
            githubActionsSettled,
          ] = await Promise.allSettled([
            process.env['SKIP_TRIVY'] !== 'true' ? runTrivy(repoDir) : Promise.resolve(null),
            process.env['SKIP_GITLEAKS'] !== 'true' ? runGitleaks(repoDir, `${jobId}-${i}`) : Promise.resolve(null),
            process.env['SKIP_HADOLINT'] !== 'true' ? runHadolint(repoDir) : Promise.resolve(null),
            process.env['SKIP_CHECKOV'] !== 'true' ? runCheckov(repoDir) : Promise.resolve(null),
            analyzeGitHygiene(repoDir),
            process.env['SKIP_GITHUB_ACTIONS'] !== 'true'
              ? analyzeGithubActions(repoDir, repoUrl, githubToken)
              : Promise.resolve(null),
          ]);

          function settled<T>(result: PromiseSettledResult<T>, label: string): T | null {
            if (result.status === 'rejected') {
              console.warn(`[timeline:${label}] ${shortSha}:`, result.reason?.message ?? result.reason);
              return null;
            }
            return result.value;
          }

          let trivyResult        = settled(trivySettled,        'trivy');
          const gitleaksResult   = settled(gitleaksSettled,     'gitleaks');
          const hadolintResult   = settled(hadolintSettled,     'hadolint');
          const checkovResult    = settled(checkovSettled,      'checkov');
          const gitHygieneResult = settled(gitHygieneSettled,   'git-hygiene');
          const githubActionsResult = settled(githubActionsSettled, 'github-actions');

          // Enrich Trivy with EPSS scores
          if (trivyResult && trivyResult.findings.length > 0) {
            const cveIds = trivyResult.findings.map(f => f.cveId).filter((id): id is string => !!id);
            const epssMap = await fetchEpssScores(cveIds);
            trivyResult = {
              ...trivyResult,
              findings: trivyResult.findings.map(f => ({
                ...f,
                epssScore: f.cveId ? epssMap.get(f.cveId.toUpperCase()) : undefined,
              })),
            };
          }

          const opsAnalysis: OpsAnalysis = {
            trivy: trivyResult ?? emptyOpsAnalysis().trivy,
            secrets: gitleaksResult ?? { count: 0, findings: [] },
            hadolint: hadolintResult ?? { errors: 0, warnings: 0, findings: [] },
            checkov: checkovResult ?? { passed: 0, failed: 0, findings: [] },
            gitHygiene: gitHygieneResult ?? emptyOpsAnalysis().gitHygiene,
            githubActions: githubActionsResult ?? { workflowCount: 0, findings: [] },
          };

          const allItems = [
            ...trivyFindingsToRiskItems(opsAnalysis.trivy.findings),
            ...secretFindingsToRiskItems(opsAnalysis.secrets.findings),
            ...hadolintFindingsToRiskItems(opsAnalysis.hadolint.findings),
            ...checkovFindingsToRiskItems(opsAnalysis.checkov.findings),
            ...gitHygieneToRiskItems(opsAnalysis.gitHygiene),
            ...githubActionsToRiskItems(opsAnalysis.githubActions.findings),
          ];

          const riskMatrix = buildRiskMatrix(allItems);

          // Persist to DB so future requests for this commit are served from cache
          const minimalResult: AnalysisResult = {
            projectKey,
            repoUrl,
            commitSha: c.sha,
            analyzedAt: new Date().toISOString(),
            metrics: emptyMetrics(),
            issues: [],
            sonarDashboardUrl: '',
            opsAnalysis,
            riskMatrix,
          };
          await saveAnalysis(repoUrl, c.sha, projectKey, minimalResult).catch(err => {
            console.warn(`[timeline] failed to save analysis for ${shortSha}:`, err.message);
          });

          points.push({ sha: c.sha, shortSha, message, author, date, riskMatrix });
          await job.log(`Commit ${shortSha}: analysis complete`);
        }

        await job.updateProgress({ value: 100, stage: 'Done' });

        return {
          repoUrl,
          points,
          analyzedAt: new Date().toISOString(),
        };
      } finally {
        if (await import('node:fs/promises').then(fs => fs.access(repoDir).then(() => true).catch(() => false))) {
          await cleanup(repoDir);
        }
      }
    },
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: redis as any,
      concurrency,
      stalledInterval: 120_000,
      maxStalledCount: 1,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[timeline] job ${job.id} completed — ${job.data.repoUrl}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[timeline] job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[timeline] error:', err);
  });

  return worker;
}
