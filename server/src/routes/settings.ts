import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queryOne } from '../db';
import { buildBriefings } from '../lib/briefing';
import { getUserTimezone } from '../lib/rag';
import { isValidTimezone } from '../lib/zonedtime';

const settingsSchema = z.object({
  keepAudio: z.boolean().optional(),
  autoReminders: z.boolean().optional(),
  briefingEnabled: z.boolean().optional(),
  briefingTime: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
    .optional(),
});

interface SettingsRow {
  keep_audio: boolean;
  auto_reminders: boolean;
  briefing_enabled: boolean;
  briefing_time: string;
}

const COLUMNS = 'keep_audio, auto_reminders, briefing_enabled, briefing_time';

function toSettings(row: SettingsRow | null) {
  return {
    keepAudio: row?.keep_audio ?? false,
    autoReminders: row?.auto_reminders ?? false,
    briefingEnabled: row?.briefing_enabled ?? true,
    briefingTime: row?.briefing_time ?? '08:30',
  };
}

const timezoneSchema = z.object({
  timezone: z.string().max(64).refine(isValidTimezone, 'Unknown timezone'),
});

export default async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // The morning briefings for today and the next days; the app schedules them at briefingTime.
  app.get('/briefing', async (request) => {
    const timezone = await getUserTimezone(request.userId);
    return { briefings: await buildBriefings(request.userId, timezone) };
  });

  app.get('/settings', async (request) => {
    const row = await queryOne<SettingsRow>(`SELECT ${COLUMNS} FROM user_settings WHERE user_id = $1`, [
      request.userId,
    ]);
    return toSettings(row);
  });

  // Partial update: fields left out keep their current value.
  app.put('/settings', async (request) => {
    const body = settingsSchema.parse(request.body);
    const row = await queryOne<SettingsRow>(
      `INSERT INTO user_settings (user_id, keep_audio, auto_reminders, briefing_enabled, briefing_time)
       VALUES ($1, COALESCE($2::boolean, false), COALESCE($3::boolean, false),
               COALESCE($4::boolean, true), COALESCE($5::text, '08:30'))
       ON CONFLICT (user_id) DO UPDATE SET
         keep_audio       = COALESCE($2::boolean, user_settings.keep_audio),
         auto_reminders   = COALESCE($3::boolean, user_settings.auto_reminders),
         briefing_enabled = COALESCE($4::boolean, user_settings.briefing_enabled),
         briefing_time    = COALESCE($5::text, user_settings.briefing_time),
         updated_at       = now()
       RETURNING ${COLUMNS}`,
      [
        request.userId,
        body.keepAudio ?? null,
        body.autoReminders ?? null,
        body.briefingEnabled ?? null,
        body.briefingTime ?? null,
      ],
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
