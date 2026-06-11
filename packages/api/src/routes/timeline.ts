import type { FastifyInstance } from 'fastify';
import { QueueEvents } from 'bullmq';
import { timelineQueue, bullmqConnection } from '../queue.js';
import type {
  TimelineRequest,
  ApiResponse,
  ApiErrorBody,
  JobResource,
  TimelineResult,
} from '@devops-risk-analyzer/shared';

const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+$/;

function apiError(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

export async function timelineRoutes(app: FastifyInstance): Promise<void> {
  // POST /timeline
  app.post<{ Body: TimelineRequest }>(
    '/timeline',
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
            forceRefresh: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { repoUrl, githubToken, forceRefresh } = request.body;

      if (!GITHUB_URL_PATTERN.test(repoUrl)) {
        return reply
          .status(400)
          .send(apiError('BAD_REQUEST', 'Invalid GitHub repository URL'));
      }

      const submittedAt = new Date().toISOString();

      const job = await timelineQueue.add('timeline', {
        repoUrl,
        ...(githubToken ? { githubToken } : {}),
        ...(forceRefresh ? { forceRefresh: true } : {}),
      });

      const body: ApiResponse<Pick<JobResource, 'id' | 'status' | 'repoUrl' | 'createdAt'>> = {
        data: {
          id: job.id!,
          status: 'waiting',
          repoUrl,
          createdAt: submittedAt,
        },
      };

      return reply.status(202).send(body);
    },
  );

  // GET /timeline-jobs/:id
  app.get<{ Params: { id: string } }>(
    '/timeline-jobs/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const job = await timelineQueue.getJob(request.params.id);

      if (!job) {
        return reply.status(404).send(apiError('NOT_FOUND', 'Timeline job not found'));
      }

      const state = await job.getState();

      const statusMap: Record<string, JobResource['status']> = {
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

      const resource = {
        id: job.id!,
        status,
        repoUrl: job.data.repoUrl,
        createdAt: new Date(job.timestamp).toISOString(),
        ...(job.processedOn ? { startedAt: new Date(job.processedOn).toISOString() } : {}),
        ...(job.finishedOn ? { finishedAt: new Date(job.finishedOn).toISOString() } : {}),
        ...(state === 'completed'
          ? {
              result: typeof job.returnvalue === 'string'
                ? (JSON.parse(job.returnvalue) as TimelineResult)
                : (job.returnvalue as TimelineResult),
            }
          : {}),
        ...(state === 'failed' ? { error: job.failedReason } : {}),
      };

      return reply.send({ data: resource });
    },
  );

  // GET /timeline-jobs/:id/stream  — Server-Sent Events
  app.get<{ Params: { id: string } }>(
    '/timeline-jobs/:id/stream',
    async (request, reply) => {
      const { id } = request.params;

      const job = await timelineQueue.getJob(id);
      if (!job) {
        return reply.status(404).send(apiError('NOT_FOUND', 'Timeline job not found'));
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const send = (data: object): void => {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const initialState = await job.getState();
      if (initialState === 'completed') {
        const rv = job.returnvalue;
        send({ type: 'completed', result: typeof rv === 'string' ? JSON.parse(rv) : rv });
        reply.raw.end();
        return;
      }
      if (initialState === 'failed') {
        send({ type: 'failed', error: job.failedReason });
        reply.raw.end();
        return;
      }

      const queueEvents = new QueueEvents('timeline', { connection: bullmqConnection });

      const onProgress = ({ jobId, data }: { jobId: string; data: unknown }): void => {
        if (jobId !== id) return;
        send({ type: 'progress', progress: data });
      };

      const onCompleted = async ({ jobId }: { jobId: string }): Promise<void> => {
        if (jobId !== id) return;
        const completed = await timelineQueue.getJob(jobId);
        const rv = completed?.returnvalue ?? null;
        send({ type: 'completed', result: typeof rv === 'string' ? JSON.parse(rv) : rv });
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

      request.raw.on('close', teardown);
    },
  );
}
