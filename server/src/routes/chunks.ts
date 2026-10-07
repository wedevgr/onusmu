import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { AppError } from '../lib/errors';
import { removeAudio, signedAudioUrl } from '../lib/storage';

const listChunksSchema = z.object({
  sessionId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

export default async function chunkRoutes(app: FastifyInstance): Promise<void> {
  app.get('/chunks', async (request) => {
    const params = listChunksSchema.parse(request.query);
    const rows = await query<{
      id: string;
      sessionId: string;
      text: string;
      startedAt: Date;
      endedAt: Date;
      processingStatus: string;
      createdAt: Date;
    }>(
      `SELECT id,
              session_id        AS "sessionId",
              text,
              started_at        AS "startedAt",
              ended_at          AS "endedAt",
              processing_status AS "processingStatus",
              created_at        AS "createdAt"
       FROM transcript_chunks
       WHERE user_id = $1
         AND ($2::uuid IS NULL OR session_id = $2)
         AND ($3::timestamptz IS NULL OR started_at >= $3)
         AND ($4::timestamptz IS NULL OR started_at <= $4)
       ORDER BY started_at DESC
       LIMIT $5 OFFSET $6`,
      [
        request.userId,
        params.sessionId ?? null,
        params.from ? params.from.toISOString() : null,
        params.to ? params.to.toISOString() : null,
        params.limit,
        params.offset,
      ],
    );
    return { chunks: rows };
  });

  app.get('/chunks/:id/audio', async (request) => {
    const { id } = request.params as { id: string };
    const chunk = await queryOne<{ audio_path: string | null }>(
      `SELECT audio_path FROM transcript_chunks WHERE id = $1 AND user_id = $2`,
      [id, request.userId],
    );
    if (!chunk) throw new AppError(404, 'Chunk not found');
    if (!chunk.audio_path) throw new AppError(404, 'Audio was deleted (retention setting)');
    const url = await signedAudioUrl(chunk.audio_path);
    if (!url) throw new AppError(404, 'Audio not available');
    return { url };
  });

  app.delete('/chunks/:id', async (request) => {
    const { id } = request.params as { id: string };
    const chunk = await queryOne<{ audio_path: string | null }>(
      `DELETE FROM transcript_chunks WHERE id = $1 AND user_id = $2 RETURNING audio_path`,
      [id, request.userId],
    );
    if (!chunk) throw new AppError(404, 'Chunk not found');
    if (chunk.audio_path) await removeAudio(chunk.audio_path).catch(() => undefined);
    return { ok: true };
  });

  app.delete('/sessions/:id', async (request) => {
    const { id } = request.params as { id: string };
    const paths = await query<{ audio_path: string }>(
      `SELECT audio_path FROM transcript_chunks WHERE session_id = $1 AND user_id = $2 AND audio_path IS NOT NULL`,
      [id, request.userId],
    );
    const session = await queryOne<{ id: string }>(
      `DELETE FROM recording_sessions WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, request.userId],
    );
    if (!session) throw new AppError(404, 'Session not found');
    // Chunks and their jobs cascade-delete; purge audio objects best-effort.
    for (const p of paths) {
      await removeAudio(p.audio_path).catch(() => undefined);
    }
    return { ok: true };
  });
}
