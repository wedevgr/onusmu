import { query } from '../db';
import { ctx, decryptText } from './crypto';
import type { TimeRange } from './timeparse';
import { describeRepeat, perMonth, type Repeat } from './recurrence';
import type { FactData, FactKind } from './understand';
import { formatZonedGreek } from './zonedtime';

/**
 * The user's money and task records as text for the answer model, with totals computed here
 * so sums are exact. Each fact line is labeled [F n]; `sources[n - 1]` is the recording it
 * came from, for citations.
 */

export interface LedgerSource {
  chunkId: string;
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
}

export interface Ledger {
  text: string;
  sources: LedgerSource[];
}

interface FactRow {
  id: string;
  kind: FactKind;
  data: string;
  occurred_at: Date;
  due_at: Date | null;
  repeat: Repeat | null;
  chunk_id: string;
  session_id: string;
  started_at: Date;
  ended_at: Date;
}

// Without a time window, look back this far.
const DEFAULT_LOOKBACK_DAYS = 365;
const MAX_FACTS = 400;

function money(amount: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat('el-GR', { style: 'currency', currency: currency ?? 'EUR' }).format(amount);
  } catch {
    return `${amount.toLocaleString('el-GR')} ${currency ?? ''}`.trim();
  }
}

/** Sum per currency, e.g. "85,60 €" or "85,60 € και 20,00 $". */
function total(items: Array<{ amount: number | null; currency: string | null }>): string {
  const byCurrency = new Map<string, number>();
  for (const item of items) {
    if (item.amount === null) continue;
    const key = item.currency ?? 'EUR';
    byCurrency.set(key, (byCurrency.get(key) ?? 0) + item.amount);
  }
  if (byCurrency.size === 0) return money(0, 'EUR');
  return [...byCurrency.entries()].map(([c, sum]) => money(Math.round(sum * 100) / 100, c)).join(' και ');
}

export async function buildLedger(
  userId: string,
  range: TimeRange | null,
  timezone: string,
  now: Date = new Date(),
): Promise<Ledger> {
  const from = range?.from ?? new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 86400000);
  const to = range?.to ?? now;
  // Money owed either way is listed whatever the window, so "what do I owe" never misses an older one.
  const rows = await query<FactRow>(
    `SELECT f.id, f.kind, f.data, f.occurred_at, f.due_at, f.repeat, f.chunk_id,
            c.session_id, c.started_at, c.ended_at
     FROM memory_facts f JOIN transcript_chunks c ON c.id = f.chunk_id
     WHERE f.user_id = $1 AND ((f.occurred_at >= $2 AND f.occurred_at < $3) OR f.kind IN ('debt', 'receivable') OR f.repeat IS NOT NULL)
     ORDER BY f.occurred_at
     LIMIT ${MAX_FACTS}`,
    [userId, from.toISOString(), to.toISOString()],
  );
  const facts = rows.map((r) => ({
    ...r,
    d: JSON.parse(decryptText(r.data, ctx.factData(userId, r.id))) as FactData,
  }));

  const sources: LedgerSource[] = [];
  const label = (f: (typeof facts)[number]): string => {
    sources.push({ chunkId: f.chunk_id, sessionId: f.session_id, startedAt: f.started_at, endedAt: f.ended_at });
    return `[F${sources.length}] ${formatZonedGreek(f.occurred_at, timezone)}`;
  };
  const lines: string[] = [];
  const window = range
    ? `${formatZonedGreek(range.from, timezone)} έως ${formatZonedGreek(range.to, timezone)}`
    : `τις τελευταίες ${DEFAULT_LOOKBACK_DAYS} μέρες`;

  const inWindow = facts.filter((f) => f.occurred_at >= from && f.occurred_at < to);
  const expenses = inWindow.filter((f) => f.kind === 'expense');
  const mine = expenses.filter((f) => f.d.paidBy !== 'other');
  const byOthers = expenses.filter((f) => f.d.paidBy === 'other');
  lines.push(`ΕΞΟΔΑ (${window}):`);
  for (const f of expenses) {
    lines.push(
      `${label(f)} · ${money(f.d.amount ?? 0, f.d.currency)} · [${f.d.category ?? 'άλλο'}] ${f.d.text}` +
        `${f.d.who ? ` · σε: ${f.d.who}` : ''}${f.d.paidBy === 'other' ? ' · πλήρωσε άλλος' : ''}`,
    );
  }
  lines.push(
    `Σύνολο που πλήρωσε ο χρήστης: ${total(mine.map((f) => f.d))} (${mine.length} εγγραφές)` +
      (byOthers.length > 0 ? `. Πλήρωσαν άλλοι για τον χρήστη: ${total(byOthers.map((f) => f.d))}` : ''),
  );
  const categories = new Map<string, typeof mine>();
  for (const f of mine) {
    const key = f.d.category ?? 'άλλο';
    categories.set(key, [...(categories.get(key) ?? []), f]);
  }
  for (const [category, items] of categories) {
    lines.push(`Σύνολο κατηγορίας «${category}» (πλήρωσε ο χρήστης): ${total(items.map((f) => f.d))} (${items.length})`);
  }

  const income = inWindow.filter((f) => f.kind === 'income');
  if (income.length > 0) {
    lines.push('', `ΕΣΟΔΑ (${window}):`);
    for (const f of income) {
      lines.push(`${label(f)} · ${money(f.d.amount ?? 0, f.d.currency)} · ${f.d.text}${f.d.who ? ` · από: ${f.d.who}` : ''}`);
    }
    lines.push(`Σύνολο εσόδων: ${total(income.map((f) => f.d))}`);
  }

  const owed = (kind: 'debt' | 'receivable', title: string, counterpart: string, totalLabel: string): void => {
    const all = facts.filter((f) => f.kind === kind);
    if (all.length === 0) return;
    const open = all.filter((f) => !f.d.settled);
    lines.push('', title);
    for (const f of all) {
      lines.push(
        `${label(f)} · ${money(f.d.amount ?? 0, f.d.currency)} · ${f.d.text}${f.d.who ? ` · ${counterpart}: ${f.d.who}` : ''}` +
          `${f.due_at ? ` · έως ${formatZonedGreek(f.due_at, timezone)}` : ''}${f.d.settled ? ' · ΕΞΟΦΛΗΘΗΚΕ' : ''}`,
      );
    }
    lines.push(`${totalLabel}: ${total(open.map((f) => f.d))} (${open.length})`);
  };
  owed('debt', 'Ο ΧΡΗΣΤΗΣ ΧΡΩΣΤΑΕΙ / ΠΡΕΠΕΙ ΝΑ ΠΛΗΡΩΣΕΙ (όλα):', 'σε', 'Σύνολο ανοιχτών οφειλών του χρήστη');
  owed('receivable', 'ΧΡΩΣΤΑΝΕ ΣΤΟΝ ΧΡΗΣΤΗ (όλα):', 'από', 'Σύνολο που περιμένει να πάρει ο χρήστης');

  // Repeating payments, each with its rule and next date, and what they come to per month.
  const recurring = facts.filter((f) => f.repeat && (f.kind === 'debt' || f.kind === 'income' || f.kind === 'receivable'));
  if (recurring.length > 0) {
    lines.push('', 'ΠΑΓΙΑ (επαναλαμβανόμενες πληρωμές και έσοδα):');
    for (const f of recurring) {
      lines.push(
        `${label(f)} · ${f.kind === 'debt' ? 'πληρωμή' : 'έσοδο'} ${money(f.d.amount ?? 0, f.d.currency)} · ${f.d.text}` +
          ` · ${describeRepeat(f.repeat!)}${f.due_at ? ` · επόμενη ${formatZonedGreek(f.due_at, timezone)}` : ''}`,
      );
    }
    const monthly = (kind: 'debt' | 'income'): string =>
      total(
        recurring
          .filter((f) => (kind === 'debt' ? f.kind === 'debt' : f.kind !== 'debt'))
          .map((f) => ({ amount: (f.d.amount ?? 0) * perMonth(f.repeat!), currency: f.d.currency })),
      );
    lines.push(`Πάγια έξοδα ανά μήνα (κατά μέσο όρο): ${monthly('debt')}`);
    if (recurring.some((f) => f.kind !== 'debt')) lines.push(`Πάγια έσοδα ανά μήνα: ${monthly('income')}`);
  }

  // Readings: every value in order, then the latest per item.
  const measures = facts.filter((f) => f.kind === 'measure');
  if (measures.length > 0) {
    lines.push('', 'ΜΕΤΡΗΣΕΙΣ:');
    const latest = new Map<string, (typeof facts)[number]>();
    for (const f of measures) {
      lines.push(`${label(f)} · ${f.d.item ?? f.d.text}: ${f.d.value} ${f.d.unit ?? ''}`.trim());
      latest.set((f.d.item ?? f.d.text).toLowerCase(), f);
    }
    for (const f of latest.values()) {
      lines.push(`Τελευταία τιμή «${f.d.item ?? f.d.text}»: ${f.d.value} ${f.d.unit ?? ''}`.trim());
    }
  }

  const tasks = await query<{
    id: string;
    text: string;
    due_at: Date | null;
    status: string;
    updated_at: Date;
    repeat: Repeat | null;
  }>(
    `SELECT id, text, due_at, status, updated_at, repeat FROM reminders
     WHERE user_id = $1 AND (status IN ('suggested', 'pending')
       OR (status = 'done' AND updated_at > now() - interval '30 days'))
     ORDER BY status, due_at NULLS LAST LIMIT 100`,
    [userId],
  );
  const taskLine = (t: (typeof tasks)[number]): string =>
    `- ${decryptText(t.text, ctx.reminderText(userId, t.id))}` +
    (t.repeat
      ? ` (επαναλαμβάνεται: ${describeRepeat(t.repeat)}${t.due_at ? `, επόμενη ${formatZonedGreek(t.due_at, timezone)}` : ''})`
      : t.due_at
        ? ` (έως ${formatZonedGreek(t.due_at, timezone)})`
        : '');
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const doneTasks = tasks.filter((t) => t.status === 'done');
  lines.push('', `ΑΝΟΙΧΤΕΣ ΕΚΚΡΕΜΟΤΗΤΕΣ (${openTasks.length}):`, ...openTasks.map(taskLine));
  if (doneTasks.length > 0) lines.push('', 'ΟΛΟΚΛΗΡΩΜΕΝΕΣ ΤΕΛΕΥΤΑΙΕΣ 30 ΜΕΡΕΣ:', ...doneTasks.map(taskLine));

  return { text: lines.join('\n'), sources };
}
