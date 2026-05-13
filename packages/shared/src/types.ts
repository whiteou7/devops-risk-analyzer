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
// Analysis results
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

export interface AnalysisResult {
  projectKey: string;
  repoUrl: string;
  analyzedAt: string;
  metrics: SonarMetrics;
  issues: SonarIssue[];
  sonarDashboardUrl: string;
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
