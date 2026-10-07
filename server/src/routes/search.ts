import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';

const searchSchema = z.object({
  q: z.string().min(1).max(300),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export default async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/search', async (request) => {
    const params = searchSchema.parse(request.query);
    const rows = await query<{
      id: string;
      session_id: string;
      text: string;
      started_at: Date;
      ended_at: Date;
      score: number;
    }>(
      `SELECT * FROM search_chunks_text($1, $2, $3::timestamptz, $4::timestamptz, $5)`,
      [
        request.userId,
        params.q,
        params.from ? params.from.toISOString() : null,
        params.to ? params.to.toISOString() : null,
        params.limit,
      ],
    );
    return {
      results: rows.map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        text: r.text,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        score: typeof r.score === 'string' ? parseFloat(r.score) : r.score,
      })),
    };
  });
}
