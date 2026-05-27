import { getSonarClient } from '../sonarClient.js';
import type { SonarCETask } from '@devops-risk-analyzer/shared';

const POLL_INTERVAL_MS = 3_000;
const MAX_RETRIES = 40; // 2-minute ceiling

interface CETaskResponse {
  task: {
    id: string;
    status: SonarCETask['status'];
    errorMessage?: string;
    analysisId?: string;
  };
}

/**
 * Poll the SonarQube CE task endpoint until the task reaches a terminal state.
 * Throws on FAILED, CANCELLED, or timeout.
 */
export async function pollSonarTask(ceTaskId: string): Promise<void> {
  const client = getSonarClient();
  console.log(`[sonar-poll] polling task ${ceTaskId} (max ${MAX_RETRIES} attempts, ${POLL_INTERVAL_MS}ms interval)`);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { data } = await client.get<CETaskResponse>('/api/ce/task', {
      params: { id: ceTaskId },
    });

    const { status, errorMessage } = data.task;
    console.debug(`[sonar-poll] attempt ${attempt + 1}/${MAX_RETRIES} — status=${status}`);

    if (status === 'SUCCESS') {
      console.log(`[sonar-poll] task ${ceTaskId} succeeded`);
      return;
    }

    if (status === 'FAILED') {
      console.error(`[sonar-poll] task ${ceTaskId} failed: ${errorMessage ?? 'unknown error'}`);
      throw new Error(`SonarQube analysis failed: ${errorMessage ?? 'unknown error'}`);
    }

    if (status === 'CANCELLED') {
      console.error(`[sonar-poll] task ${ceTaskId} was cancelled`);
      throw new Error('SonarQube analysis was cancelled');
    }

    // PENDING or IN_PROGRESS — wait and retry
    await sleep(POLL_INTERVAL_MS);
  }

  console.error(`[sonar-poll] task ${ceTaskId} timed out after ${(MAX_RETRIES * POLL_INTERVAL_MS) / 1000}s`);
  throw new Error(
    `SonarQube task ${ceTaskId} did not complete within ${(MAX_RETRIES * POLL_INTERVAL_MS) / 1000}s`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
