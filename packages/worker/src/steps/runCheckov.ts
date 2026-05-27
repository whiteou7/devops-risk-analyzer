import { execa } from 'execa';
import type { CheckovFinding } from '@devops-risk-analyzer/shared';

interface CheckovResult {
  passed: number;
  failed: number;
  findings: CheckovFinding[];
}

interface CheckovJsonCheck {
  check_id?: string;
  check_name?: string;
  repo_file_path?: string;
  resource?: string;
  severity?: string;
}

interface CheckovJsonResults {
  passed_checks?: CheckovJsonCheck[];
  failed_checks?: CheckovJsonCheck[];
}

interface CheckovJsonOutput {
  results?: CheckovJsonResults;
  // Checkov may output an array when multiple frameworks are scanned
  [key: string]: unknown;
}

export async function runCheckov(repoDir: string): Promise<CheckovResult> {
  const TIMEOUT_MS = 3 * 60 * 1000;
  console.log(`[checkov] starting IaC scan — dir=${repoDir}`);

  let stdout = '';
  try {
    const result = await execa(
      'checkov',
      [
        '-d', repoDir,
        '--output', 'json',
        '--quiet',
        '--framework', 'dockerfile,docker_compose,kubernetes,terraform,github_actions',
        '--skip-download',
      ],
      {
        timeout: TIMEOUT_MS,
        reject: false, // checkov exits non-zero when findings exist
      },
    );
    stdout = result.stdout;
    console.debug('[checkov] scan process exited');
  } catch (err: unknown) {
    const e = err as { timedOut?: boolean };
    if (e.timedOut) {
      console.error('[checkov] scan timed out');
      console.warn('[checkov] scan timed out');
    } else {
      console.error('[checkov] scan failed:', (err as Error).message);
      console.warn('[checkov] scan failed:', (err as Error).message);
    }
    return emptyResult();
  }

  try {
    const result = parseCheckovOutput(stdout, repoDir);
    console.debug(`[checkov] results: passed=${result.passed} failed=${result.failed} findings=${result.findings.length}`);
    console.debug('[checkov] full result:', JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    console.error('[checkov] failed to parse output:', (err as Error).message);
    console.warn('[checkov] failed to parse output:', (err as Error).message);
    return emptyResult();
  }
}

function emptyResult(): CheckovResult {
  return { passed: 0, failed: 0, findings: [] };
}

function normaliseCheckovSeverity(s: string | undefined): CheckovFinding['severity'] {
  switch ((s ?? '').toUpperCase()) {
    case 'HIGH':
    case 'CRITICAL': return 'HIGH';
    case 'MEDIUM': return 'MEDIUM';
    default: return 'LOW';
  }
}

function parseCheckovOutput(stdout: string, repoDir: string): CheckovResult {
  if (!stdout.trim()) return emptyResult();

  // Checkov can output either a single object or an array of framework results
  const raw = JSON.parse(stdout) as CheckovJsonOutput | CheckovJsonOutput[];
  const outputs = Array.isArray(raw) ? raw : [raw];

  let passed = 0;
  let failed = 0;
  const findings: CheckovFinding[] = [];
  const seen = new Set<string>();

  for (const output of outputs) {
    const results = output.results ?? {};
    passed += (results.passed_checks ?? []).length;

    for (const check of results.failed_checks ?? []) {
      const key = `${check.check_id ?? ''}-${check.repo_file_path ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failed++;
      findings.push({
        checkId: check.check_id ?? 'UNKNOWN',
        checkName: check.check_name ?? '',
        file: check.repo_file_path?.replace(repoDir, '') ?? '',
        resource: check.resource ?? '',
        severity: normaliseCheckovSeverity(check.severity),
      });
    }
  }

  // Cap findings to avoid overwhelming the result with noisy checks
  const MAX_FINDINGS = 50;
  return { passed, failed, findings: findings.slice(0, MAX_FINDINGS) };
}
