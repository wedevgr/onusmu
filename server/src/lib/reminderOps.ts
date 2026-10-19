import type { Pool, PoolClient } from 'pg';
import { localDay, nextOccurrence, parseRepeat, type Repeat } from './recurrence';

type Db = Pool | PoolClient;

export interface Completion {
  /** For a repeating task: its next date. Null when it is now closed. */
  next: Date | null;
  /** The due date before, so an undo can put it back. */
  previousDue: Date | null;
}

/**
 * Marks a task done. A repeating one moves on to its next occurrence instead of closing:
 * after its due date when finished early, after now when finished late, so missed days do
 * not pile up. Returns null when the task is not open.
 */
export async function completeReminder(
  db: Db,
  userId: string,
  id: string,
  timezone: string,
  now: Date = new Date(),
): Promise<Completion | null> {
  const { rows } = await db.query<{ due_at: Date | null; repeat: Repeat | null }>(
    `SELECT due_at, repeat FROM reminders
     WHERE id = $1 AND user_id = $2 AND status IN ('suggested', 'pending')`,
    [id, userId],
  );
  const row = rows[0];
  if (!row) return null;

  const next = row.repeat
    ? nextOccurrence(row.repeat, row.due_at && row.due_at > now ? row.due_at : now, timezone)
    : null;
  if (next) {
    await db.query(
      `UPDATE reminders SET due_at = $3, status = 'pending', last_done_at = $4, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [id, userId, next.toISOString(), now.toISOString()],
    );
  } else {
    await db.query(
      `UPDATE reminders SET status = 'done', last_done_at = $3, updated_at = now() WHERE id = $1 AND user_id = $2`,
      [id, userId, now.toISOString()],
    );
  }
  return { next, previousDue: row.due_at };
}

/**
 * The rule for a repeat chosen in the app, where only the frequency may be given: the rest
 * comes from the task's date ("Κάθε εβδομάδα" on a Monday 09:00 task is every Monday 09:00).
 */
export function ruleFromInput(input: Record<string, unknown>, anchor: Date, timezone: string): Repeat | null {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(anchor);
  return parseRepeat({ time, ...input }, localDay(anchor, timezone));
}
