import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { requireAuth } from './auth';
import { config } from './config';
import { AppError } from './lib/errors';
import accountRoutes from './routes/account';
import billingRoutes from './routes/billing';
import chatRoutes from './routes/chat';
import chunkRoutes from './routes/chunks';
import reminderRoutes from './routes/reminders';
import termRoutes from './routes/terms';
import insightRoutes from './routes/insights';
import searchRoutes from './routes/search';
import sessionRoutes from './routes/sessions';
import stripeWebhookRoutes from './routes/stripeWebhook';
import settingsRoutes from './routes/settings';
import signupRoutes from './routes/signup';
import suggestionRoutes from './routes/suggestions';
import uploadRoutes from './routes/uploads';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      serializers: {
        // Query strings can carry user content (e.g. /v1/search?q=...); keep them out of the logs.
        req: (req) => ({ method: req.method, url: req.url.split('?')[0] }),
      },
    },
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    if (err instanceof ZodError) {
      const message = err.issues[0]
        ? `${err.issues[0].path.join('.')}: ${err.issues[0].message}`
        : 'Invalid request';
      return reply.code(400).send({ error: message });
    }
    const errCode = (err as { code?: string }).code;
    if (errCode === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: `File exceeds ${config.MAX_UPLOAD_MB}MB limit` });
    }
    request.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/healthz', async () => ({ ok: true }));
  await app.register(stripeWebhookRoutes);
  await app.register(signupRoutes, { prefix: '/v1' });

  await app.register(
    async (authed) => {
      authed.addHook('preHandler', requireAuth);
      await authed.register(sessionRoutes);
      await authed.register(uploadRoutes);
      await authed.register(chunkRoutes);
      await authed.register(searchRoutes);
      await authed.register(chatRoutes);
      await authed.register(settingsRoutes);
      await authed.register(suggestionRoutes);
      await authed.register(accountRoutes);
      await authed.register(billingRoutes);
      await authed.register(reminderRoutes);
      await authed.register(termRoutes);
      await authed.register(insightRoutes);
    },
    { prefix: '/v1' },
  );

  return app;
}
