import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db';

const settingsSchema = z.object({
  keepAudio: z.boolean(),
});

export default async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings', async (request) => {
    const row = await queryOne<{ keep_audio: boolean }>(
      `SELECT keep_audio FROM user_settings WHERE user_id = $1`,
      [request.userId],
    );
    return { keepAudio: row?.keep_audio ?? false };
  });

  app.put('/settings', async (request) => {
    const body = settingsSchema.parse(request.body);
    const row = await queryOne<{ keep_audio: boolean }>(
      `INSERT INTO user_settings (user_id, keep_audio)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         keep_audio = EXCLUDED.keep_audio,
         updated_at = now()
       RETURNING keep_audio`,
      [request.userId, body.keepAudio],
    );
    return { keepAudio: row?.keep_audio ?? body.keepAudio };
  });
}
