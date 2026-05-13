// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed';

export interface AnalyzeJobData {
  repoUrl: string;
  projectKey: string;
  submittedAt: string;
  /** Optional GitHub PAT for private repos. Cleared from memory after clone. */
  githubToken?: string;
}

// ---------------------------------------------------------------------------
// SonarQube CE task polling
// ---------------------------------------------------------------------------

export type SonarCETaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED';

export interface SonarCETask {
  id: string;
  status: SonarCETaskStatus;
  errorMessage?: string;
  analysisId?: string;
}

// ---------------------------------------------------------------------------
// Analysis results — SonarQube (Dev phase)
// ---------------------------------------------------------------------------

export type SonarSeverity = 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MINOR' | 'INFO';
export type SonarIssueType = 'BUG' | 'VULNERABILITY' | 'CODE_SMELL';
export type QualityGate = 'OK' | 'WARN' | 'ERROR';

export interface SonarIssue {
  key: string;
  severity: SonarSeverity;
  type: SonarIssueType;
  rule: string;
  message: string;
  component: string;
  line?: number;
}

export interface SonarMetrics {
  bugs: number;
  vulnerabilities: number;
  codeSmells: number;
  coverage?: number;
  duplicatedLinesDensity?: number;
  qualityGate: QualityGate;
}

// ---------------------------------------------------------------------------
// Ops phase raw tool outputs
// ---------------------------------------------------------------------------

export interface TrivyFinding {
  cveId?: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  packageName: string;
  installedVersion: string;
  fixedVersion?: string;
  title: string;
  resourceType: 'LIBRARY' | 'DOCKERFILE' | 'IAC';
}

export interface SecretFinding {
  ruleId: string;
  description: string;
  file: string;
  line: number;
  // Secret value is never stored — only metadata
}

export interface HadolintFinding {
  file: string;
  line: number;
  code: string;
  level: 'error' | 'warning' | 'info' | 'style';
  message: string;
}

export interface CheckovFinding {
  checkId: string;
  checkName: string;
  file: string;
  resource: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface GitHygieneMetrics {
  uniqueAuthors: number;
  recentCommitCount: number;
  hasGitignore: boolean;
  topContributorCommitShare: number; // 0-1, ratio of commits by top author
}

export interface OpsAnalysis {
  trivy: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    findings: TrivyFinding[];
  };
  secrets: {
    count: number;
    findings: SecretFinding[];
  };
  hadolint: {
    errors: number;
    warnings: number;
    findings: HadolintFinding[];
  };
  checkov: {
    passed: number;
    failed: number;
    findings: CheckovFinding[];
  };
  gitHygiene: GitHygieneMetrics;
}

// ---------------------------------------------------------------------------
// Risk matrix — impact × likelihood model
// ---------------------------------------------------------------------------

export type RiskPhase = 'DEV' | 'OPS';
export type RiskGrade = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type RiskSource = 'sonarqube' | 'trivy' | 'gitleaks' | 'hadolint' | 'checkov' | 'git-hygiene';

export interface RiskItem {
  id: string;
  source: RiskSource;
  phase: RiskPhase;
  title: string;
  detail: string;
  file?: string;
  line?: number;
  likelihood: number; // 1-5
  impact: number;     // 1-5
  riskLevel: number;  // likelihood × impact (1-25)
  riskGrade: RiskGrade;
}

export interface PhaseScore {
  phase: RiskPhase;
  score: number; // 0-100 normalized
  grade: RiskGrade;
  itemCount: number;
  breakdown: { grade: RiskGrade; count: number }[];
}

export interface RiskCorrelation {
  type: string;
  message: string;
  severity: RiskGrade;
  devItemIds: string[];
  opsItemIds: string[];
}

export interface RiskMatrix {
  items: RiskItem[];
  devPhase: PhaseScore;
  opsPhase: PhaseScore;
  correlations: RiskCorrelation[];
}

// ---------------------------------------------------------------------------
// Combined analysis result
// ---------------------------------------------------------------------------

export interface AnalysisResult {
  projectKey: string;
  repoUrl: string;
  analyzedAt: string;
  metrics: SonarMetrics;
  issues: SonarIssue[];
  sonarDashboardUrl: string;
  opsAnalysis?: OpsAnalysis;
  riskMatrix?: RiskMatrix;
}

// ---------------------------------------------------------------------------
// HTTP request / response shapes
// ---------------------------------------------------------------------------

export interface AnalyzeRequest {
  repoUrl: string;
  githubToken?: string;
}

export interface JobResponse {
  jobId: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: AnalysisResult;
  error?: string;
}
