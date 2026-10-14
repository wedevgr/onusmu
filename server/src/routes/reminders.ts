import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { ctx, decryptText, encryptText } from '../lib/crypto';
import { AppError } from '../lib/errors';

const createSchema = z.object({
  text: z.string().trim().min(1).max(200),
  dueAt: z.coerce.date().nullable(),
});

const updateSchema = z.object({
  text: z.string().trim().min(1).max(200).optional(),
  dueAt: z.coerce.date().nullable().optional(),
  // 'pending' confirms a suggestion (or reopens a done reminder).
  status: z.enum(['pending', 'done', 'dismissed']).optional(),
});

interface ReminderRow {
  id: string;
  text: string;
  due_at: Date | null;
  status: string;
  source_chunk_id: string | null;
  created_at: Date;
}

const COLUMNS = 'id, text, due_at, status, source_chunk_id, created_at';

function toReminder(userId: string, row: ReminderRow) {
  return {
    id: row.id,
    text: decryptText(row.text, ctx.reminderText(userId, row.id)),
    dueAt: row.due_at,
    status: row.status,
    sourceChunkId: row.source_chunk_id,
    createdAt: row.created_at,
  };
}

export default async function reminderRoutes(app: FastifyInstance): Promise<void> {
  // Suggestions and open reminders, plus what was finished in the last week.
  app.get('/reminders', async (request) => {
    const rows = await query<ReminderRow>(
      `SELECT ${COLUMNS} FROM reminders
       WHERE user_id = $1
         AND (status IN ('suggested', 'pending')
              OR (status = 'done' AND updated_at > now() - interval '7 days'))
       ORDER BY due_at ASC NULLS LAST, created_at DESC
       LIMIT 300`,
      [request.userId],
    );
    return { reminders: rows.map((row) => toReminder(request.userId, row)) };
  });

  app.post('/reminders', async (request) => {
    const body = createSchema.parse(request.body);
    const id = randomUUID();
    const row = await queryOne<ReminderRow>(
      `INSERT INTO reminders (id, user_id, text, due_at, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING ${COLUMNS}`,
      [id, request.userId, encryptText(body.text, ctx.reminderText(request.userId, id)), body.dueAt],
    );
    if (!row) throw new AppError(500, 'Failed to create reminder');
    return toReminder(request.userId, row);
  });

  app.patch('/reminders/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = updateSchema.parse(request.body);
    const row = await queryOne<ReminderRow>(
      `UPDATE reminders SET
         text       = COALESCE($3, text),
         due_at     = CASE WHEN $4 THEN $5::timestamptz ELSE due_at END,
         status     = COALESCE($6, status),
         updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${COLUMNS}`,
      [
        id,
        request.userId,
        body.text === undefined ? null : encryptText(body.text, ctx.reminderText(request.userId, id)),
        body.dueAt !== undefined,
        body.dueAt ?? null,
        body.status ?? null,
      ],
    );
    if (!row) throw new AppError(404, 'Reminder not found');
    return toReminder(request.userId, row);
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
