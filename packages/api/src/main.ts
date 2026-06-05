import Fastify from 'fastify';
import { migrate } from '@devops-risk-analyzer/db';
import { analyzeRoutes } from './routes/analyze.js';
import { timelineRoutes } from './routes/timeline.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

await migrate();

await app.register(analyzeRoutes);
await app.register(timelineRoutes);

app.get('/health', async () => ({ status: 'ok' }));

const port = parseInt(process.env.PORT ?? '3000', 10);

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
