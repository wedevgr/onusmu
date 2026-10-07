import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { AppError } from '../lib/errors';

const createSessionSchema = z.object({
  clientId: z.string().min(1).max(64),
  startedAt: z.coerce.date(),
});

const stopSessionSchema = z.object({
  endedAt: z.coerce.date(),
});

export default async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/sessions', async (request) => {
    const body = createSessionSchema.parse(request.body);
    const row = await queryOne<{ id: string; client_id: string; started_at: Date; status: string }>(
      `INSERT INTO recording_sessions (user_id, client_id, started_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, client_id) DO UPDATE SET
         started_at = LEAST(recording_sessions.started_at, EXCLUDED.started_at)
       RETURNING id, client_id, started_at, status`,
      [request.userId, body.clientId, body.startedAt.toISOString()],
    );
    if (!row) throw new AppError(500, 'Failed to create session');
    return {
      id: row.id,
      clientId: row.client_id,
      startedAt: row.started_at,
      status: row.status,
    };
  });

  app.post('/sessions/:clientId/stop', async (request) => {
    const { clientId } = request.params as { clientId: string };
    const body = stopSessionSchema.parse(request.body);
    const row = await queryOne<{ id: string; status: string; duration_seconds: number | null }>(
      `UPDATE recording_sessions
       SET status = 'closed',
           ended_at = $3,
           duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM ($3::timestamptz - started_at))::int)
       WHERE user_id = $1 AND client_id = $2
       RETURNING id, status, duration_seconds`,
      [request.userId, clientId, body.endedAt.toISOString()],
    );
    if (!row) throw new AppError(404, 'Session not found');
    return { id: row.id, status: row.status, durationSeconds: row.duration_seconds };
  });

  app.get('/sessions', async (request) => {
    const querystring = request.query as { from?: string; to?: string };
    const rows = await query<{
      id: string;
      clientId: string;
      startedAt: Date;
      endedAt: Date | null;
      durationSeconds: number | null;
      status: string;
      chunkCount: number;
    }>(
      `SELECT s.id,
              s.client_id        AS "clientId",
              s.started_at       AS "startedAt",
              s.ended_at         AS "endedAt",
              s.duration_seconds AS "durationSeconds",
              s.status,
              (SELECT count(*) FROM transcript_chunks c WHERE c.session_id = s.id)::int AS "chunkCount"
       FROM recording_sessions s
       WHERE s.user_id = $1
         AND ($2::timestamptz IS NULL OR s.started_at >= $2)
         AND ($3::timestamptz IS NULL OR s.started_at <= $3)
       ORDER BY s.started_at DESC
       LIMIT 200`,
      [request.userId, querystring.from ?? null, querystring.to ?? null],
    );
    return { sessions: rows };
  });
}
