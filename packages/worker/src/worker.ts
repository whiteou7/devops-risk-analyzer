import os from 'node:os';
import path from 'node:path';
import { Worker } from 'bullmq';
import type { AnalyzeJobData, AnalysisResult, OpsAnalysis } from '@devops-risk-analyzer/shared';
import {
  sonarIssuesToRiskItems,
  trivyFindingsToRiskItems,
  secretFindingsToRiskItems,
  hadolintFindingsToRiskItems,
  checkovFindingsToRiskItems,
  gitHygieneToRiskItems,
  githubActionsToRiskItems,
  buildRiskMatrix,
} from '@devops-risk-analyzer/shared';
import { findAnalysis, saveAnalysis } from '@devops-risk-analyzer/db';
import { cloneRepo } from './steps/cloneRepo.js';
import { runSonarScanner } from './steps/runSonarScanner.js';
import { pollSonarTask } from './steps/pollSonarTask.js';
import { fetchResults } from './steps/fetchResults.js';
import { runTrivy } from './steps/runTrivy.js';
import { runGitleaks } from './steps/runGitleaks.js';
import { runHadolint } from './steps/runHadolint.js';
import { runCheckov } from './steps/runCheckov.js';
import { analyzeGitHygiene } from './steps/analyzeGitHygiene.js';
import { analyzeGithubActions } from './steps/analyzeGithubActions.js';
import { cleanup } from './cleanup.js';
import { redis } from './redis.js';

const concurrency = parseInt(process.env['WORKER_CONCURRENCY'] ?? '2', 10);
const gitCloneDepth = parseInt(process.env['GIT_CLONE_DEPTH'] ?? '50', 10);

export function createWorker(): Worker<AnalyzeJobData, AnalysisResult> {
  const worker = new Worker<AnalyzeJobData, AnalysisResult>(
    'analysis',
    async (job) => {
      const { repoUrl, projectKey, githubToken, commitSha: requestedSha, forceRefresh } = job.data;
      const repoDir = path.join(os.tmpdir(), `analysis-${job.id}`);
      const jobId = job.id ?? 'unknown';

      delete job.data.githubToken;

      await job.updateProgress(5);

      try {
        await job.log(`Cloning ${repoUrl}${requestedSha ? `@${requestedSha}` : ''} (depth=${gitCloneDepth})`);
        const resolvedSha = await cloneRepo(repoUrl, repoDir, githubToken, gitCloneDepth, requestedSha);
        await job.updateProgress(15);

        // Check DB cache for this exact repo+commit before running any analysis
        const cached = !forceRefresh ? await findAnalysis(repoUrl, resolvedSha) : null;
        if (cached) {
          await job.log(`Cache hit for ${repoUrl}@${resolvedSha} — returning stored result`);
          await cleanup(repoDir);
          return cached.result;
        }

        // Run all scanners in parallel — SonarQube pipeline is internally sequential
        await job.log('Running all scanners in parallel');

        const [
          sonarSettled,
          trivySettled,
          gitleaksSettled,
          hadolintSettled,
          checkovSettled,
          gitHygieneSettled,
          githubActionsSettled,
        ] = await Promise.allSettled([
          (async () => {
            const ceTaskId = await runSonarScanner(repoDir, projectKey);
            await job.updateProgress(35);
            await job.log(`Polling SonarQube CE task ${ceTaskId}`);
            await pollSonarTask(ceTaskId);
            await job.updateProgress(60);
            await job.log('Fetching SonarQube results');
            return fetchResults(projectKey, repoUrl);
          })(),
          process.env['SKIP_TRIVY'] !== 'true'
            ? runTrivy(repoDir)
            : Promise.resolve(null),
          process.env['SKIP_GITLEAKS'] !== 'true'
            ? runGitleaks(repoDir, jobId)
            : Promise.resolve(null),
          process.env['SKIP_HADOLINT'] !== 'true'
            ? runHadolint(repoDir)
            : Promise.resolve(null),
          process.env['SKIP_CHECKOV'] !== 'true'
            ? runCheckov(repoDir)
            : Promise.resolve(null),
          analyzeGitHygiene(repoDir),
          process.env['SKIP_GITHUB_ACTIONS'] !== 'true'
            ? analyzeGithubActions(repoDir, repoUrl, githubToken)
            : Promise.resolve(null),
        ]);

        await job.updateProgress(85);

        if (sonarSettled.status === 'rejected') throw sonarSettled.reason;
        const sonarResult = sonarSettled.value;

        function settled<T>(result: PromiseSettledResult<T>, label: string): T | null {
          if (result.status === 'rejected') {
            console.warn(`[${label}] error:`, result.reason?.message ?? result.reason);
            return null;
          }
          return result.value;
        }

        const trivyResult      = settled(trivySettled,        'trivy');
        const gitleaksResult   = settled(gitleaksSettled,     'gitleaks');
        const hadolintResult   = settled(hadolintSettled,     'hadolint');
        const checkovResult    = settled(checkovSettled,      'checkov');
        const gitHygieneResult = settled(gitHygieneSettled,   'git-hygiene');
        const githubActionsResult = settled(githubActionsSettled, 'github-actions');

        // Build OpsAnalysis (raw tool outputs)
        const opsAnalysis: OpsAnalysis = {
          trivy: trivyResult ?? { critical: 0, high: 0, medium: 0, low: 0, findings: [] },
          secrets: gitleaksResult ?? { count: 0, findings: [] },
          hadolint: hadolintResult ?? { errors: 0, warnings: 0, findings: [] },
          checkov: checkovResult ?? { passed: 0, failed: 0, findings: [] },
          gitHygiene: gitHygieneResult ?? {
            uniqueAuthors: 1,
            recentCommitCount: 0,
            hasGitignore: true,
            topContributorCommitShare: 1,
          },
          githubActions: githubActionsResult ?? { workflowCount: 0, findings: [] },
        };

        // Map all findings to RiskItems and build the risk matrix
        const allItems = [
          ...sonarIssuesToRiskItems(sonarResult.issues),
          ...trivyFindingsToRiskItems(opsAnalysis.trivy.findings),
          ...secretFindingsToRiskItems(opsAnalysis.secrets.findings),
          ...hadolintFindingsToRiskItems(opsAnalysis.hadolint.findings),
          ...checkovFindingsToRiskItems(opsAnalysis.checkov.findings),
          ...gitHygieneToRiskItems(opsAnalysis.gitHygiene),
          ...githubActionsToRiskItems(opsAnalysis.githubActions.findings),
        ];

        const riskMatrix = buildRiskMatrix(allItems);

        await job.updateProgress(95);

        const result: AnalysisResult = { ...sonarResult, commitSha: resolvedSha, opsAnalysis, riskMatrix };

        // Persist to DB so future requests for the same repo+commit are served from cache
        await saveAnalysis(repoUrl, resolvedSha, projectKey, result);

        await job.updateProgress(100);

        return result;
      } finally {
        await cleanup(repoDir);
      }
    },
    {
      connection: redis,
      concurrency,
      stalledInterval: 60_000,
      maxStalledCount: 1,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[worker] job ${job.id} completed — ${job.data.projectKey}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[worker] job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[worker] error:', err);
  });

  return worker;
}
