import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { markInsightsSeen, undoInsight, unseenInsights } from '../lib/insights';

const seenSchema = z.object({ chunkIds: z.array(z.string().uuid()).min(1).max(50) });
const undoSchema = z.object({ chunkId: z.string().uuid(), index: z.number().int().min(0).max(20) });

export default async function insightRoutes(app: FastifyInstance): Promise<void> {
  // What recent recordings were understood as, until the user dismisses it.
  app.get('/insights', async (request) => {
    const recordings = await unseenInsights(request.userId);
    return {
      recordings: recordings.map((r) => ({ ...r, startedAt: r.startedAt.toISOString() })),
    };
  });

  app.post('/insights/seen', async (request) => {
    const body = seenSchema.parse(request.body);
    await markInsightsSeen(request.userId, body.chunkIds);
    return { ok: true };
  });

  app.post('/insights/undo', async (request) => {
    const body = undoSchema.parse(request.body);
    const items = await undoInsight(request.userId, body.chunkId, body.index);
    return { items };
  });
}
