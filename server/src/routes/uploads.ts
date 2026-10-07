import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { AppError } from '../lib/errors';
import { removeAudio, uploadAudio } from '../lib/storage';
import { enqueueJob } from '../queue/jobs';

const fieldsSchema = z.object({
  sessionId: z.string().min(1).max(64), // client-side session id
  chunkIndex: z.coerce.number().int().min(0),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date(),
});

export default async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/uploads', async (request) => {
    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      throw new AppError(400, 'Missing audio file (form field "file")');
    }
    const body = fieldsSchema.parse(fields);

    // Upsert session so uploads never fail just because the session row is missing.
    const session = await queryOne<{ id: string }>(
      `INSERT INTO recording_sessions (user_id, client_id, started_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, client_id) DO UPDATE SET
         started_at = LEAST(recording_sessions.started_at, EXCLUDED.started_at)
       RETURNING id`,
      [request.userId, body.sessionId, body.startedAt.toISOString()],
    );
    if (!session) throw new AppError(500, 'Failed to resolve session');

    const chunk = await queryOne<{ id: string }>(
      `INSERT INTO transcript_chunks (user_id, session_id, started_at, ended_at, processing_status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id`,
      [request.userId, session.id, body.startedAt.toISOString(), body.endedAt.toISOString()],
    );
    if (!chunk) throw new AppError(500, 'Failed to create chunk');

    const audioPath = `${request.userId}/${chunk.id}.m4a`;
    try {
      await uploadAudio(audioPath, fileBuffer);
      await query(`UPDATE transcript_chunks SET audio_path = $1 WHERE id = $2`, [audioPath, chunk.id]);
      await query(
        `UPDATE recording_sessions
         SET ended_at = CASE WHEN ended_at IS NULL THEN $2 ELSE GREATEST(ended_at, $2) END
         WHERE id = $1`,
        [session.id, body.endedAt.toISOString()],
      );
      await enqueueJob(chunk.id, request.userId);
    } catch (err) {
      // Roll back what we can; the chunk row stays so the client knows the upload failed.
      await removeAudio(audioPath).catch(() => undefined);
      await query(`DELETE FROM transcript_chunks WHERE id = $1`, [chunk.id]).catch(() => undefined);
      throw err;
    }

    return { chunkId: chunk.id, sessionId: session.id, status: 'pending' };
  });
}
