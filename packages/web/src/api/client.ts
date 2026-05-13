import type { AnalyzeRequest, JobResponse } from '@devops-risk-analyzer/shared';

const BASE = '/api';

export async function submitAnalysis(body: AnalyzeRequest): Promise<JobResponse> {
  const res = await fetch(`${BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<JobResponse>;
}

export async function getJob(jobId: string): Promise<JobResponse> {
  const res = await fetch(`${BASE}/jobs/${jobId}`);
  if (!res.ok) throw new Error(`Job not found: ${jobId}`);
  return res.json() as Promise<JobResponse>;
}

export function openJobStream(jobId: string): EventSource {
  return new EventSource(`${BASE}/jobs/${jobId}/stream`);
}
