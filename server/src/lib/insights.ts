import type { PoolClient } from 'pg';
import { query, queryOne } from '../db';
import { AppError } from './errors';
import { ctx, decryptText, encryptText } from './crypto';
import { describeRepeat, type Repeat } from './recurrence';
import type { FactData, FactKind } from './understand';

/**
 * What the backend understood from one recording, shown back to the user so they can see it
 * worked and undo a mistake: tasks created, tasks closed, debts settled, money and readings.
 * Stored encrypted on the chunk (transcript_chunks.insights) with ids to undo each item.
 */

export type InsightType = 'task' | 'done' | 'stopped' | 'settled' | FactKind;

export interface Insight {
  type: InsightType;
  /** Ready-to-show Greek line, e.g. "Έξοδο 70,00 € · Σέρβις Auris". */
  label: string;
  /** reminders.id for task/done/stopped, memory_facts.id for the rest. */
  refId: string;
  undone?: boolean;
  /** A repeating task or payment that moved on: its due date before, so undo can put it back. */
  previousDue?: string | null;
}

/** What finishing or paying did: for a repeating one, its next date and the one before. */
export interface Advance {
  next: Date | null;
  previousDue: Date | null;
}

function money(amount: number | null, currency: string | null): string {
  if (amount === null) return '';
  try {
    return new Intl.NumberFormat('el-GR', { style: 'currency', currency: currency ?? 'EUR' }).format(amount);
  } catch {
    return `${amount} ${currency ?? ''}`.trim();
  }
}

function shortDate(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat('el-GR', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

export function taskInsight(
  id: string,
  text: string,
  suggested: boolean,
  due: Date | null,
  timezone: string,
  repeat: Repeat | null = null,
): Insight {
  const when = repeat ? ` · ${describeRepeat(repeat)}` : due ? ` · ${shortDate(due, timezone)}` : '';
  const kind = repeat ? 'επαναλαμβανόμενη ' : '';
  return {
    type: 'task',
    label: `${suggested ? `Πρόταση ${kind}εκκρεμότητας` : `Νέα ${kind}εκκρεμότητα`}: ${text}${when}`,
    refId: id,
  };
}

export function doneInsight(id: string, text: string, advance: Advance, timezone: string): Insight {
  if (advance.next) {
    return {
      type: 'done',
      label: `Έγινε: ${text} · επόμενη ${shortDate(advance.next, timezone)}`,
      refId: id,
      previousDue: advance.previousDue?.toISOString() ?? null,
    };
  }
  return { type: 'done', label: `Ολοκληρώθηκε: ${text}`, refId: id };
}

export function stoppedInsight(id: string, text: string): Insight {
  return { type: 'stopped', label: `Σταμάτησε: ${text}`, refId: id };
}

export function settledInsight(id: string, data: FactData, advance: Advance, timezone: string): Insight {
  const amount = money(data.amount, data.currency);
  if (advance.next) {
    return {
      type: 'settled',
      label: `Πληρώθηκε: ${data.text} ${amount} · επόμενη ${shortDate(advance.next, timezone)}`,
      refId: id,
      previousDue: advance.previousDue?.toISOString() ?? null,
    };
  }
  return { type: 'settled', label: `Εξοφλήθηκε: ${data.text} ${amount}`.trim(), refId: id };
}

export function factInsight(
  id: string,
  kind: FactKind,
  data: FactData,
  due: Date | null,
  timezone: string,
  repeat: Repeat | null = null,
): Insight {
  const amount = money(data.amount, data.currency);
  const until = repeat ? ` · ${describeRepeat(repeat)}` : due ? ` · έως ${shortDate(due, timezone)}` : '';
  const label =
    kind === 'expense'
      ? `Έξοδο ${amount} · ${data.text}${data.paidBy === 'other' ? ' · πλήρωσε άλλος' : ''}`
      : kind === 'income'
        ? `Έσοδο ${amount} · ${data.text}`
        : kind === 'debt'
          ? `Οφειλή ${amount} · ${data.text}${until}`
          : kind === 'receivable'
            ? `Σου χρωστάνε ${amount} · ${data.text}${until}`
            : `${data.item ?? data.text}: ${data.value?.toLocaleString('el-GR')} ${data.unit ?? ''}`.trim();
  return { type: kind, label, refId: id };
}

/** Saves the chunk's insights; quiet ones (re-read old recordings) are marked as already seen. */
export async function saveInsights(
  client: PoolClient,
  userId: string,
  chunkId: string,
  items: Insight[],
  quiet: boolean,
): Promise<void> {
  await client.query(
    `UPDATE transcript_chunks SET insights = $3, insights_seen_at = $4 WHERE id = $1 AND user_id = $2`,
    [
      chunkId,
      userId,
      items.length > 0 ? encryptText(JSON.stringify(items), ctx.chunkInsights(userId, chunkId)) : null,
      quiet || items.length === 0 ? new Date().toISOString() : null,
    ],
  );
}

export function readInsights(userId: string, chunkId: string, value: string | null): Insight[] {
  if (!value) return [];
  try {
    return JSON.parse(decryptText(value, ctx.chunkInsights(userId, chunkId))) as Insight[];
  } catch {
    return [];
  }
}

export interface UnseenInsights {
  chunkId: string;
  sessionId: string;
  startedAt: Date;
  items: Insight[];
}

/** Recordings of the last few days with insights the user has not dismissed yet. */
export async function unseenInsights(userId: string): Promise<UnseenInsights[]> {
  const rows = await query<{ id: string; session_id: string; started_at: Date; insights: string }>(
    `SELECT id, session_id, started_at, insights FROM transcript_chunks
     WHERE user_id = $1 AND insights IS NOT NULL AND insights_seen_at IS NULL
       AND started_at > now() - interval '3 days'
     ORDER BY started_at DESC LIMIT 20`,
    [userId],
  );
  return rows
    .map((r) => ({
      chunkId: r.id,
      sessionId: r.session_id,
      startedAt: r.started_at,
      items: readInsights(userId, r.id, r.insights),
    }))
    .filter((r) => r.items.length > 0);
}

export async function markInsightsSeen(userId: string, chunkIds: string[]): Promise<void> {
  await query(
    `UPDATE transcript_chunks SET insights_seen_at = now()
     WHERE user_id = $1 AND id = ANY($2::uuid[]) AND insights_seen_at IS NULL`,
    [userId, chunkIds],
  );
}

/** Reverses one item: removes a created task or fact, reopens a closed task, unsettles a debt. */
export async function undoInsight(userId: string, chunkId: string, index: number): Promise<Insight[]> {
  const row = await queryOne<{ insights: string | null }>(
    `SELECT insights FROM transcript_chunks WHERE id = $1 AND user_id = $2`,
    [chunkId, userId],
  );
  if (!row) throw new AppError(404, 'Recording not found');
  const items = readInsights(userId, chunkId, row.insights);
  const item = items[index];
  if (!item) throw new AppError(404, 'Nothing to undo');
  if (item.undone) return items;

  if (item.type === 'task') {
    await query(`UPDATE reminders SET status = 'dismissed', updated_at = now() WHERE id = $1 AND user_id = $2`, [
      item.refId,
      userId,
    ]);
  } else if (item.type === 'done' && item.previousDue !== undefined) {
    // A repeating task that moved on goes back to the date it had.
    await query(`UPDATE reminders SET due_at = $3, status = 'pending', updated_at = now() WHERE id = $1 AND user_id = $2`, [
      item.refId,
      userId,
      item.previousDue,
    ]);
  } else if (item.type === 'done') {
    await query(
      `UPDATE reminders SET status = 'pending', updated_at = now() WHERE id = $1 AND user_id = $2 AND status = 'done'`,
      [item.refId, userId],
    );
  } else if (item.type === 'stopped') {
    await query(
      `UPDATE reminders SET status = 'pending', updated_at = now() WHERE id = $1 AND user_id = $2 AND status = 'dismissed'`,
      [item.refId, userId],
    );
  } else if (item.type === 'settled' && item.previousDue !== undefined) {
    await query(`UPDATE memory_facts SET due_at = $3 WHERE id = $1 AND user_id = $2`, [
      item.refId,
      userId,
      item.previousDue,
    ]);
  } else if (item.type === 'settled') {
    const fact = await queryOne<{ data: string }>(`SELECT data FROM memory_facts WHERE id = $1 AND user_id = $2`, [
      item.refId,
      userId,
    ]);
    if (fact) {
      const data = JSON.parse(decryptText(fact.data, ctx.factData(userId, item.refId))) as FactData;
      await query(`UPDATE memory_facts SET data = $3 WHERE id = $1 AND user_id = $2`, [
        item.refId,
        userId,
        encryptText(JSON.stringify({ ...data, settled: false }), ctx.factData(userId, item.refId)),
      ]);
    }
  } else {
    await query(`DELETE FROM memory_facts WHERE id = $1 AND user_id = $2`, [item.refId, userId]);
  }

  items[index] = { ...item, undone: true };
  await query(`UPDATE transcript_chunks SET insights = $3 WHERE id = $1 AND user_id = $2`, [
    chunkId,
    userId,
    encryptText(JSON.stringify(items), ctx.chunkInsights(userId, chunkId)),
  ]);
  return items;
}
