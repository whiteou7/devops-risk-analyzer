import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { findDocContent, saveDocContent } from '@devops-risk-analyzer/db';

interface UploadedFile {
  name: string;
  content: string;
}

interface DocUploadBody {
  files: UploadedFile[];
}

interface DocUploadData {
  docHash: string;
  fileCount: number;
  totalChars: number;
}

export async function docsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: DocUploadBody }>(
    '/docs/upload',
    {
      schema: {
        body: {
          type: 'object',
          required: ['files'],
          properties: {
            files: {
              type: 'array',
              minItems: 1,
              maxItems: 50,
              items: {
                type: 'object',
                required: ['name', 'content'],
                properties: {
                  name:    { type: 'string', maxLength: 500 },
                  content: { type: 'string', maxLength: 500_000 },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { files } = request.body;

      // Sort by name for deterministic hashing
      const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));

      const combined = sorted
        .map(f => `=== ${f.name} ===\n${f.content}`)
        .join('\n\n');

      const docHash = crypto.createHash('sha256').update(combined).digest('hex');

      const existing = await findDocContent(docHash).catch(() => null);
      if (!existing) {
        await saveDocContent(docHash, combined, sorted.map(f => f.name));
      }

      const body: { data: DocUploadData } = {
        data: {
          docHash,
          fileCount: files.length,
          totalChars: combined.length,
        },
      };
      return reply.status(200).send(body);
    },
  );
}
