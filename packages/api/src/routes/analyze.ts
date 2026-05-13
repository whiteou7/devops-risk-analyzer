import type { FastifyInstance } from 'fastify';
import { QueueEvents } from 'bullmq';
import { analysisQueue, redis } from '../queue.js';
import type { AnalyzeRequest, JobResponse } from '@devops-risk-analyzer/shared';

const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+$/;

/** Derive a SonarQube-safe project key from a GitHub repo URL. */
function deriveProjectKey(repoUrl: string): string {
  // "https://github.com/owner/repo" → "owner_repo"
  const path = repoUrl.replace('https://github.com/', '');
  return path
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '_')
    .slice(0, 200);
}

export async function analyzeRoutes(app: FastifyInstance): Promise<void> {
  // POST /analyze
  app.post<{ Body: AnalyzeRequest }>(
    '/analyze',
    {
      schema: {
        body: {
          type: 'object',
          required: ['repoUrl'],
          properties: {
            repoUrl: {
              type: 'string',
              pattern: '^https://github\\.com/[^/]+/[^/]+$',
            },
            githubToken: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { repoUrl, githubToken } = request.body;

      if (!GITHUB_URL_PATTERN.test(repoUrl)) {
        return reply.status(400).send({ error: 'Invalid GitHub repository URL' });
      }

      const projectKey = deriveProjectKey(repoUrl);
      const submittedAt = new Date().toISOString();

      const job = await analysisQueue.add('analyze', {
        repoUrl,
        projectKey,
        submittedAt,
        ...(githubToken ? { githubToken } : {}),
      });

      const response: JobResponse = {
        jobId: job.id!,
        status: 'waiting',
        createdAt: submittedAt,
      };

      return reply.status(202).send(response);
    },
  );

  // GET /jobs/:id
  app.get<{ Params: { id: string } }>(
    '/jobs/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const job = await analysisQueue.getJob(request.params.id);

      if (!job) {
        return reply.status(404).send({ error: 'Job not found' });
      }

      const state = await job.getState();

      // Map BullMQ states to our JobStatus
      const statusMap: Record<string, JobResponse['status']> = {
        waiting: 'waiting',
        'waiting-children': 'waiting',
        prioritized: 'waiting',
        active: 'active',
        completed: 'completed',
        failed: 'failed',
        delayed: 'waiting',
        paused: 'waiting',
      };

      const status = statusMap[state] ?? 'waiting';

      const response: JobResponse = {
        jobId: job.id!,
        status,
        createdAt: new Date(job.timestamp).toISOString(),
        ...(job.processedOn
          ? { startedAt: new Date(job.processedOn).toISOString() }
          : {}),
        ...(job.finishedOn
          ? { finishedAt: new Date(job.finishedOn).toISOString() }
          : {}),
        ...(state === 'completed' ? { result: job.returnvalue } : {}),
        ...(state === 'failed' ? { error: job.failedReason } : {}),
      };

      return reply.send(response);
    },
  );

  // GET /jobs/:id/stream  — Server-Sent Events for real-time job progress
  app.get<{ Params: { id: string } }>(
    '/jobs/:id/stream',
    async (request, reply) => {
      const { id } = request.params;

      // Verify job exists before opening the stream
      const job = await analysisQueue.getJob(id);
      if (!job) {
        return reply.status(404).send({ error: 'Job not found' });
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // disable Nginx buffering
      });

      const send = (data: object): void => {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Check if already completed/failed before subscribing
      const initialState = await job.getState();
      if (initialState === 'completed') {
        send({ type: 'completed', result: job.returnvalue });
        reply.raw.end();
        return;
      }
      if (initialState === 'failed') {
        send({ type: 'failed', error: job.failedReason });
        reply.raw.end();
        return;
      }

      // Use a dedicated connection for QueueEvents (BullMQ requirement)
      const queueEvents = new QueueEvents('analysis', { connection: redis.duplicate() });

      const onProgress = ({ jobId, data }: { jobId: string; data: unknown }): void => {
        if (jobId !== id) return;
        send({ type: 'progress', progress: data });
      };

      const onCompleted = async ({ jobId }: { jobId: string }): Promise<void> => {
        if (jobId !== id) return;
        const completed = await analysisQueue.getJob(jobId);
        send({ type: 'completed', result: completed?.returnvalue ?? null });
        teardown();
      };

      const onFailed = ({ jobId, failedReason }: { jobId: string; failedReason: string }): void => {
        if (jobId !== id) return;
        send({ type: 'failed', error: failedReason });
        teardown();
      };

      const teardown = (): void => {
        queueEvents.off('progress', onProgress);
        queueEvents.off('completed', onCompleted);
        queueEvents.off('failed', onFailed);
        void queueEvents.close();
        if (!reply.raw.writableEnded) reply.raw.end();
      };

      queueEvents.on('progress', onProgress);
      queueEvents.on('completed', onCompleted);
      queueEvents.on('failed', onFailed);

      // Clean up if the client disconnects
      request.raw.on('close', teardown);
    },
  );
}
