import fs from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';
import type { GithubActionsFinding } from '@devops-risk-analyzer/shared';

export interface GithubActionsResult {
  workflowCount: number;
  findings: GithubActionsFinding[];
}

const MAX_FINDINGS = 50;
const MAX_RUNS_TO_FETCH = 10;
const MAX_JOBS_PER_RUN = 5;
const MAX_ERRORS_PER_JOB = 10;
const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function analyzeGithubActions(
  repoDir: string,
  repoUrl: string,
  githubToken?: string,
): Promise<GithubActionsResult> {
  console.log(`[github-actions] analyzing workflows — dir=${repoDir} repo=${repoUrl}`);

  const [staticFindings, jobFindings] = await Promise.all([
    analyzeWorkflowFiles(repoDir),
    analyzeJobLogs(repoUrl, githubToken),
  ]);

  console.debug(`[github-actions] static findings=${staticFindings.length} job-log findings=${jobFindings.length}`);

  const allFindings = [...staticFindings, ...jobFindings];
  const workflowCount = await countWorkflowFiles(repoDir);

  const githubActionsResult = { workflowCount, findings: allFindings.slice(0, MAX_FINDINGS) };
  console.debug(`[github-actions] workflow files=${workflowCount} total findings=${allFindings.length} (capped at ${MAX_FINDINGS})`);
  console.debug('[github-actions] full result:', JSON.stringify(githubActionsResult, null, 2));

  return githubActionsResult;
}

// ---------------------------------------------------------------------------
// Static workflow file analysis
// ---------------------------------------------------------------------------

async function countWorkflowFiles(repoDir: string): Promise<number> {
  try {
    const entries = await fs.readdir(path.join(repoDir, '.github', 'workflows'));
    return entries.filter(f => f.endsWith('.yml') || f.endsWith('.yaml')).length;
  } catch {
    return 0;
  }
}

async function analyzeWorkflowFiles(repoDir: string): Promise<GithubActionsFinding[]> {
  const workflowDir = path.join(repoDir, '.github', 'workflows');

  let files: string[];
  try {
    const entries = await fs.readdir(workflowDir);
    files = entries
      .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => path.join(workflowDir, f));
  } catch {
    return [];
  }

  const findings: GithubActionsFinding[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    findings.push(...detectStaticFindings(content, file.replace(repoDir, '')));
  }
  return findings;
}

function detectStaticFindings(content: string, file: string): GithubActionsFinding[] {
  const results: GithubActionsFinding[] = [];

  // pull_request_target — fork code runs with write access
  if (/pull_request_target\s*:/m.test(content)) {
    results.push({
      rule: 'pull-request-target',
      severity: 'CRITICAL',
      file,
      message: 'Workflow uses pull_request_target trigger — fork-sourced code may run with repository write permissions',
    });
  }

  // Script injection: ${{ github.event.* }} used directly in run: blocks
  const scriptInjectionRe = /\$\{\{\s*github\.event\.(pull_request|issue|comment|discussion)\.[a-z_.]+\s*\}\}/g;
  const runBlocks = [...content.matchAll(/run:\s*\|?([\s\S]*?)(?=\n\s{0,8}\w|\n\s{0,8}-\s|\z)/g)];
  for (const block of runBlocks) {
    if (scriptInjectionRe.test(block[0])) {
      results.push({
        rule: 'script-injection',
        severity: 'CRITICAL',
        file,
        message: 'Unsanitized ${{ github.event.* }} expression used in run: step — may allow shell injection via PR title/body',
      });
      scriptInjectionRe.lastIndex = 0;
      break;
    }
    scriptInjectionRe.lastIndex = 0;
  }

  // Self-hosted runners
  if (/runs-on:\s*self-hosted/m.test(content) || /runs-on:\s*\[.*self-hosted/m.test(content)) {
    results.push({
      rule: 'self-hosted-runner',
      severity: 'MEDIUM',
      file,
      message: 'Workflow uses self-hosted runners — compromised runner infrastructure could expose secrets or the repository',
    });
  }

  // Missing top-level permissions block
  if (!/^permissions\s*:/m.test(content)) {
    results.push({
      rule: 'missing-permissions',
      severity: 'HIGH',
      file,
      message: 'No top-level permissions: block found — workflow inherits implicit write access to all repository scopes',
    });
  }

  // Overly broad permissions
  if (/permissions\s*:\s*write-all/m.test(content)) {
    results.push({
      rule: 'write-all-permissions',
      severity: 'HIGH',
      file,
      message: 'permissions: write-all grants the workflow full write access to all repository resources',
    });
  }

  // Unpinned third-party actions
  const usesRe = /uses:\s*([^\s@]+)@([^\s#]+)/g;
  const unpinnedSeen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = usesRe.exec(content)) !== null) {
    const action = match[1];
    const ref = match[2];
    if (action.startsWith('docker://') || action.startsWith('./')) continue;
    if (/^[0-9a-f]{40}$/.test(ref)) continue;
    if (unpinnedSeen.has(action)) continue;
    unpinnedSeen.add(action);
    results.push({
      rule: 'unpinned-action',
      severity: 'HIGH',
      file,
      message: `Action ${action}@${ref} is not pinned to a full commit SHA — vulnerable to tag mutation or supply chain attacks`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// GitHub API — past job log analysis
// ---------------------------------------------------------------------------

interface GithubRun {
  id: number;
  name: string;
  conclusion: string | null;
  html_url: string;
}

interface GithubJob {
  id: number;
  name: string;
  conclusion: string | null;
}

function parseOwnerRepo(repoUrl: string): { owner: string; repo: string } | null {
  const m = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function githubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function analyzeJobLogs(repoUrl: string, token?: string): Promise<GithubActionsFinding[]> {
  const coords = parseOwnerRepo(repoUrl);
  if (!coords) return [];

  const { owner, repo } = coords;
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = githubHeaders(token);

  let runs: GithubRun[];
  try {
    const res = await axios.get<{ workflow_runs: GithubRun[] }>(
      `${base}/actions/runs`,
      { headers, params: { per_page: MAX_RUNS_TO_FETCH }, timeout: TIMEOUT_MS },
    );
    runs = res.data.workflow_runs;
  } catch (err) {
    console.warn('[github-actions] failed to fetch runs:', (err as Error).message);
    return [];
  }

  const failedRuns = runs.filter(r =>
    r.conclusion === 'failure' || r.conclusion === 'timed_out',
  );

  const findings: GithubActionsFinding[] = [];

  // Detect workflows that keep failing (repeated failures across fetched runs)
  const failCountByName = new Map<string, number>();
  for (const r of runs) {
    if (r.conclusion === 'failure' || r.conclusion === 'timed_out') {
      failCountByName.set(r.name, (failCountByName.get(r.name) ?? 0) + 1);
    }
  }
  for (const [name, count] of failCountByName) {
    if (count >= 3) {
      findings.push({
        rule: 'repeated-failure',
        severity: 'HIGH',
        file: `.github/workflows/${name}`,
        message: `Workflow "${name}" has failed ${count} times in the last ${MAX_RUNS_TO_FETCH} runs — indicates a persistent breakage`,
      });
    }
  }

  // Pull error lines from failed job logs
  const errorMessages = new Map<string, { count: number; workflowName: string; file: string }>();

  for (const run of failedRuns.slice(0, 5)) {
    let jobs: GithubJob[];
    try {
      const res = await axios.get<{ jobs: GithubJob[] }>(
        `${base}/actions/runs/${run.id}/jobs`,
        { headers, timeout: TIMEOUT_MS },
      );
      jobs = res.data.jobs;
    } catch {
      continue;
    }

    const failedJobs = jobs
      .filter(j => j.conclusion === 'failure')
      .slice(0, MAX_JOBS_PER_RUN);

    for (const job of failedJobs) {
      const errors = await fetchJobErrors(base, job.id, headers);
      for (const errMsg of errors) {
        const key = errMsg.slice(0, 120); // normalise near-duplicates
        const existing = errorMessages.get(key);
        if (existing) {
          existing.count++;
        } else {
          errorMessages.set(key, {
            count: 1,
            workflowName: run.name,
            file: `.github/workflows/${run.name}`,
          });
        }
      }
    }
  }

  for (const [msg, { count, workflowName, file }] of errorMessages) {
    const severity = count >= 3 ? 'HIGH' : 'MEDIUM';
    findings.push({
      rule: count >= 3 ? 'repeated-failure' : 'job-run-error',
      severity,
      file,
      message: count >= 3
        ? `Recurring error in "${workflowName}" (${count}× across recent runs): ${msg}`
        : `Error in "${workflowName}" job log: ${msg}`,
    });
  }

  return findings;
}

async function fetchJobErrors(
  repoBase: string,
  jobId: number,
  headers: Record<string, string>,
): Promise<string[]> {
  let logText: string;
  try {
    // GitHub redirects this to a signed URL; axios follows redirects automatically
    const res = await axios.get<string>(
      `${repoBase}/actions/jobs/${jobId}/logs`,
      { headers, timeout: TIMEOUT_MS, maxRedirects: 5 },
    );
    logText = typeof res.data === 'string' ? res.data : '';
  } catch {
    return [];
  }

  return extractErrors(logText);
}

// GitHub Actions log lines look like:
//   2024-01-01T00:00:00.0000000Z ##[error]Some message here
//   2024-01-01T00:00:00.0000000Z ##[error]Process completed with exit code 1.
const ERROR_LINE_RE = /##\[error\](.+)/g;
// Also catch bare "Error:" lines that GitHub doesn't annotate
const BARE_ERROR_RE = /^\d{4}-\d{2}-\d{2}T[\d:.Z]+\s+(?:Error|FATAL|error):\s+(.+)$/m;

function extractErrors(log: string): string[] {
  const errors: string[] = [];

  let m: RegExpExecArray | null;
  while ((m = ERROR_LINE_RE.exec(log)) !== null) {
    const msg = m[1].trim();
    // Skip the generic "exit code N" line — it adds noise without detail
    if (/^Process completed with exit code \d+/.test(msg)) continue;
    errors.push(msg);
    if (errors.length >= MAX_ERRORS_PER_JOB) break;
  }

  // Supplement with bare Error: lines when ##[error] annotations are missing
  if (errors.length === 0) {
    const bm = BARE_ERROR_RE.exec(log);
    if (bm) errors.push(bm[1].trim());
  }

  return errors;
}
