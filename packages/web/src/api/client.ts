import type {
  AnalyzeRequest,
  ApiResponse,
  AnalyzeResponseData,
  JobResource,
  TimelineRequest,
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

export async function submitTimeline(
  body: TimelineRequest,
): Promise<ApiResponse<Pick<JobResource, 'id' | 'status' | 'repoUrl' | 'createdAt'>>> {
  const res = await fetch(`${BASE}/timeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    const msg = (err as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(msg);
  }
  return res.json();
}

export async function getTimelineJob(jobId: string): Promise<ApiResponse<JobResource>> {
  const res = await fetch(`${BASE}/timeline-jobs/${jobId}`);
  if (!res.ok) throw new Error(`Timeline job not found: ${jobId}`);
  return res.json();
}

export function openTimelineJobStream(jobId: string): EventSource {
  return new EventSource(`${BASE}/timeline-jobs/${jobId}/stream`);
}
