import type {
  AnalyzeRequest,
  ApiResponse,
  AnalyzeResponseData,
  JobResource,
} from '@devops-risk-analyzer/shared';

const BASE = '/api';

export async function submitAnalysis(
  body: AnalyzeRequest,
): Promise<ApiResponse<AnalyzeResponseData>> {
  const res = await fetch(`${BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    const msg = (err as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(msg);
  }
  return res.json() as Promise<ApiResponse<AnalyzeResponseData>>;
}

export async function getJob(jobId: string): Promise<ApiResponse<JobResource>> {
  const res = await fetch(`${BASE}/jobs/${jobId}`);
  if (!res.ok) throw new Error(`Job not found: ${jobId}`);
  return res.json() as Promise<ApiResponse<JobResource>>;
}

export function openJobStream(jobId: string): EventSource {
  return new EventSource(`${BASE}/jobs/${jobId}/stream`);
}
