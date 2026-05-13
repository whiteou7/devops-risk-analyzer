import { execa } from 'execa';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import type { HadolintFinding } from '@devops-risk-analyzer/shared';

interface HadolintResult {
  errors: number;
  warnings: number;
  findings: HadolintFinding[];
}

interface HadolintJsonFinding {
  file?: string;
  line?: number;
  code?: string;
  level?: string;
  message?: string;
}

async function findDockerfiles(dir: string, maxDepth = 3): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (/^[Dd]ockerfile(\..*)?$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
  await walk(dir, 0);
  return results;
}

export async function runHadolint(repoDir: string): Promise<HadolintResult> {
  const TIMEOUT_MS = 30 * 1000;
  const dockerfiles = await findDockerfiles(repoDir);

  if (dockerfiles.length === 0) {
    return { errors: 0, warnings: 0, findings: [] };
  }

  const allFindings: HadolintFinding[] = [];

  for (const dockerfilePath of dockerfiles) {
    let stdout = '';
    try {
      const result = await execa(
        'hadolint',
        ['--format', 'json', dockerfilePath],
        { timeout: TIMEOUT_MS, reject: false },
      );
      stdout = result.stdout;
    } catch (err: unknown) {
      console.warn('[hadolint] error on', dockerfilePath, ':', (err as Error).message);
      continue;
    }

    try {
      const parsed = JSON.parse(stdout) as HadolintJsonFinding[];
      if (!Array.isArray(parsed)) continue;
      for (const f of parsed) {
        allFindings.push({
          file: path.relative(repoDir, f.file ?? dockerfilePath),
          line: f.line ?? 0,
          code: f.code ?? '',
          level: normaliseLevel(f.level),
          message: f.message ?? '',
        });
      }
    } catch {
      /* skip unparseable output */
    }
  }

  // Check file sizes to filter false positives from empty Dockerfiles
  const filteredFindings: HadolintFinding[] = [];
  for (const f of allFindings) {
    const fullPath = path.join(repoDir, f.file);
    try {
      const s = await stat(fullPath);
      if (s.size > 0) filteredFindings.push(f);
    } catch {
      filteredFindings.push(f);
    }
  }

  const errors = filteredFindings.filter(f => f.level === 'error').length;
  const warnings = filteredFindings.filter(f => f.level === 'warning').length;
  return { errors, warnings, findings: filteredFindings };
}

function normaliseLevel(level: string | undefined): HadolintFinding['level'] {
  switch ((level ?? '').toLowerCase()) {
    case 'error': return 'error';
    case 'warning': return 'warning';
    case 'info': return 'info';
    default: return 'style';
  }
}
