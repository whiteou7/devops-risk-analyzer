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
import { findAnalysis, saveAnalysis, findDocContent } from '@devops-risk-analyzer/db';
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
import { fetchEpssScores } from './steps/fetchEpssScores.js';
import { analyzeDocumentationWithAI } from './steps/analyzeDocumentationWithAI.js';
import { cleanup } from './cleanup.js';
import { redis } from './redis.js';

const concurrency = parseInt(process.env['WORKER_CONCURRENCY'] ?? '2', 10);
const gitCloneDepth = parseInt(process.env['GIT_CLONE_DEPTH'] ?? '50', 10);

export function createWorker(): Worker<AnalyzeJobData, AnalysisResult> {
  const worker = new Worker<AnalyzeJobData, AnalysisResult>(
    'analysis',
    async (job) => {
      const { repoUrl, projectKey, githubToken, commitSha: requestedSha, forceRefresh, docHash } = job.data;
      const repoDir = path.join(os.tmpdir(), `analysis-${job.id}`);
      const jobId = job.id ?? 'unknown';

      delete job.data.githubToken;

      console.log(`[worker] job ${jobId} started — repo=${repoUrl} project=${projectKey}${requestedSha ? ` sha=${requestedSha}` : ''} forceRefresh=${forceRefresh ?? false}`);
      await job.updateProgress(5);

      try {
        await job.log(`Cloning ${repoUrl}${requestedSha ? `@${requestedSha}` : ''} (depth=${gitCloneDepth})`);
        const resolvedSha = await cloneRepo(repoUrl, repoDir, githubToken, gitCloneDepth, requestedSha);
        await job.updateProgress(15);

        // Check DB cache for this exact repo+commit before running any analysis
        const cached = !forceRefresh ? await findAnalysis(repoUrl, resolvedSha, docHash ?? '') : null;
        if (cached) {
          console.log(`[worker] job ${jobId} cache hit for ${repoUrl}@${resolvedSha} — skipping analysis`);
          await job.log(`Cache hit for ${repoUrl}@${resolvedSha} — returning stored result`);
          await cleanup(repoDir);
          return cached.result;
        }
        console.debug(`[worker] job ${jobId} no cache entry found — running full analysis`);

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
        console.debug(`[worker] job ${jobId} all scanners settled — sonar=${sonarSettled.status} trivy=${trivySettled.status} gitleaks=${gitleaksSettled.status} hadolint=${hadolintSettled.status} checkov=${checkovSettled.status} git-hygiene=${gitHygieneSettled.status} github-actions=${githubActionsSettled.status}`);

        if (sonarSettled.status === 'rejected') throw sonarSettled.reason;
        const sonarResult = sonarSettled.value;

        function settled<T>(result: PromiseSettledResult<T>, label: string): T | null {
          if (result.status === 'rejected') {
            console.warn(`[${label}] error:`, result.reason?.message ?? result.reason);
            return null;
          }
          return result.value;
        }

        let trivyResult        = settled(trivySettled,        'trivy');
        const gitleaksResult   = settled(gitleaksSettled,     'gitleaks');
        const hadolintResult   = settled(hadolintSettled,     'hadolint');
        const checkovResult    = settled(checkovSettled,      'checkov');
        const gitHygieneResult = settled(gitHygieneSettled,   'git-hygiene');

        // Enrich Trivy findings with EPSS exploitation-probability scores
        if (trivyResult && trivyResult.findings.length > 0) {
          await job.log('Fetching EPSS scores for CVEs');
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

        // Analyze documentation artifact via AI if uploaded docs were provided
        let docItems: import('@devops-risk-analyzer/shared').RiskItem[] = [];
        if (docHash) {
          await job.log('Loading uploaded documentation for AI analysis');
          try {
            const doc = await findDocContent(docHash);
            if (!doc) throw new Error(`Doc content not found for hash ${docHash}`);
            await job.log(`Analyzing documentation (${doc.fileNames.length} file(s), ${doc.content.length} chars)`);
            docItems = await analyzeDocumentationWithAI(doc.content, doc.fileNames.join(', '));
            await job.log(`Documentation analysis complete — ${docItems.length} finding(s)`);
          } catch (err) {
            console.warn('[worker] documentation analysis failed:', (err as Error).message);
          }
        }

        // Map all findings to RiskItems and build the risk matrix
        const allItems = [
          ...sonarIssuesToRiskItems(sonarResult.issues),
          ...trivyFindingsToRiskItems(opsAnalysis.trivy.findings),
          ...secretFindingsToRiskItems(opsAnalysis.secrets.findings),
          ...hadolintFindingsToRiskItems(opsAnalysis.hadolint.findings),
          ...checkovFindingsToRiskItems(opsAnalysis.checkov.findings),
          ...gitHygieneToRiskItems(opsAnalysis.gitHygiene),
          ...githubActionsToRiskItems(opsAnalysis.githubActions.findings),
          ...docItems,
        ];

        const riskMatrix = buildRiskMatrix(allItems);
        console.debug(`[worker] job ${jobId} risk matrix built — total risk items=${allItems.length}`);

        await job.updateProgress(95);

        const result: AnalysisResult = { ...sonarResult, commitSha: resolvedSha, opsAnalysis, riskMatrix };
        console.log(`[worker] job ${jobId} analysis complete — sha=${resolvedSha} qualityGate=${sonarResult.metrics.qualityGate}`);
        
        // Persist to DB so future requests for the same repo+commit are served from cache
        await saveAnalysis(repoUrl, resolvedSha, projectKey, result, docHash ?? '');
        console.debug(`[worker] job ${jobId} result persisted to DB`);

        await job.updateProgress(100);

        return result;
      } finally {
        await cleanup(repoDir);
      }
    },
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connection: redis as any,
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
