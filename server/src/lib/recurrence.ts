import { zonedToUtc } from './zonedtime';

/**
 * Repeating tasks and payments: "κάθε Δευτέρα", "κάθε πρωί στις 8", "κάθε 15 του μήνα",
 * "κάθε δύο εβδομάδες". Rules are evaluated on local calendar dates in the user's timezone,
 * so a 09:00 task stays at 09:00 across daylight-saving changes.
 */

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Repeat {
  freq: Frequency;
  /** Every n days, weeks, months or years. */
  interval: number;
  /** weekly: weekdays, 0 = Sunday … 6 = Saturday. */
  days?: number[];
  /** monthly and yearly: day of the month; the last day when the month is shorter. */
  monthDay?: number;
  /** yearly: month, 1 … 12. */
  month?: number;
  /** Local time, "HH:mm". */
  time: string;
  /** First day the rule counts from, "YYYY-MM-DD"; anchors "every 2 weeks". */
  start: string;
  /** Last day it may happen on, "YYYY-MM-DD". */
  until?: string;
}

const DAY_MS = 86400000;
// How far ahead to look for the next occurrence; covers a yearly rule with some slack.
const SEARCH_DAYS = 800;

/** "YYYY-MM-DD" of an instant in the timezone. */
export function localDay(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(instant);
}

function toUtcNoon(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

function addDays(day: string, n: number): string {
  return new Date(toUtcNoon(day).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((toUtcNoon(b).getTime() - toUtcNoon(a).getTime()) / DAY_MS);
}

function weekday(day: string): number {
  return toUtcNoon(day).getUTCDay();
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whether the rule happens on this local day (ignoring the time of day). */
export function occursOn(rule: Repeat, day: string): boolean {
  if (day < rule.start || (rule.until && day > rule.until)) return false;
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [sy, sm] = rule.start.split('-').map(Number) as [number, number];
  const interval = Math.max(1, rule.interval);
  switch (rule.freq) {
    case 'daily':
      return daysBetween(rule.start, day) % interval === 0;
    case 'weekly': {
      const days = rule.days && rule.days.length > 0 ? rule.days : [weekday(rule.start)];
      if (!days.includes(weekday(day))) return false;
      // Count whole weeks between the Sundays starting each week.
      const weeks = Math.floor(daysBetween(addDays(rule.start, -weekday(rule.start)), day) / 7);
      return weeks % interval === 0;
    }
    case 'monthly': {
      const months = (y - sy) * 12 + (m - sm);
      if (months % interval !== 0) return false;
      const target = rule.monthDay ?? Number(rule.start.slice(8, 10));
      return d === Math.min(target, lastDayOfMonth(y, m));
    }
    case 'yearly': {
      if ((y - sy) % interval !== 0) return false;
      const month = rule.month ?? sm;
      const target = rule.monthDay ?? Number(rule.start.slice(8, 10));
      return m === month && d === Math.min(target, lastDayOfMonth(y, m));
    }
  }
}

/** The instant of the rule on a given local day. */
function at(rule: Repeat, day: string, timezone: string): Date {
  return zonedToUtc(`${day}T${rule.time}`, timezone) ?? toUtcNoon(day);
}

/** The first occurrence strictly after `after`, or null when the rule has ended. */
export function nextOccurrence(rule: Repeat, after: Date, timezone: string): Date | null {
  let day = localDay(after, timezone);
  if (day < rule.start) day = rule.start;
  for (let i = 0; i < SEARCH_DAYS; i += 1, day = addDays(day, 1)) {
    if (rule.until && day > rule.until) return null;
    if (!occursOn(rule, day)) continue;
    const instant = at(rule, day, timezone);
    if (instant > after) return instant;
  }
  return null;
}

/** Up to `count` occurrences strictly after `after`. */
export function upcoming(rule: Repeat, after: Date, timezone: string, count: number): Date[] {
  const out: Date[] = [];
  let cursor = after;
  while (out.length < count) {
    const next = nextOccurrence(rule, cursor, timezone);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

/** How many reminders ahead the phone schedules for a rule. */
export function scheduleCount(rule: Repeat): number {
  return rule.freq === 'daily' ? 14 : rule.freq === 'weekly' ? 8 : 6;
}

/** Average occurrences per month, to state recurring payments as a monthly amount. */
export function perMonth(rule: Repeat): number {
  const interval = Math.max(1, rule.interval);
  switch (rule.freq) {
    case 'daily':
      return 30.44 / interval;
    case 'weekly':
      return (4.345 * Math.max(1, rule.days?.length ?? 1)) / interval;
    case 'monthly':
      return 1 / interval;
    case 'yearly':
      return 1 / (12 * interval);
  }
}

const WEEKDAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
const MONTHS = [
  'Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου',
  'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου',
];

/** Greek description, e.g. "Κάθε Δευτέρα 09:00", "Δευτέρα–Παρασκευή 07:00", "Κάθε 15 του μήνα". */
export function describeRepeat(rule: Repeat): string {
  const n = Math.max(1, rule.interval);
  const time = ` ${rule.time}`;
  let text: string;
  switch (rule.freq) {
    case 'daily':
      text = n === 1 ? `Κάθε μέρα${time}` : `Κάθε ${n} μέρες${time}`;
      break;
    case 'weekly': {
      const days = [...(rule.days && rule.days.length > 0 ? rule.days : [weekday(rule.start)])].sort(
        (a, b) => ((a + 6) % 7) - ((b + 6) % 7),
      );
      const names =
        days.join() === '1,2,3,4,5'
          ? 'Δευτέρα–Παρασκευή'
          : days.length === 7
            ? 'κάθε μέρα'
            : days.map((d) => WEEKDAYS[d]).join(', ');
      text = n === 1 ? `${days.join() === '1,2,3,4,5' ? names : `Κάθε ${names}`}${time}` : `Κάθε ${n} εβδομάδες (${names})${time}`;
      break;
    }
    case 'monthly': {
      const day = rule.monthDay ?? Number(rule.start.slice(8, 10));
      text = n === 1 ? `Κάθε ${day} του μήνα` : `Κάθε ${n} μήνες, στις ${day}`;
      break;
    }
    case 'yearly': {
      const month = rule.month ?? Number(rule.start.slice(5, 7));
      const day = rule.monthDay ?? Number(rule.start.slice(8, 10));
      text = `Κάθε χρόνο, ${day} ${MONTHS[month - 1]}`;
      break;
    }
  }
  if (rule.until) {
    const [, m, d] = rule.until.split('-').map(Number);
    text += `, έως ${d}/${m}`;
  }
  return text;
}

const DAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * A rule from model output: {"freq":"weekly","interval":1,"days":["MO"],"monthDay":null,
 * "time":"09:00","until":null}. Null when it is missing or makes no sense. `start` is the
 * local day the rule counts from (the recording day).
 */
export function parseRepeat(raw: unknown, start: string): Repeat | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const freq = r.freq;
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly' && freq !== 'yearly') return null;
  const interval = typeof r.interval === 'number' && r.interval >= 1 && r.interval <= 52 ? Math.floor(r.interval) : 1;
  // "8:00" and "08:00" alike; no time said means 09:00.
  const padded = typeof r.time === 'string' ? r.time.trim().replace(/^(\d):/, '0$1:') : '';
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(padded) ? padded : '09:00';
  const days = Array.isArray(r.days)
    ? [
        ...new Set(
          r.days
            .map((d) => (typeof d === 'string' ? DAY_CODES[d.toUpperCase().slice(0, 2)] : typeof d === 'number' ? d : undefined))
            .filter((d): d is number => d !== undefined && d >= 0 && d <= 6),
        ),
      ]
    : [];
  const monthDay = typeof r.monthDay === 'number' && r.monthDay >= 1 && r.monthDay <= 31 ? Math.floor(r.monthDay) : undefined;
  const month = typeof r.month === 'number' && r.month >= 1 && r.month <= 12 ? Math.floor(r.month) : undefined;
  const until = typeof r.until === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.until) ? r.until.slice(0, 10) : undefined;
  if (freq === 'weekly' && days.length === 0) days.push(weekday(start));
  const rule: Repeat = { freq, interval, time, start };
  if (freq === 'weekly') rule.days = days.sort((a, b) => a - b);
  if (freq === 'monthly' || freq === 'yearly') rule.monthDay = monthDay ?? Number(start.slice(8, 10));
  if (freq === 'yearly') rule.month = month ?? Number(start.slice(5, 7));
  if (until && until >= start) rule.until = until;
  return rule;
}
