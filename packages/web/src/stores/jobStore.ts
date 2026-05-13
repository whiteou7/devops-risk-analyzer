import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { JobResponse, AnalysisResult } from '@devops-risk-analyzer/shared';

export const useJobStore = defineStore('job', () => {
  const jobId = ref<string | null>(null);
  const status = ref<JobResponse['status']>('waiting');
  const progress = ref<number>(0);
  const stage = ref<string>('');
  const result = ref<AnalysisResult | null>(null);
  const error = ref<string | null>(null);

  function reset(): void {
    jobId.value = null;
    status.value = 'waiting';
    progress.value = 0;
    stage.value = '';
    result.value = null;
    error.value = null;
  }

  function setJob(id: string): void {
    reset();
    jobId.value = id;
    status.value = 'waiting';
  }

  function applyProgress(data: { progress?: number; stage?: string }): void {
    status.value = 'active';
    if (data.progress !== undefined) progress.value = data.progress as number;
    if (data.stage) stage.value = data.stage as string;
  }

  function applyCompleted(r: AnalysisResult): void {
    status.value = 'completed';
    progress.value = 100;
    result.value = r;
  }

  function applyFailed(msg: string): void {
    status.value = 'failed';
    error.value = msg;
  }

  return { jobId, status, progress, stage, result, error, reset, setJob, applyProgress, applyCompleted, applyFailed };
});
