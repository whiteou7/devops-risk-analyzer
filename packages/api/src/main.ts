import Fastify from 'fastify';
import { analyzeRoutes } from './routes/analyze.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

await app.register(analyzeRoutes);

// Health check
app.get('/health', async () => ({ status: 'ok' }));

const port = parseInt(process.env.PORT ?? '3000', 10);

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
