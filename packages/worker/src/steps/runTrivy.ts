import { execa } from 'execa';
import type { TrivyFinding } from '@devops-risk-analyzer/shared';

interface TrivyResult {
  critical: number;
  high: number;
  medium: number;
  low: number;
  findings: TrivyFinding[];
}

interface TrivyJsonVuln {
  VulnerabilityID?: string;
  Severity?: string;
  PkgName?: string;
  InstalledVersion?: string;
  FixedVersion?: string;
  Title?: string;
}

interface TrivyJsonMisconfig {
  ID?: string;
  Title?: string;
  Severity?: string;
}

interface TrivyJsonResult {
  Type?: string;
  Vulnerabilities?: TrivyJsonVuln[];
  Misconfigurations?: TrivyJsonMisconfig[];
}

interface TrivyJsonOutput {
  Results?: TrivyJsonResult[];
}

function mapSeverity(s: string | undefined): TrivyFinding['severity'] {
  const v = (s ?? '').toUpperCase();
  if (v === 'CRITICAL' || v === 'HIGH' || v === 'MEDIUM' || v === 'LOW') return v;
  return 'UNKNOWN';
}

export async function runTrivy(repoDir: string): Promise<TrivyResult> {
  const TIMEOUT_MS = 3 * 60 * 1000;

  let stdout = '';
  try {
    const result = await execa(
      'trivy',
      ['fs', '--format', 'json', '--exit-code', '0', '--scanners', 'vuln,misconfig,secret', repoDir],
      { timeout: TIMEOUT_MS, env: { ...process.env, TRIVY_NO_PROGRESS: 'true' } },
    );
    stdout = result.stdout;
  } catch (err: unknown) {
    const e = err as { timedOut?: boolean; stdout?: string };
    if (e.timedOut) {
      console.warn('[trivy] scan timed out, returning partial results');
      stdout = e.stdout ?? '{}';
    } else {
      console.warn('[trivy] scan failed:', (err as Error).message);
      return emptyResult();
    }
  }

  try {
    const parsed = JSON.parse(stdout) as TrivyJsonOutput;
    return extractFindings(parsed);
  } catch {
    return emptyResult();
  }
}

function emptyResult(): TrivyResult {
  return { critical: 0, high: 0, medium: 0, low: 0, findings: [] };
}

function extractFindings(parsed: TrivyJsonOutput): TrivyResult {
  const findings: TrivyFinding[] = [];

  for (const res of parsed.Results ?? []) {
    for (const v of res.Vulnerabilities ?? []) {
      findings.push({
        cveId: v.VulnerabilityID,
        severity: mapSeverity(v.Severity),
        packageName: v.PkgName ?? 'unknown',
        installedVersion: v.InstalledVersion ?? '',
        fixedVersion: v.FixedVersion,
        title: v.Title ?? v.VulnerabilityID ?? 'Vulnerability',
        resourceType: 'LIBRARY',
      });
    }
    for (const m of res.Misconfigurations ?? []) {
      findings.push({
        cveId: m.ID,
        severity: mapSeverity(m.Severity),
        packageName: m.ID ?? 'misconfiguration',
        installedVersion: '',
        title: m.Title ?? m.ID ?? 'Misconfiguration',
        resourceType: res.Type?.toLowerCase().includes('dockerfile') ? 'DOCKERFILE' : 'IAC',
      });
    }
  }

  // Deduplicate by CVE ID + package
  const seen = new Set<string>();
  const deduped = findings.filter(f => {
    const key = `${f.cveId ?? ''}-${f.packageName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of deduped) {
    if (f.severity === 'CRITICAL') counts.critical++;
    else if (f.severity === 'HIGH') counts.high++;
    else if (f.severity === 'MEDIUM') counts.medium++;
    else if (f.severity === 'LOW') counts.low++;
  }

  return { ...counts, findings: deduped };
}
