import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { AnalyzeJobData, TimelineJobData, TimelineResult } from '@devops-risk-analyzer/shared';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // required by BullMQ
});

redis.on('error', (err) => {
  console.error('[redis] connection error:', err.message);
});

export const analysisQueue = new Queue<AnalyzeJobData>('analysis', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86_400 }, // keep results 24h
    removeOnFail: { age: 86_400 },
  },
});

export const timelineQueue = new Queue<TimelineJobData, TimelineResult>('timeline', {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86_400 },
    removeOnFail: { age: 86_400 },
  },
});
