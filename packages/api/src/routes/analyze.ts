import type { FastifyInstance } from 'fastify';
import { QueueEvents } from 'bullmq';
import { analysisQueue, redis } from '../queue.js';
import { findAnalysis } from '@devops-risk-analyzer/db';
import type {
  AnalyzeRequest,
  ApiResponse,
  ApiErrorBody,
  JobResource,
  AnalyzeResponseData,
} from '@devops-risk-analyzer/shared';

const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/** Derive a SonarQube-safe project key from a GitHub repo URL. */
function deriveProjectKey(repoUrl: string): string {
  const path = repoUrl.replace('https://github.com/', '');
  return path
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '_')
    .slice(0, 200);
}

function apiError(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
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
            commitSha: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { repoUrl, githubToken, commitSha } = request.body;

      if (!GITHUB_URL_PATTERN.test(repoUrl)) {
        return reply
          .status(400)
          .send(apiError('BAD_REQUEST', 'Invalid GitHub repository URL'));
      }

      if (commitSha !== undefined && !COMMIT_SHA_PATTERN.test(commitSha)) {
        return reply
          .status(400)
          .send(apiError('BAD_REQUEST', 'commitSha must be a 7–40 character hex string'));
      }

      // Cache check: only possible when the caller supplies an explicit commit SHA
      if (commitSha) {
        const cached = await findAnalysis(repoUrl, commitSha).catch(() => null);
        if (cached) {
          const body: ApiResponse<AnalyzeResponseData> = {
            data: {
              cached: true,
              repoUrl,
              commitSha,
              result: cached.result,
            },
          };
          return reply.status(200).send(body);
        }
      }

      const projectKey = deriveProjectKey(repoUrl);
      const submittedAt = new Date().toISOString();

      const job = await analysisQueue.add('analyze', {
        repoUrl,
        projectKey,
        submittedAt,
        commitSha,
        ...(githubToken ? { githubToken } : {}),
      });

      const body: ApiResponse<AnalyzeResponseData> = {
        data: {
          cached: false,
          id: job.id!,
          status: 'waiting',
          repoUrl,
          commitSha,
          createdAt: submittedAt,
        },
      };

      return reply.status(202).send(body);
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
        return reply
          .status(404)
          .send(apiError('NOT_FOUND', 'Job not found'));
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
      const jobData = job.data;

      const resource: JobResource = {
        id: job.id!,
        status,
        repoUrl: jobData.repoUrl,
        commitSha: jobData.commitSha,
        createdAt: new Date(job.timestamp).toISOString(),
        ...(job.processedOn
          ? { startedAt: new Date(job.processedOn).toISOString() }
          : {}),
        ...(job.finishedOn
          ? { finishedAt: new Date(job.finishedOn).toISOString() }
          : {}),
        ...(state === 'completed' ? {
          result: typeof job.returnvalue === 'string'
            ? JSON.parse(job.returnvalue)
            : job.returnvalue,
        } : {}),
        ...(state === 'failed' ? { error: job.failedReason } : {}),
      };

      const body: ApiResponse<JobResource> = { data: resource };
      return reply.send(body);
    },
  );

  // GET /jobs/:id/stream  — Server-Sent Events for real-time job progress
  app.get<{ Params: { id: string } }>(
    '/jobs/:id/stream',
    async (request, reply) => {
      const { id } = request.params;

      const job = await analysisQueue.getJob(id);
      if (!job) {
        return reply
          .status(404)
          .send(apiError('NOT_FOUND', 'Job not found'));
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

      const queueEvents = new QueueEvents('analysis', { connection: redis.duplicate() });

      const onProgress = ({ jobId, data }: { jobId: string; data: unknown }): void => {
        if (jobId !== id) return;
        send({ type: 'progress', progress: data });
      };

      const onCompleted = async ({ jobId }: { jobId: string }): Promise<void> => {
        if (jobId !== id) return;
        const completed = await analysisQueue.getJob(jobId);
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
