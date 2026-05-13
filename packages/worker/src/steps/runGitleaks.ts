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
      console.warn('[gitleaks] scan timed out');
    } else {
      console.warn('[gitleaks] scan error:', (err as Error).message);
    }
    return emptyResult();
  }

  try {
    const raw = await readFile(reportPath, 'utf8');
    await unlink(reportPath).catch(() => undefined);

    if (!raw.trim() || raw.trim() === 'null') return emptyResult();

    const parsed = JSON.parse(raw) as GitleaksJsonFinding[];
    if (!Array.isArray(parsed)) return emptyResult();

    const findings: SecretFinding[] = parsed.map(f => ({
      ruleId: f.RuleID ?? 'unknown',
      description: f.Description ?? 'Secret detected',
      file: f.File ?? '',
      line: f.StartLine ?? 0,
    }));

    return { count: findings.length, findings };
  } catch (err) {
    console.warn('[gitleaks] failed to parse report:', (err as Error).message);
    return emptyResult();
  }
}

function emptyResult(): GitleaksResult {
  return { count: 0, findings: [] };
}
