import { execa } from 'execa';
import type { TrivyFinding } from '@devops-risk-analyzer/shared';

interface TrivyResult {
  critical: number;
  high: number;
  medium: number;
  low: number;
  findings: TrivyFinding[];
}

interface TrivyJsonCvssEntry {
  V3Score?: number;
  V2Score?: number;
}

interface TrivyJsonVuln {
  VulnerabilityID?: string;
  Severity?: string;
  PkgName?: string;
  InstalledVersion?: string;
  FixedVersion?: string;
  Title?: string;
  CVSS?: Record<string, TrivyJsonCvssEntry>;
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

function extractCvssScore(cvss: Record<string, TrivyJsonCvssEntry> | undefined): number | undefined {
  if (!cvss) return undefined;
  // Prefer NVD V3, then any provider's V3, then V2
  for (const provider of ['nvd', ...Object.keys(cvss)]) {
    const entry = cvss[provider];
    if (entry?.V3Score !== undefined) return entry.V3Score;
  }
  for (const entry of Object.values(cvss)) {
    if (entry?.V2Score !== undefined) return entry.V2Score;
  }
  return undefined;
}

function mapSeverity(s: string | undefined): TrivyFinding['severity'] {
  const v = (s ?? '').toUpperCase();
  if (v === 'CRITICAL' || v === 'HIGH' || v === 'MEDIUM' || v === 'LOW') return v;
  return 'UNKNOWN';
}

export async function runTrivy(repoDir: string): Promise<TrivyResult> {
  const TIMEOUT_MS = 3 * 60 * 1000;
  console.log(`[trivy] starting filesystem scan — dir=${repoDir}`);

  let stdout = '';
  try {
    const result = await execa(
      'trivy',
      ['fs', '--format', 'json', '--exit-code', '0', '--scanners', 'vuln,misconfig,secret', repoDir],
      { timeout: TIMEOUT_MS, env: { ...process.env, TRIVY_NO_PROGRESS: 'true' } },
    );
    stdout = result.stdout;
    console.debug('[trivy] scan process exited successfully');
  } catch (err: unknown) {
    const e = err as { timedOut?: boolean; stdout?: string };
    if (e.timedOut) {
      console.warn('[trivy] scan timed out, returning partial results');
      stdout = e.stdout ?? '{}';
    } else {
      console.error('[trivy] scan failed:', (err as Error).message);
      console.warn('[trivy] scan failed:', (err as Error).message);
      return emptyResult();
    }
  }

  try {
    const parsed = JSON.parse(stdout) as TrivyJsonOutput;
    const result = extractFindings(parsed);
    console.debug(
      `[trivy] findings: critical=${result.critical} high=${result.high} medium=${result.medium} low=${result.low} total=${result.findings.length}`,
    );
    console.debug('[trivy] full result:', JSON.stringify(result, null, 2));
    return result;
  } catch {
    console.error('[trivy] failed to parse JSON output');
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
        cvssScore: extractCvssScore(v.CVSS),
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
