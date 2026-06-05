import { createWorker } from './worker.js';
import { createTimelineWorker } from './timelineWorker.js';

console.log('[worker] starting...');

const worker = createWorker();
const timelineWorker = createTimelineWorker();

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] received ${signal}, shutting down gracefully...`);
  await Promise.all([worker.close(), timelineWorker.close()]);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(`[worker] ready, concurrency=${process.env.WORKER_CONCURRENCY ?? 2}`);
