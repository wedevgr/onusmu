import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, query, queryOne } from '../db';
import { ctx, decryptText, encryptText } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { getUserTimezone } from '../lib/rag';
import { completeReminder, ruleFromInput } from '../lib/reminderOps';
import { describeRepeat, nextOccurrence, scheduleCount, upcoming, type Repeat } from '../lib/recurrence';

// A repeat as the app sends it: only the frequency is required, the rest comes from the date.
const repeatSchema = z
  .object({
    freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(52).optional(),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    monthDay: z.number().int().min(1).max(31).optional(),
    time: z.string().optional(),
    until: z.string().optional(),
  })
  .nullable();

const createSchema = z.object({
  text: z.string().trim().min(1).max(200),
  dueAt: z.coerce.date().nullable(),
  repeat: repeatSchema.optional(),
});

const updateSchema = z.object({
  text: z.string().trim().min(1).max(200).optional(),
  dueAt: z.coerce.date().nullable().optional(),
  // 'pending' confirms a suggestion (or reopens a done reminder). 'done' on a repeating
  // reminder moves it to its next date.
  status: z.enum(['pending', 'done', 'dismissed']).optional(),
  // null stops the repeating.
  repeat: repeatSchema.optional(),
});

interface ReminderRow {
  id: string;
  text: string;
  due_at: Date | null;
  status: string;
  source_chunk_id: string | null;
  created_at: Date;
  repeat: Repeat | null;
}

const COLUMNS = 'id, text, due_at, status, source_chunk_id, created_at, repeat';

function toReminder(userId: string, row: ReminderRow, timezone: string) {
  const rule = row.repeat;
  return {
    id: row.id,
    text: decryptText(row.text, ctx.reminderText(userId, row.id)),
    dueAt: row.due_at,
    status: row.status,
    sourceChunkId: row.source_chunk_id,
    createdAt: row.created_at,
    repeat: rule,
    repeatLabel: rule ? describeRepeat(rule) : null,
    // The next dates to notify, starting with the due date; the phone schedules these.
    upcoming:
      rule && row.due_at && row.status === 'pending'
        ? [row.due_at, ...upcoming(rule, row.due_at, timezone, scheduleCount(rule) - 1)]
        : [],
  };
}

export default async function reminderRoutes(app: FastifyInstance): Promise<void> {
  // Suggestions and open reminders, plus what was finished in the last week.
  app.get('/reminders', async (request) => {
    const [rows, timezone] = await Promise.all([
      query<ReminderRow>(
        `SELECT ${COLUMNS} FROM reminders
         WHERE user_id = $1
           AND (status IN ('suggested', 'pending')
                OR (status = 'done' AND updated_at > now() - interval '7 days'))
         ORDER BY due_at ASC NULLS LAST, created_at DESC
         LIMIT 300`,
        [request.userId],
      ),
      getUserTimezone(request.userId),
    ]);
    return { reminders: rows.map((row) => toReminder(request.userId, row, timezone)) };
  });

  app.post('/reminders', async (request) => {
    const body = createSchema.parse(request.body);
    const timezone = await getUserTimezone(request.userId);
    const id = randomUUID();
    const rule = body.repeat ? ruleFromInput(body.repeat, body.dueAt ?? new Date(), timezone) : null;
    // A repeating reminder is due at its first occurrence.
    const dueAt = rule ? nextOccurrence(rule, new Date(Date.now() - 60_000), timezone) : body.dueAt;
    const row = await queryOne<ReminderRow>(
      `INSERT INTO reminders (id, user_id, text, due_at, status, repeat)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING ${COLUMNS}`,
      [
        id,
        request.userId,
        encryptText(body.text, ctx.reminderText(request.userId, id)),
        dueAt,
        rule ? JSON.stringify(rule) : null,
      ],
    );
    if (!row) throw new AppError(500, 'Failed to create reminder');
    return toReminder(request.userId, row, timezone);
  });

  app.patch('/reminders/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = updateSchema.parse(request.body);
    const userId = request.userId;
    const timezone = await getUserTimezone(userId);

    // Done goes through the shared path, which moves a repeating reminder on.
    if (body.status === 'done') {
      const done = await completeReminder(pool, userId, id, timezone);
      if (!done) {
        const exists = await queryOne(`SELECT id FROM reminders WHERE id = $1 AND user_id = $2`, [id, userId]);
        if (!exists) throw new AppError(404, 'Reminder not found');
      }
    }

    const current = await queryOne<ReminderRow>(`SELECT ${COLUMNS} FROM reminders WHERE id = $1 AND user_id = $2`, [
      id,
      userId,
    ]);
    if (!current) throw new AppError(404, 'Reminder not found');

    let repeatJson: string | null | undefined;
    let dueAt = body.dueAt;
    if (body.repeat === null) {
      repeatJson = null;
    } else if (body.repeat) {
      const rule = ruleFromInput(body.repeat, body.dueAt ?? current.due_at ?? new Date(), timezone);
      repeatJson = rule ? JSON.stringify(rule) : null;
      if (rule) dueAt = nextOccurrence(rule, new Date(Date.now() - 60_000), timezone);
    }

    const row = await queryOne<ReminderRow>(
      `UPDATE reminders SET
         text       = COALESCE($3, text),
         due_at     = CASE WHEN $4 THEN $5::timestamptz ELSE due_at END,
         status     = COALESCE($6, status),
         repeat     = CASE WHEN $7 THEN $8::jsonb ELSE repeat END,
         updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${COLUMNS}`,
      [
        id,
        userId,
        body.text === undefined ? null : encryptText(body.text, ctx.reminderText(userId, id)),
        dueAt !== undefined,
        dueAt ?? null,
        // 'done' was handled above.
        body.status && body.status !== 'done' ? body.status : null,
        repeatJson !== undefined,
        repeatJson ?? null,
      ],
    );
    if (!row) throw new AppError(404, 'Reminder not found');
    return toReminder(userId, row, timezone);
  });

  app.delete('/reminders/:id', async (request) => {
    const { id } = request.params as { id: string };
    const row = await queryOne<{ id: string }>(
      `DELETE FROM reminders WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, request.userId],
    );
    if (!row) throw new AppError(404, 'Reminder not found');
    return { ok: true };
  });
}
