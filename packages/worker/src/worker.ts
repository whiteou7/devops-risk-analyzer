import os from 'node:os';
import path from 'node:path';
import { Worker } from 'bullmq';
import type { AnalyzeJobData, AnalysisResult } from '@devops-risk-analyzer/shared';
import { cloneRepo } from './steps/cloneRepo.js';
import { runSonarScanner } from './steps/runSonarScanner.js';
import { pollSonarTask } from './steps/pollSonarTask.js';
import { fetchResults } from './steps/fetchResults.js';
import { cleanup } from './cleanup.js';
import { redis } from './redis.js';

const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? '2', 10);

export function createWorker(): Worker<AnalyzeJobData, AnalysisResult> {
  const worker = new Worker<AnalyzeJobData, AnalysisResult>(
    'analysis',
    async (job) => {
      const { repoUrl, projectKey, githubToken } = job.data;
      const repoDir = path.join(os.tmpdir(), `sonar-${job.id}`);

      // Clear sensitive token from job data in memory after reading
      delete job.data.githubToken;

      await job.updateProgress(5);

      try {
        await job.log(`Cloning ${repoUrl}`);
        await cloneRepo(repoUrl, repoDir, githubToken);
        await job.updateProgress(25);

        await job.log(`Running sonar-scanner for project ${projectKey}`);
        const ceTaskId = await runSonarScanner(repoDir, projectKey);
        await job.updateProgress(50);

        await job.log(`Polling CE task ${ceTaskId}`);
        await pollSonarTask(ceTaskId);
        await job.updateProgress(80);

        await job.log('Fetching results from SonarQube');
        const result = await fetchResults(projectKey, repoUrl);
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
