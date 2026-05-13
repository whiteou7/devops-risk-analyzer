import { createRequire } from 'module';
import path from 'path';
import type {
  SonarIssue,
  TrivyFinding,
  SecretFinding,
  HadolintFinding,
  CheckovFinding,
  GitHygieneMetrics,
  RiskItem,
  RiskGrade,
  RiskPhase,
  PhaseScore,
  RiskCorrelation,
  RiskMatrix,
} from './types.js';

// ---------------------------------------------------------------------------
// Risk mappings loader
// ---------------------------------------------------------------------------

interface ImpactLikelihood { impact: number; likelihood: number }

interface RiskMappings {
  sonarqube: Record<string, Record<string, ImpactLikelihood>>;
  trivy: Record<string, ImpactLikelihood>;
  gitleaks: Record<string, ImpactLikelihood>;
  hadolint: Record<string, ImpactLikelihood>;
  checkov: Record<string, ImpactLikelihood>;
  'git-hygiene': Record<string, ImpactLikelihood>;
}

function loadMappings(): RiskMappings {
  // __filename is the CJS equivalent of fileURLToPath(import.meta.url)
  const mappingsPath = process.env['RISK_MAPPINGS_PATH'] ??
    path.resolve(path.dirname(__filename), '../config/risk-mappings.json');
  const req = createRequire(__filename);
  return req(mappingsPath) as RiskMappings;
}

let _mappings: RiskMappings | null = null;
function getMappings(): RiskMappings {
  _mappings ??= loadMappings();
  return _mappings;
}

// ---------------------------------------------------------------------------
// Grade helpers
// ---------------------------------------------------------------------------

export function riskLevelToGrade(level: number): RiskGrade {
  if (level >= 20) return 'CRITICAL';
  if (level >= 10) return 'HIGH';
  if (level >= 5)  return 'MEDIUM';
  return 'LOW';
}

export function scoreToGrade(score: number): RiskGrade {
  if (score >= 70) return 'CRITICAL';
  if (score >= 45) return 'HIGH';
  if (score >= 20) return 'MEDIUM';
  return 'LOW';
}

function makeId(source: string, index: number, extra?: string): string {
  return `${source}-${index}${extra ? `-${extra}` : ''}`;
}

// ---------------------------------------------------------------------------
// SonarQube → RiskItem[]
// ---------------------------------------------------------------------------

export function sonarIssuesToRiskItems(issues: SonarIssue[]): RiskItem[] {
  const mappings = getMappings();
  return issues.map((issue, i) => {
    const typeMap = mappings.sonarqube[issue.type] ?? mappings.sonarqube['BUG'];
    const il = typeMap[issue.severity] ?? { impact: 1, likelihood: 1 };
    const riskLevel = il.impact * il.likelihood;
    return {
      id: makeId('sonarqube', i, issue.key),
      source: 'sonarqube' as const,
      phase: 'DEV' as RiskPhase,
      title: `${issue.type}: ${issue.rule}`,
      detail: issue.message,
      file: issue.component,
      line: issue.line,
      likelihood: il.likelihood,
      impact: il.impact,
      riskLevel,
      riskGrade: riskLevelToGrade(riskLevel),
    };
  });
}

// ---------------------------------------------------------------------------
// Trivy → RiskItem[]
// ---------------------------------------------------------------------------

export function trivyFindingsToRiskItems(findings: TrivyFinding[]): RiskItem[] {
  const mappings = getMappings();
  return findings.map((f, i) => {
    const il = mappings.trivy[f.severity] ?? mappings.trivy['UNKNOWN'];
    const riskLevel = il.impact * il.likelihood;
    return {
      id: makeId('trivy', i, f.cveId),
      source: 'trivy' as const,
      phase: 'OPS' as RiskPhase,
      title: f.cveId ? `${f.cveId} in ${f.packageName}` : `CVE in ${f.packageName}`,
      detail: f.title,
      likelihood: il.likelihood,
      impact: il.impact,
      riskLevel,
      riskGrade: riskLevelToGrade(riskLevel),
    };
  });
}

// ---------------------------------------------------------------------------
// Gitleaks → RiskItem[]
// ---------------------------------------------------------------------------

export function secretFindingsToRiskItems(findings: SecretFinding[]): RiskItem[] {
  const mappings = getMappings();
  return findings.map((f, i) => {
    const il = mappings.gitleaks[f.ruleId] ?? mappings.gitleaks['default'];
    const riskLevel = il.impact * il.likelihood;
    return {
      id: makeId('gitleaks', i, f.ruleId),
      source: 'gitleaks' as const,
      phase: 'OPS' as RiskPhase,
      title: `Secret detected: ${f.description}`,
      detail: `Found in ${f.file} at line ${f.line}`,
      file: f.file,
      line: f.line,
      likelihood: il.likelihood,
      impact: il.impact,
      riskLevel,
      riskGrade: riskLevelToGrade(riskLevel),
    };
  });
}

// ---------------------------------------------------------------------------
// Hadolint → RiskItem[]
// ---------------------------------------------------------------------------

export function hadolintFindingsToRiskItems(findings: HadolintFinding[]): RiskItem[] {
  const mappings = getMappings();
  return findings.map((f, i) => {
    const il = mappings.hadolint[f.level] ?? { impact: 1, likelihood: 1 };
    const riskLevel = il.impact * il.likelihood;
    return {
      id: makeId('hadolint', i, f.code),
      source: 'hadolint' as const,
      phase: 'OPS' as RiskPhase,
      title: `Dockerfile: ${f.code}`,
      detail: f.message,
      file: f.file,
      line: f.line,
      likelihood: il.likelihood,
      impact: il.impact,
      riskLevel,
      riskGrade: riskLevelToGrade(riskLevel),
    };
  });
}

// ---------------------------------------------------------------------------
// Checkov → RiskItem[]
// ---------------------------------------------------------------------------

export function checkovFindingsToRiskItems(findings: CheckovFinding[]): RiskItem[] {
  const mappings = getMappings();
  return findings.map((f, i) => {
    const il = mappings.checkov[f.severity] ?? mappings.checkov['LOW'];
    const riskLevel = il.impact * il.likelihood;
    return {
      id: makeId('checkov', i, f.checkId),
      source: 'checkov' as const,
      phase: 'OPS' as RiskPhase,
      title: `IaC: ${f.checkId}`,
      detail: f.checkName,
      file: f.file,
      likelihood: il.likelihood,
      impact: il.impact,
      riskLevel,
      riskGrade: riskLevelToGrade(riskLevel),
    };
  });
}

// ---------------------------------------------------------------------------
// Git hygiene → RiskItem[]
// ---------------------------------------------------------------------------

export function gitHygieneToRiskItems(metrics: GitHygieneMetrics): RiskItem[] {
  const mappings = getMappings();
  const items: RiskItem[] = [];
  let idx = 0;

  if (metrics.uniqueAuthors < 2) {
    const il = mappings['git-hygiene']['single-author'];
    const riskLevel = il.impact * il.likelihood;
    items.push({
      id: makeId('git-hygiene', idx++, 'single-author'),
      source: 'git-hygiene',
      phase: 'OPS',
      title: 'Single author (bus factor risk)',
      detail: `Only ${metrics.uniqueAuthors} unique contributor(s) detected`,
      likelihood: il.likelihood,
      impact: il.impact,
      riskLevel,
      riskGrade: riskLevelToGrade(riskLevel),
    });
  }

  if (!metrics.hasGitignore) {
    const il = mappings['git-hygiene']['no-gitignore'];
    const riskLevel = il.impact * il.likelihood;
    items.push({
      id: makeId('git-hygiene', idx++, 'no-gitignore'),
      source: 'git-hygiene',
      phase: 'OPS',
      title: 'Missing .gitignore',
      detail: 'No .gitignore file found — secrets or build artifacts may be committed',
      likelihood: il.likelihood,
      impact: il.impact,
      riskLevel,
      riskGrade: riskLevelToGrade(riskLevel),
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Phase score aggregation
// ---------------------------------------------------------------------------

// Normalised score: average riskLevel of the top-10 worst items, scaled to 0-100.
// Using a capped top-N prevents huge repos from always hitting 100.
const TOP_N = 10;

export function aggregatePhaseScore(items: RiskItem[], phase: RiskPhase): PhaseScore {
  const phaseItems = items.filter(i => i.phase === phase);
  const sorted = [...phaseItems].sort((a, b) => b.riskLevel - a.riskLevel);
  const topN = sorted.slice(0, TOP_N);
  const avgLevel = topN.length > 0
    ? topN.reduce((sum, i) => sum + i.riskLevel, 0) / topN.length
    : 0;
  const score = Math.round((avgLevel / 25) * 100);

  const gradeCounts: Record<RiskGrade, number> = {
    CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0,
  };
  for (const item of phaseItems) gradeCounts[item.riskGrade]++;

  return {
    phase,
    score,
    grade: scoreToGrade(score),
    itemCount: phaseItems.length,
    breakdown: (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as RiskGrade[]).map(g => ({
      grade: g,
      count: gradeCounts[g],
    })),
  };
}

// ---------------------------------------------------------------------------
// Correlation detection
// ---------------------------------------------------------------------------

export function detectCorrelations(
  devItems: RiskItem[],
  opsItems: RiskItem[],
): RiskCorrelation[] {
  const correlations: RiskCorrelation[] = [];

  // SonarQube vulnerabilities that also have a matching Trivy CVE (same package heuristic)
  const sonarVulnItems = devItems.filter(i => i.source === 'sonarqube' && i.title.includes('VULNERABILITY'));
  const trivyItems = opsItems.filter(i => i.source === 'trivy');
  if (sonarVulnItems.length > 0 && trivyItems.length > 0) {
    correlations.push({
      type: 'VULN_AND_CVE',
      message: `${sonarVulnItems.length} SonarQube vulnerability finding(s) and ${trivyItems.length} Trivy CVE(s) detected — review overlapping dependencies`,
      severity: 'HIGH',
      devItemIds: sonarVulnItems.map(i => i.id),
      opsItemIds: trivyItems.map(i => i.id),
    });
  }

  // Secrets found alongside code bugs — combined risk
  const secretItems = opsItems.filter(i => i.source === 'gitleaks');
  const criticalBugItems = devItems.filter(i => i.riskGrade === 'CRITICAL' || i.riskGrade === 'HIGH');
  if (secretItems.length > 0 && criticalBugItems.length > 0) {
    correlations.push({
      type: 'SECRET_WITH_HIGH_BUG_DENSITY',
      message: `Exposed secrets combined with ${criticalBugItems.length} high/critical code issue(s) significantly elevates attack surface`,
      severity: 'CRITICAL',
      devItemIds: criticalBugItems.map(i => i.id),
      opsItemIds: secretItems.map(i => i.id),
    });
  }

  // IaC misconfigs + Dockerfile issues = deployment risk
  const checkovItems = opsItems.filter(i => i.source === 'checkov');
  const hadolintItems = opsItems.filter(i => i.source === 'hadolint');
  if (checkovItems.length > 0 && hadolintItems.length > 0) {
    correlations.push({
      type: 'IAC_AND_DOCKERFILE_ISSUES',
      message: `${checkovItems.length} IaC misconfiguration(s) and ${hadolintItems.length} Dockerfile issue(s) suggest deployment hardening is needed`,
      severity: 'MEDIUM',
      devItemIds: [],
      opsItemIds: [...checkovItems.map(i => i.id), ...hadolintItems.map(i => i.id)],
    });
  }

  return correlations;
}

// ---------------------------------------------------------------------------
// Build complete RiskMatrix
// ---------------------------------------------------------------------------

export function buildRiskMatrix(
  devItems: RiskItem[],
  opsItems: RiskItem[],
): RiskMatrix {
  const allItems = [...devItems, ...opsItems];
  return {
    items: allItems,
    devPhase: aggregatePhaseScore(allItems, 'DEV'),
    opsPhase: aggregatePhaseScore(allItems, 'OPS'),
    correlations: detectCorrelations(devItems, opsItems),
  };
}
