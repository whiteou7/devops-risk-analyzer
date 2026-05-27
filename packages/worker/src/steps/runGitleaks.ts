import { execa } from 'execa';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { SecretFinding } from '@devops-risk-analyzer/shared';

interface GitleaksResult {
  count: number;
  findings: SecretFinding[];
}

interface GitleaksJsonFinding {
  RuleID?: string;
  Description?: string;
  File?: string;
  StartLine?: number;
  // Secret field is intentionally omitted — never stored
}

export async function runGitleaks(repoDir: string, jobId: string): Promise<GitleaksResult> {
  const TIMEOUT_MS = 2 * 60 * 1000;
  const reportPath = path.join(tmpdir(), `gitleaks-${jobId}.json`);
  console.log(`[gitleaks] starting scan — dir=${repoDir} report=${reportPath}`);

  try {
    await execa(
      'gitleaks',
      [
        'detect',
        '--source', repoDir,
        '--report-format', 'json',
        '--report-path', reportPath,
        '--no-git',
        '--exit-code', '0',
      ],
      { timeout: TIMEOUT_MS },
    );
  } catch (err: unknown) {
    const e = err as { timedOut?: boolean };
    if (e.timedOut) {
      console.error('[gitleaks] scan timed out');
      console.warn('[gitleaks] scan timed out');
    } else {
      console.error('[gitleaks] scan error:', (err as Error).message);
      console.warn('[gitleaks] scan error:', (err as Error).message);
    }
    return emptyResult();
  }

  try {
    const raw = await readFile(reportPath, 'utf8');
    await unlink(reportPath).catch(() => undefined);

    if (!raw.trim() || raw.trim() === 'null') {
      console.debug('[gitleaks] no secrets found');
      return emptyResult();
    }

    const parsed = JSON.parse(raw) as GitleaksJsonFinding[];
    if (!Array.isArray(parsed)) return emptyResult();

    const findings: SecretFinding[] = parsed.map(f => ({
      ruleId: f.RuleID ?? 'unknown',
      description: f.Description ?? 'Secret detected',
      file: f.File ?? '',
      line: f.StartLine ?? 0,
    }));

    const gitleaksResult = { count: findings.length, findings };
    console.debug(`[gitleaks] found ${findings.length} secret finding(s)`);
    console.debug('[gitleaks] full result:', JSON.stringify(gitleaksResult, null, 2));
    return gitleaksResult;
  } catch (err) {
    console.error('[gitleaks] failed to parse report:', (err as Error).message);
    console.warn('[gitleaks] failed to parse report:', (err as Error).message);
    return emptyResult();
  }
}

function emptyResult(): GitleaksResult {
  return { count: 0, findings: [] };
}
