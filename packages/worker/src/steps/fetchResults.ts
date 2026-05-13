import { getSonarClient } from '../sonarClient.js';
import type { AnalysisResult, SonarIssue, SonarMetrics, QualityGate } from '@devops-risk-analyzer/shared';

// ---------------------------------------------------------------------------
// SonarQube API response shapes (internal to this module)
// ---------------------------------------------------------------------------

interface MeasuresResponse {
  component: {
    measures: Array<{ metric: string; value: string }>;
  };
}

interface IssuesResponse {
  issues: Array<{
    key: string;
    severity: SonarIssue['severity'];
    type: SonarIssue['type'];
    rule: string;
    message: string;
    component: string;
    line?: number;
  }>;
}

const METRIC_KEYS = [
  'bugs',
  'vulnerabilities',
  'code_smells',
  'coverage',
  'duplicated_lines_density',
  'alert_status',
].join(',');

export async function fetchResults(
  projectKey: string,
  repoUrl: string,
): Promise<AnalysisResult> {
  const client = getSonarClient();
  const sonarUrl = process.env.SONAR_URL!;

  const [measuresRes, issuesRes] = await Promise.all([
    client.get<MeasuresResponse>('/api/measures/component', {
      params: {
        component: projectKey,
        metricKeys: METRIC_KEYS,
      },
    }),
    client.get<IssuesResponse>('/api/issues/search', {
      params: {
        componentKeys: projectKey,
        ps: 500,
        severities: 'BLOCKER,CRITICAL,MAJOR',
        s: 'SEVERITY',
        asc: false,
      },
    }),
  ]);

  const measureMap = Object.fromEntries(
    measuresRes.data.component.measures.map((m) => [m.metric, m.value]),
  );

  const qualityGateRaw = measureMap['alert_status'] ?? 'ERROR';
  const qualityGate: QualityGate =
    qualityGateRaw === 'OK' || qualityGateRaw === 'WARN' || qualityGateRaw === 'ERROR'
      ? qualityGateRaw
      : 'ERROR';

  const metrics: SonarMetrics = {
    bugs: parseInt(measureMap['bugs'] ?? '0', 10),
    vulnerabilities: parseInt(measureMap['vulnerabilities'] ?? '0', 10),
    codeSmells: parseInt(measureMap['code_smells'] ?? '0', 10),
    qualityGate,
    ...(measureMap['coverage'] !== undefined
      ? { coverage: parseFloat(measureMap['coverage']) }
      : {}),
    ...(measureMap['duplicated_lines_density'] !== undefined
      ? { duplicatedLinesDensity: parseFloat(measureMap['duplicated_lines_density']) }
      : {}),
  };

  const issues: SonarIssue[] = issuesRes.data.issues.map((i) => ({
    key: i.key,
    severity: i.severity,
    type: i.type,
    rule: i.rule,
    message: i.message,
    component: i.component,
    ...(i.line !== undefined ? { line: i.line } : {}),
  }));

  return {
    projectKey,
    repoUrl,
    analyzedAt: new Date().toISOString(),
    metrics,
    issues,
    sonarDashboardUrl: `${sonarUrl}/dashboard?id=${encodeURIComponent(projectKey)}`,
  };
}
