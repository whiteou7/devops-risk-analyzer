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
import { cleanup } from './cleanup.js';
import { redis } from './redis.js';

const concurrency = parseInt(process.env['WORKER_CONCURRENCY'] ?? '2', 10);
const gitCloneDepth = parseInt(process.env['GIT_CLONE_DEPTH'] ?? '50', 10);

export function createWorker(): Worker<AnalyzeJobData, AnalysisResult> {
  const worker = new Worker<AnalyzeJobData, AnalysisResult>(
    'analysis',
    async (job) => {
      const { repoUrl, projectKey, githubToken, commitSha: requestedSha } = job.data;
      const repoDir = path.join(os.tmpdir(), `analysis-${job.id}`);
      const jobId = job.id ?? 'unknown';

      delete job.data.githubToken;

      await job.updateProgress(5);

      try {
        await job.log(`Cloning ${repoUrl}${requestedSha ? `@${requestedSha}` : ''} (depth=${gitCloneDepth})`);
        const resolvedSha = await cloneRepo(repoUrl, repoDir, githubToken, gitCloneDepth, requestedSha);
        await job.updateProgress(15);

        // Check DB cache for this exact repo+commit before running any analysis
        const cached = await findAnalysis(repoUrl, resolvedSha);
        if (cached) {
          await job.log(`Cache hit for ${repoUrl}@${resolvedSha} — returning stored result`);
          await cleanup(repoDir);
          return cached.result;
        }

        // Run SonarQube pipeline and all ops tools in parallel
        await job.log('Running dev analysis (SonarQube) and ops analysis in parallel');

        const [sonarResult, opsResults] = await Promise.all([
          // Dev pipeline: scanner → poll → fetch
          (async () => {
            const ceTaskId = await runSonarScanner(repoDir, projectKey);
            await job.updateProgress(35);
            await job.log(`Polling SonarQube CE task ${ceTaskId}`);
            await pollSonarTask(ceTaskId);
            await job.updateProgress(60);
            await job.log('Fetching SonarQube results');
            return fetchResults(projectKey, repoUrl);
          })(),

          // Ops pipeline: all tools in parallel
          Promise.all([
            process.env['SKIP_TRIVY'] !== 'true'
              ? runTrivy(repoDir).catch(e => { console.warn('[trivy] error:', e.message); return null; })
              : Promise.resolve(null),
            process.env['SKIP_GITLEAKS'] !== 'true'
              ? runGitleaks(repoDir, jobId).catch(e => { console.warn('[gitleaks] error:', e.message); return null; })
              : Promise.resolve(null),
            process.env['SKIP_HADOLINT'] !== 'true'
              ? runHadolint(repoDir).catch(e => { console.warn('[hadolint] error:', e.message); return null; })
              : Promise.resolve(null),
            process.env['SKIP_CHECKOV'] !== 'true'
              ? runCheckov(repoDir).catch(e => { console.warn('[checkov] error:', e.message); return null; })
              : Promise.resolve(null),
            analyzeGitHygiene(repoDir).catch(e => { console.warn('[git-hygiene] error:', e.message); return null; }),
          ]),
        ]);

        await job.updateProgress(85);

        const [trivyResult, gitleaksResult, hadolintResult, checkovResult, gitHygieneResult] = opsResults;

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
        };

        // Map all findings to RiskItems and build the risk matrix
        const devItems = sonarIssuesToRiskItems(sonarResult.issues);
        const opsItems = [
          ...trivyFindingsToRiskItems(opsAnalysis.trivy.findings),
          ...secretFindingsToRiskItems(opsAnalysis.secrets.findings),
          ...hadolintFindingsToRiskItems(opsAnalysis.hadolint.findings),
          ...checkovFindingsToRiskItems(opsAnalysis.checkov.findings),
          ...gitHygieneToRiskItems(opsAnalysis.gitHygiene),
        ];

        const riskMatrix = buildRiskMatrix(devItems, opsItems);

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
