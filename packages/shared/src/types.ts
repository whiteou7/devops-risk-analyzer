// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed';

export interface AnalyzeJobData {
  repoUrl: string;
  projectKey: string;
  submittedAt: string;
  commitSha?: string;
  /** Optional GitHub PAT for private repos. Cleared from memory after clone. */
  githubToken?: string;
  /** When true, skip the DB cache and always run a fresh analysis. */
  forceRefresh?: boolean;
  /** SHA-256 hash of uploaded documentation files (from POST /docs/upload). */
  docHash?: string;
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
  /** CVSS base score (0–10) extracted from Trivy output; used for impact calculation. */
  cvssScore?: number;
  /** EPSS probability (0–1) fetched from api.first.org; used for likelihood calculation. */
  epssScore?: number;
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

export interface GithubActionsFinding {
  rule: 'unpinned-action' | 'pull-request-target' | 'script-injection' | 'self-hosted-runner' | 'missing-permissions' | 'write-all-permissions' | 'job-run-error' | 'repeated-failure';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  file: string;
  message: string;
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
  githubActions: {
    workflowCount: number;
    findings: GithubActionsFinding[];
  };
}

// ---------------------------------------------------------------------------
// Risk matrix — impact × likelihood model
// ---------------------------------------------------------------------------

export type RiskPhase = 'plan' | 'code' | 'build' | 'test' | 'release' | 'deploy' | 'operate' | 'monitor';
export type RiskGrade = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type RiskSource = 'sonarqube' | 'trivy' | 'gitleaks' | 'hadolint' | 'checkov' | 'git-hygiene' | 'github-actions' | 'ai-documentation';
export type Artifact = 'documentation' | 'source-code' | 'testing' | 'deployment';

export const ALL_PHASES: RiskPhase[] = ['plan', 'code', 'build', 'test', 'release', 'deploy', 'operate', 'monitor'];
export const ALL_ARTIFACTS: Artifact[] = ['documentation', 'source-code', 'testing', 'deployment'];

/** Per-phase independent risk score for a single finding. */
export interface PhaseMapping {
  phase: RiskPhase;
  impact: number;      // 1-5
  likelihood: number;  // 1-5
  riskLevel: number;   // impact × likelihood (1-25)
  riskGrade: RiskGrade;
}

export interface RiskItem {
  id: string;
  source: RiskSource;
  artifact: Artifact;
  /** One entry per pipeline phase this finding affects, each with independent scoring. */
  phases: PhaseMapping[];
  title: string;
  detail: string;
  file?: string;
  line?: number;
}

export interface PhaseScore {
  phase: RiskPhase;
  score: number; // 0-100 normalized
  grade: RiskGrade;
  itemCount: number;
  breakdown: { grade: RiskGrade; count: number }[];
}

export interface RiskMatrix {
  items: RiskItem[];
  phaseScores: Record<RiskPhase, PhaseScore>;
  artifactPhaseScores: Record<Artifact, Record<RiskPhase, PhaseScore>>;
}

// ---------------------------------------------------------------------------
// Combined analysis result
// ---------------------------------------------------------------------------

export interface AnalysisResult {
  projectKey: string;
  repoUrl: string;
  /** Resolved full commit SHA that was analyzed. */
  commitSha: string;
  analyzedAt: string;
  metrics: SonarMetrics;
  issues: SonarIssue[];
  sonarDashboardUrl: string;
  opsAnalysis?: OpsAnalysis;
  riskMatrix?: RiskMatrix;
}

// ---------------------------------------------------------------------------
// HTTP request / response shapes — REST normalized
// ---------------------------------------------------------------------------

export interface AnalyzeRequest {
  repoUrl: string;
  githubToken?: string;
  /** Specific commit SHA to analyze. Defaults to HEAD when omitted. */
  commitSha?: string;
  /** When true, skip the cache and always run a fresh analysis. */
  forceRefresh?: boolean;
  /** SHA-256 hash of uploaded documentation files (from POST /docs/upload). */
  docHash?: string;
}

/** Envelope for all successful API responses. */
export interface ApiResponse<T> {
  data: T;
}

/** Envelope for all API error responses. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/** Job resource returned by GET /jobs/:id and POST /analyze (new job). */
export interface JobResource {
  id: string;
  status: JobStatus;
  repoUrl: string;
  commitSha?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: AnalysisResult;
  error?: string;
}

/** Returned by POST /analyze when a cached result is found for the given repo+commit. */
export interface CachedAnalysisResource {
  cached: true;
  repoUrl: string;
  commitSha: string;
  result: AnalysisResult;
}

/** Union of possible POST /analyze response data shapes. */
export type AnalyzeResponseData =
  | ({ cached: false } & Pick<JobResource, 'id' | 'status' | 'repoUrl' | 'commitSha' | 'createdAt'>)
  | CachedAnalysisResource;

/** @deprecated Use JobResource */
export type JobResponse = JobResource & { jobId: string };

// ---------------------------------------------------------------------------
// Timeline analysis — risk trend over past month
// ---------------------------------------------------------------------------

export interface TimelineRequest {
  repoUrl: string;
  githubToken?: string;
  forceRefresh?: boolean;
}

export interface TimelineJobData {
  repoUrl: string;
  githubToken?: string;
  forceRefresh?: boolean;
}

/** A single commit's data used as a graph node in the risk trend chart. */
export interface CommitRiskPoint {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string; // ISO timestamp
  riskMatrix: RiskMatrix;
}

/** Result returned by the timeline analysis job. */
export interface TimelineResult {
  repoUrl: string;
  points: CommitRiskPoint[]; // ordered oldest → newest
  analyzedAt: string;
}
