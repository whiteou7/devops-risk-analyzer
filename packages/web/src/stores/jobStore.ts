import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { JobStatus, AnalysisResult, TimelineResult } from '@devops-risk-analyzer/shared';

export const useJobStore = defineStore('job', () => {
  // --- Main analysis job ---
  const jobId = ref<string | null>(null);
  const status = ref<JobStatus>('waiting');
  const progress = ref<number>(0);
  const stage = ref<string>('');
  const result = ref<AnalysisResult | null>(null);
  const error = ref<string | null>(null);

  // --- Timeline job ---
  const timelineJobId = ref<string | null>(null);
  const timelineStatus = ref<JobStatus>('waiting');
  const timelineProgress = ref<number>(0);
  const timelineStage = ref<string>('');
  const timelineResult = ref<TimelineResult | null>(null);
  const timelineError = ref<string | null>(null);

  function reset(): void {
    jobId.value = null;
    status.value = 'waiting';
    progress.value = 0;
    stage.value = '';
    result.value = null;
    error.value = null;
    timelineJobId.value = null;
    timelineStatus.value = 'waiting';
    timelineProgress.value = 0;
    timelineStage.value = '';
    timelineResult.value = null;
    timelineError.value = null;
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

  function setTimeline(id: string): void {
    timelineJobId.value = id;
    timelineStatus.value = 'waiting';
    timelineProgress.value = 0;
    timelineStage.value = '';
    timelineResult.value = null;
    timelineError.value = null;
  }

  function applyTimelineProgress(data: { value?: number; stage?: string }): void {
    timelineStatus.value = 'active';
    if (data.value !== undefined) timelineProgress.value = data.value;
    if (data.stage) timelineStage.value = data.stage;
  }

  function applyTimelineCompleted(r: TimelineResult): void {
    timelineStatus.value = 'completed';
    timelineProgress.value = 100;
    timelineResult.value = r;
  }

  function applyTimelineFailed(msg: string): void {
    timelineStatus.value = 'failed';
    timelineError.value = msg;
  }

  return {
    jobId, status, progress, stage, result, error,
    timelineJobId, timelineStatus, timelineProgress, timelineStage, timelineResult, timelineError,
    reset, setJob, applyProgress, applyCompleted, applyFailed,
    setTimeline, applyTimelineProgress, applyTimelineCompleted, applyTimelineFailed,
  };
});
