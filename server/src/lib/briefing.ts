import { query } from '../db';
import { ctx, decryptText } from './crypto';
import { nextOccurrence, occursOn, type Repeat } from './recurrence';
import type { FactData, FactKind } from './understand';
import { zonedToUtc } from './zonedtime';

/**
 * The morning briefing for each of the next few days, built from tasks, debts, money owed to
 * the user and readings. Plain templates, no model call: the same data always gives the same
 * text. The app schedules these as local notifications, so they arrive with the app closed.
 */

export interface Briefing {
  /** Local date, "YYYY-MM-DD". */
  date: string;
  title: string;
  body: string;
}

// Money owed to the user for this long gets a nudge.
const OWED_NUDGE_DAYS = 14;
// Payments are announced this many days ahead.
const PAYMENT_LOOKAHEAD_DAYS = 3;
// A repeating bill nobody marked paid (a direct debit, say) moves on after this many days.
const RECURRING_GRACE_DAYS = 3;
// A service is announced when the car is this close to it.
const SERVICE_NUDGE_KM = 1500;
const DAY_MS = 86400000;

function localDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(instant);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOf(date: string, timezone: string): Date {
  return zonedToUtc(`${date}T00:00`, timezone) ?? new Date(`${date}T00:00:00Z`);
}

function money(amount: number | null, currency: string | null): string {
  if (amount === null) return '';
  try {
    return new Intl.NumberFormat('el-GR', { style: 'currency', currency: currency ?? 'EUR' }).format(amount);
  } catch {
    return `${amount} ${currency ?? ''}`.trim();
  }
}

function clock(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('el-GR', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    instant,
  );
}

function dayName(date: string): string {
  return new Intl.DateTimeFormat('el-GR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'numeric' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** "σήμερα", "αύριο" or the weekday, relative to the briefing's day. */
function relativeDay(due: string, briefingDay: string): string {
  if (due === briefingDay) return 'σήμερα';
  if (due === addDays(briefingDay, 1)) return 'αύριο';
  return dayName(due);
}

interface TaskRow {
  id: string;
  text: string;
  due_at: Date | null;
  status: 'pending' | 'suggested';
  repeat: Repeat | null;
}

interface FactRow {
  id: string;
  kind: FactKind;
  data: string;
  occurred_at: Date;
  due_at: Date | null;
  repeat: Repeat | null;
}

export async function buildBriefings(userId: string, timezone: string, days = 4, now = new Date()): Promise<Briefing[]> {
  const [taskRows, factRows] = await Promise.all([
    query<TaskRow>(
      // Suggestions count too: with auto-create off, everything heard starts as one.
      `SELECT id, text, due_at, status, repeat FROM reminders WHERE user_id = $1 AND status IN ('pending', 'suggested')
       ORDER BY due_at NULLS LAST, created_at DESC LIMIT 200`,
      [userId],
    ),
    query<FactRow>(
      `SELECT id, kind, data, occurred_at, due_at, repeat FROM memory_facts
       WHERE user_id = $1 AND kind IN ('debt', 'receivable', 'measure')
       ORDER BY occurred_at LIMIT 500`,
      [userId],
    ),
  ]);
  return composeBriefings(
    taskRows.map((t) => ({
      text: decryptText(t.text, ctx.reminderText(userId, t.id)),
      dueAt: t.due_at,
      status: t.status,
      repeat: t.repeat,
    })),
    factRows.map((f) => ({
      kind: f.kind,
      occurredAt: f.occurred_at,
      dueAt: f.due_at,
      repeat: f.repeat,
      data: JSON.parse(decryptText(f.data, ctx.factData(userId, f.id))) as FactData,
    })),
    timezone,
    days,
    now,
  );
}

export interface BriefingTask {
  text: string;
  dueAt: Date | null;
  status: 'pending' | 'suggested';
  repeat?: Repeat | null;
}

export interface BriefingFact {
  kind: FactKind;
  occurredAt: Date;
  dueAt: Date | null;
  repeat?: Repeat | null;
  data: FactData;
}

/** The briefings from already loaded tasks and facts; no database, so it can be tested. */
export function composeBriefings(
  taskList: BriefingTask[],
  factList: BriefingFact[],
  timezone: string,
  days = 4,
  now = new Date(),
): Briefing[] {
  const facts = factList.map((f) => ({
    kind: f.kind,
    occurred_at: f.occurredAt,
    due_at: f.dueAt,
    repeat: f.repeat ?? null,
    d: f.data,
  }));
  const debts = facts.filter((f) => f.kind === 'debt' && !f.d.settled);
  // A task about paying a debt ("Βάλε 1170 ευρώ στην κάρτα") is already the payment line.
  const debtAmounts = debts.map((f) => (f.d.amount !== null ? String(Math.round(f.d.amount)) : '')).filter(Boolean);
  const tasks = taskList
    .filter((t) => !debtAmounts.some((amount) => new RegExp(`(^|\\D)${amount}(\\D|$)`).test(t.text)))
    .map((t) => ({
      due_at: t.dueAt,
      repeat: t.repeat ?? null,
      text: t.text + (t.status === 'suggested' ? ' (πρόταση)' : ''),
    }));
  const owed = facts.filter((f) => f.kind === 'receivable' && !f.d.settled);
  const measures = facts.filter((f) => f.kind === 'measure');

  const today = localDate(now, timezone);
  const briefings: Briefing[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = addDays(today, i);
    const start = startOf(day, timezone);
    const end = startOf(addDays(day, 1), timezone);
    const lines: string[] = [];

    // Appointments and tasks with a time on this day. A repeating task shows on each day it
    // happens from its next due date on; one already done today has moved past today.
    for (const t of tasks) {
      if (t.repeat && t.due_at) {
        if (day >= localDate(t.due_at, timezone) && occursOn(t.repeat, day)) {
          lines.push(`${t.repeat.time} ${t.text} ↻`);
        }
      } else if (t.due_at && t.due_at >= start && t.due_at < end) {
        lines.push(`${clock(t.due_at, timezone)} ${t.text}`);
      }
    }

    // Payments due soon, and ones already late.
    // The end of the last day looked ahead to, so a payment due on that day is included.
    const horizon = startOf(addDays(day, PAYMENT_LOOKAHEAD_DAYS + 1), timezone);
    for (const f of debts) {
      let dueAt = f.due_at;
      // A repeating bill left unmarked for a few days is taken as paid by itself.
      const grace = new Date(start.getTime() - RECURRING_GRACE_DAYS * DAY_MS);
      if (f.repeat && dueAt && dueAt < grace) dueAt = nextOccurrence(f.repeat, grace, timezone);
      if (!dueAt || dueAt >= horizon) continue;
      const due = localDate(dueAt, timezone);
      const late = dueAt < start;
      // The description often already says the amount ("Χρωστάω 77,54€ στην κάρτα").
      const amount = f.d.amount !== null && !f.d.text.includes(String(Math.trunc(f.d.amount)));
      lines.push(
        `${late ? 'Έληξε' : `Πληρωμή ${relativeDay(due, day)}`}: ${f.d.text}${amount ? ` ${money(f.d.amount, f.d.currency)}` : ''}`,
      );
    }

    // Money owed to the user for a while, per person.
    const byWho = new Map<string, { amount: number; currency: string | null; since: Date }>();
    for (const f of owed.filter((f) => f.occurred_at.getTime() <= start.getTime() - OWED_NUDGE_DAYS * DAY_MS)) {
      const who = f.d.who ?? f.d.text;
      const current = byWho.get(who);
      byWho.set(who, {
        amount: (current?.amount ?? 0) + (f.d.amount ?? 0),
        currency: f.d.currency,
        since: current && current.since < f.occurred_at ? current.since : f.occurred_at,
      });
    }
    for (const [who, o] of byWho) {
      const daysOwed = Math.floor((start.getTime() - o.since.getTime()) / DAY_MS);
      lines.push(`Σου χρωστάει ${who}: ${money(o.amount, o.currency)} εδώ και ${daysOwed} μέρες`);
    }

    // A service coming up: a "next service" reading compared with the latest one for the same vehicle.
    for (const target of measures.filter((m) => /επομεν|επόμεν/i.test(`${m.d.item ?? ''} ${m.d.text}`))) {
      const words = `${target.d.item ?? ''} ${target.d.text}`
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !/επ[οό]μεν|σ[εέ]ρβις|χιλι[οό]μετρ/i.test(w));
      const current = measures
        .filter((m) => m !== target && m.d.value !== null && words.some((w) => `${m.d.item ?? ''} ${m.d.text}`.includes(w)))
        .at(-1);
      if (!current || target.d.value === null || current.d.value === null) continue;
      const left = target.d.value - current.d.value;
      if (left <= SERVICE_NUDGE_KM) {
        lines.push(
          `${words[0] ?? 'Σέρβις'}: ${current.d.value.toLocaleString('el-GR')} ${current.d.unit ?? ''}, ` +
            `σέρβις στα ${target.d.value.toLocaleString('el-GR')} ${target.d.unit ?? ''}`,
        );
      }
    }

    // The rest of the open tasks, briefly.
    const untimed = tasks.filter((t) => !t.repeat && (!t.due_at || t.due_at >= end));
    // A repeating task already shows on the days it happens; it is never "late" as a whole.
    const overdue = tasks.filter((t) => !t.repeat && t.due_at && t.due_at < start);
    if (overdue.length > 0) lines.push(`Εκπρόθεσμες: ${overdue.map((t) => t.text).slice(0, 2).join(', ')}`);
    if (untimed.length > 0) {
      const sample = untimed.slice(0, 2).map((t) => t.text).join(', ');
      lines.push(`Ανοιχτές εκκρεμότητες (${untimed.length}): ${sample}${untimed.length > 2 ? '…' : ''}`);
    }

    // Nothing to say: no notification that day.
    if (lines.length === 0) continue;
    briefings.push({ date: day, title: `Καλημέρα · ${dayName(day)}`, body: lines.join('\n') });
  }
  return briefings;
}
