import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queryOne } from '../db';
import { isValidTimezone } from '../lib/zonedtime';

const settingsSchema = z.object({
  keepAudio: z.boolean().optional(),
  autoReminders: z.boolean().optional(),
});

interface SettingsRow {
  keep_audio: boolean;
  auto_reminders: boolean;
}

function toSettings(row: SettingsRow | null) {
  return { keepAudio: row?.keep_audio ?? false, autoReminders: row?.auto_reminders ?? false };
}

const timezoneSchema = z.object({
  timezone: z.string().max(64).refine(isValidTimezone, 'Unknown timezone'),
});

export default async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings', async (request) => {
    const row = await queryOne<SettingsRow>(
      `SELECT keep_audio, auto_reminders FROM user_settings WHERE user_id = $1`,
      [request.userId],
    );
    return toSettings(row);
  });

  // Partial update: fields left out keep their current value.
  app.put('/settings', async (request) => {
    const body = settingsSchema.parse(request.body);
    const row = await queryOne<SettingsRow>(
      `INSERT INTO user_settings (user_id, keep_audio, auto_reminders)
       VALUES ($1, COALESCE($2::boolean, false), COALESCE($3::boolean, false))
       ON CONFLICT (user_id) DO UPDATE SET
         keep_audio     = COALESCE($2::boolean, user_settings.keep_audio),
         auto_reminders = COALESCE($3::boolean, user_settings.auto_reminders),
         updated_at     = now()
       RETURNING keep_audio, auto_reminders`,
      [request.userId, body.keepAudio ?? null, body.autoReminders ?? null],
    );
    return toSettings(row);
  });

  // The app reports its timezone so spoken times ("tomorrow at 5") resolve correctly.
  app.put('/settings/timezone', async (request) => {
    const body = timezoneSchema.parse(request.body);
    await queryOne(
      `INSERT INTO user_settings (user_id, timezone)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         timezone = EXCLUDED.timezone,
         updated_at = now()`,
      [request.userId, body.timezone],
    );
    return { ok: true };
  });
}
