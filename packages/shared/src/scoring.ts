import { createRequire } from 'module';
import path from 'path';
import type {
  SonarIssue,
  TrivyFinding,
  SecretFinding,
  HadolintFinding,
  CheckovFinding,
  GitHygieneMetrics,
  GithubActionsFinding,
  RiskItem,
  RiskGrade,
  RiskPhase,
  PhaseMapping,
  PhaseScore,
  RiskCorrelation,
  RiskMatrix,
} from './types.js';
import { ALL_PHASES } from './types.js';

// ---------------------------------------------------------------------------
// Risk mappings loader
// ---------------------------------------------------------------------------

interface ImpactLikelihood { impact: number; likelihood: number }
interface PhasedMapping { phases: Record<string, ImpactLikelihood> }

interface RiskMappings {
  sonarqube: Record<string, Record<string, PhasedMapping>>;
  trivy: Record<string, PhasedMapping>;
  gitleaks: Record<string, PhasedMapping>;
  hadolint: Record<string, PhasedMapping>;
  checkov: Record<string, PhasedMapping>;
  'git-hygiene': Record<string, PhasedMapping>;
  'github-actions': Record<string, PhasedMapping>;
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

function buildPhaseMappings(entry: PhasedMapping): PhaseMapping[] {
  return Object.entries(entry.phases).map(([phase, il]) => {
    const riskLevel = il.impact * il.likelihood;
    return {
      phase: phase as RiskPhase,
      impact: il.impact,
      likelihood: il.likelihood,
      riskLevel,
      riskGrade: riskLevelToGrade(riskLevel),
    };
  });
}

// ---------------------------------------------------------------------------
// SonarQube → RiskItem[]
// ---------------------------------------------------------------------------

export function sonarIssuesToRiskItems(issues: SonarIssue[]): RiskItem[] {
  const mappings = getMappings();
  return issues.map((issue, i) => {
    const typeMap = mappings.sonarqube[issue.type] ?? mappings.sonarqube['BUG'];
    const entry = typeMap[issue.severity] ?? typeMap['INFO'] ?? { phases: { code: { impact: 1, likelihood: 1 } } };
    return {
      id: makeId('sonarqube', i, issue.key),
      source: 'sonarqube' as const,
      phases: buildPhaseMappings(entry),
      title: `${issue.type}: ${issue.rule}`,
      detail: issue.message,
      file: issue.component,
      line: issue.line,
    };
  });
}

// ---------------------------------------------------------------------------
// Trivy → RiskItem[]
// ---------------------------------------------------------------------------

export function trivyFindingsToRiskItems(findings: TrivyFinding[]): RiskItem[] {
  const mappings = getMappings();
  return findings.map((f, i) => {
    // Key combines severity + resourceType for precise phase routing
    const key = `${f.severity}_${f.resourceType}`;
    const fallbackKey = `UNKNOWN_${f.resourceType}`;
    const entry = mappings.trivy[key] ?? mappings.trivy[fallbackKey] ?? mappings.trivy['UNKNOWN_LIBRARY'];
    return {
      id: makeId('trivy', i, f.cveId),
      source: 'trivy' as const,
      phases: buildPhaseMappings(entry),
      title: f.cveId ? `${f.cveId} in ${f.packageName}` : `CVE in ${f.packageName}`,
      detail: f.title,
    };
  });
}

// ---------------------------------------------------------------------------
// Gitleaks → RiskItem[]
// ---------------------------------------------------------------------------

export function secretFindingsToRiskItems(findings: SecretFinding[]): RiskItem[] {
  const mappings = getMappings();
  return findings.map((f, i) => {
    const entry = mappings.gitleaks[f.ruleId] ?? mappings.gitleaks['default'];
    return {
      id: makeId('gitleaks', i, f.ruleId),
      source: 'gitleaks' as const,
      phases: buildPhaseMappings(entry),
      title: `Secret detected: ${f.description}`,
      detail: `Found in ${f.file} at line ${f.line}`,
      file: f.file,
      line: f.line,
    };
  });
}

// ---------------------------------------------------------------------------
// Hadolint → RiskItem[]
// ---------------------------------------------------------------------------

export function hadolintFindingsToRiskItems(findings: HadolintFinding[]): RiskItem[] {
  const mappings = getMappings();
  return findings.map((f, i) => {
    const entry = mappings.hadolint[f.level] ?? { phases: { build: { impact: 1, likelihood: 1 } } };
    return {
      id: makeId('hadolint', i, f.code),
      source: 'hadolint' as const,
      phases: buildPhaseMappings(entry),
      title: `Dockerfile: ${f.code}`,
      detail: f.message,
      file: f.file,
      line: f.line,
    };
  });
}

// ---------------------------------------------------------------------------
// Checkov → RiskItem[]
// ---------------------------------------------------------------------------

export function checkovFindingsToRiskItems(findings: CheckovFinding[]): RiskItem[] {
  const mappings = getMappings();
  return findings.map((f, i) => {
    const entry = mappings.checkov[f.severity] ?? mappings.checkov['LOW'];
    return {
      id: makeId('checkov', i, f.checkId),
      source: 'checkov' as const,
      phases: buildPhaseMappings(entry),
      title: `IaC: ${f.checkId}`,
      detail: f.checkName,
      file: f.file,
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
    items.push({
      id: makeId('git-hygiene', idx++, 'single-author'),
      source: 'git-hygiene',
      phases: buildPhaseMappings(mappings['git-hygiene']['single-author']),
      title: 'Single author (bus factor risk)',
      detail: `Only ${metrics.uniqueAuthors} unique contributor(s) detected`,
    });
  }

  if (!metrics.hasGitignore) {
    items.push({
      id: makeId('git-hygiene', idx++, 'no-gitignore'),
      source: 'git-hygiene',
      phases: buildPhaseMappings(mappings['git-hygiene']['no-gitignore']),
      title: 'Missing .gitignore',
      detail: 'No .gitignore file found — secrets or build artifacts may be committed',
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// GitHub Actions → RiskItem[]
// ---------------------------------------------------------------------------

export function githubActionsToRiskItems(findings: GithubActionsFinding[]): RiskItem[] {
  const mappings = getMappings();
  return findings.map((f, i) => {
    const entry = mappings['github-actions'][f.rule] ?? mappings['github-actions']['unpinned-action'];
    return {
      id: makeId('github-actions', i, f.rule),
      source: 'github-actions' as const,
      phases: buildPhaseMappings(entry),
      title: `GitHub Actions: ${f.rule}`,
      detail: f.message,
      file: f.file,
    };
  });
}

// ---------------------------------------------------------------------------
// Phase score aggregation
// ---------------------------------------------------------------------------

// Normalised score: average riskLevel of the top-10 worst phase mappings, scaled to 0-100.
const TOP_N = 10;

export function aggregatePhaseScore(items: RiskItem[], phase: RiskPhase): PhaseScore {
  const phaseMappings = items.flatMap(i => i.phases.filter(p => p.phase === phase));
  const sorted = [...phaseMappings].sort((a, b) => b.riskLevel - a.riskLevel);
  const topN = sorted.slice(0, TOP_N);
  const avgLevel = topN.length > 0
    ? topN.reduce((sum, p) => sum + p.riskLevel, 0) / topN.length
    : 0;
  const score = Math.round((avgLevel / 25) * 100);

  const gradeCounts: Record<RiskGrade, number> = {
    CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0,
  };
  for (const pm of phaseMappings) gradeCounts[pm.riskGrade]++;

  return {
    phase,
    score,
    grade: scoreToGrade(score),
    itemCount: phaseMappings.length,
    breakdown: (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as RiskGrade[]).map(g => ({
      grade: g,
      count: gradeCounts[g],
    })),
  };
}

// ---------------------------------------------------------------------------
// Correlation detection
// ---------------------------------------------------------------------------

export function detectCorrelations(items: RiskItem[]): RiskCorrelation[] {
  const correlations: RiskCorrelation[] = [];

  const sonarVulnItems = items.filter(i => i.source === 'sonarqube' && i.title.includes('VULNERABILITY'));
  const trivyItems = items.filter(i => i.source === 'trivy');
  if (sonarVulnItems.length > 0 && trivyItems.length > 0) {
    correlations.push({
      type: 'VULN_AND_CVE',
      message: `${sonarVulnItems.length} SonarQube vulnerability finding(s) and ${trivyItems.length} Trivy CVE(s) detected — review overlapping dependencies`,
      severity: 'HIGH',
      itemIds: [...sonarVulnItems.map(i => i.id), ...trivyItems.map(i => i.id)],
      affectedPhases: ['code', 'operate'],
    });
  }

  const secretItems = items.filter(i => i.source === 'gitleaks');
  const criticalCodeItems = items.filter(i =>
    i.source === 'sonarqube' &&
    i.phases.some(p => p.riskGrade === 'CRITICAL' || p.riskGrade === 'HIGH'),
  );
  if (secretItems.length > 0 && criticalCodeItems.length > 0) {
    correlations.push({
      type: 'SECRET_WITH_HIGH_BUG_DENSITY',
      message: `Exposed secrets combined with ${criticalCodeItems.length} high/critical code issue(s) significantly elevates attack surface`,
      severity: 'CRITICAL',
      itemIds: [...secretItems.map(i => i.id), ...criticalCodeItems.map(i => i.id)],
      affectedPhases: ['code', 'operate'],
    });
  }

  const checkovItems = items.filter(i => i.source === 'checkov');
  const hadolintItems = items.filter(i => i.source === 'hadolint');
  if (checkovItems.length > 0 && hadolintItems.length > 0) {
    correlations.push({
      type: 'IAC_AND_DOCKERFILE_ISSUES',
      message: `${checkovItems.length} IaC misconfiguration(s) and ${hadolintItems.length} Dockerfile issue(s) suggest deployment hardening is needed`,
      severity: 'MEDIUM',
      itemIds: [...checkovItems.map(i => i.id), ...hadolintItems.map(i => i.id)],
      affectedPhases: ['build', 'release', 'deploy', 'operate'],
    });
  }

  return correlations;
}

// ---------------------------------------------------------------------------
// Build complete RiskMatrix
// ---------------------------------------------------------------------------

export function buildRiskMatrix(allItems: RiskItem[]): RiskMatrix {
  const phaseScores = Object.fromEntries(
    ALL_PHASES.map(phase => [phase, aggregatePhaseScore(allItems, phase)]),
  ) as Record<RiskPhase, PhaseScore>;

  return {
    items: allItems,
    phaseScores,
    correlations: detectCorrelations(allItems),
  };
}
