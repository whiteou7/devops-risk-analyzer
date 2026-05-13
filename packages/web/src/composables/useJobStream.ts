import { onUnmounted } from 'vue';
import { openJobStream } from '../api/client.ts';
import { useJobStore } from '../stores/jobStore.ts';
import type { AnalysisResult } from '@devops-risk-analyzer/shared';

interface ProgressEvent { type: 'progress'; progress: number; stage?: string }
interface CompletedEvent { type: 'completed'; result: AnalysisResult }
interface FailedEvent { type: 'failed'; error: string }
type StreamEvent = ProgressEvent | CompletedEvent | FailedEvent;

export function useJobStream(jobId: string): void {
  const store = useJobStore();
  const es = openJobStream(jobId);

  es.onmessage = (e: MessageEvent<string>) => {
    const event = JSON.parse(e.data) as StreamEvent;
    if (event.type === 'progress') {
      store.applyProgress({ progress: event.progress, stage: event.stage });
    } else if (event.type === 'completed') {
      store.applyCompleted(event.result);
      es.close();
    } else if (event.type === 'failed') {
      store.applyFailed(event.error);
      es.close();
    }
  };

  es.onerror = () => {
    // SSE will auto-reconnect; only mark failed if the job itself failed
    if (store.status !== 'completed') {
      store.applyFailed('Lost connection to server');
      es.close();
    }
  };

  onUnmounted(() => es.close());
}
