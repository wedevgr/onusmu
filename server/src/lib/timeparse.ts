export interface TimeRange {
  from: Date;
  to: Date;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayRange(day: Date): TimeRange {
  const from = startOfDay(day);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

interface ParsedClock {
  hour: number;
  minute: number;
}

function parseClock(text: string): ParsedClock | null {
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let hour = parseInt(m[1] ?? '', 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = (m[3] ?? '').toLowerCase();
  if (hour > 23 || minute > 59) return null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (!meridiem && hour > 12 && hour <= 23) {
    // 24h format already; keep as is
  }
  return { hour, minute };
}

/**
 * Converts English time expressions in a user question into an optional
 * [from, to) timestamp range. Returns null when nothing matches (the chat
 * then searches across all time).
 */
export function parseTimeExpressions(message: string, now: Date = new Date()): TimeRange | null {
  const text = message.toLowerCase();

  // Weekday names: most recent past occurrence.
  for (const [name, target] of Object.entries(WEEKDAYS)) {
    if (text.includes(name)) {
      const todayDow = now.getDay();
      let delta = (todayDow - target + 7) % 7;
      if (delta === 0) delta = 0; // same weekday -> today
      return dayRange(addDays(now, -delta));
    }
  }

  if (text.includes('last week')) {
    const thisMonday = addDays(startOfDay(now), -((now.getDay() + 6) % 7));
    const lastMonday = addDays(thisMonday, -7);
    return { from: lastMonday, to: thisMonday };
  }
  if (text.includes('this week')) {
    const thisMonday = addDays(startOfDay(now), -((now.getDay() + 6) % 7));
    return { from: thisMonday, to: dayRange(now).to };
  }
  if (text.includes('yesterday')) {
    return dayRange(addDays(now, -1));
  }
  if (text.includes('this morning')) {
    const day = startOfDay(now);
    return { from: new Date(day.setHours(5, 0, 0, 0)), to: new Date(startOfDay(now).setHours(12, 0, 0, 0)) };
  }
  if (text.includes('this afternoon')) {
    return { from: new Date(startOfDay(now).setHours(12, 0, 0, 0)), to: new Date(startOfDay(now).setHours(17, 0, 0, 0)) };
  }
  if (text.includes('this evening') || text.includes('tonight')) {
    return { from: new Date(startOfDay(now).setHours(17, 0, 0, 0)), to: dayRange(now).to };
  }
  if (text.includes('today')) {
    return dayRange(now);
  }

  // ISO date: 2024-10-05
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const year = parseInt(iso[1] ?? '', 10);
    const month = parseInt(iso[2] ?? '', 10) - 1;
    const dayN = parseInt(iso[3] ?? '', 10);
    if (month >= 0 && month <= 11 && dayN >= 1 && dayN <= 31) {
      return dayRange(new Date(year, month, dayN));
    }
  }

  // "october 5"
  for (const [name, month] of Object.entries(MONTHS)) {
    if (text.includes(name)) {
      const m = text.match(new RegExp(`${name}\\s+(\\d{1,2})`));
      if (m) {
        const dayN = parseInt(m[1] ?? '', 10);
        if (dayN >= 1 && dayN <= 31) {
          return dayRange(new Date(now.getFullYear(), month, dayN));
        }
      }
    }
  }

  // "around 3 pm" / "at 15:00" / "3pm" -> +-30 minute window today
  const clockMatch = text.match(/(?:around|at)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/) ??
    text.match(/\b(\d{1,2}\s*(?:am|pm))\b/) ??
    text.match(/\b(\d{1,2}:\d{2})\b/);
  if (clockMatch) {
    const clock = parseClock(clockMatch[1] ?? '');
    if (clock) {
      const base = startOfDay(now);
      base.setHours(clock.hour, clock.minute, 0, 0);
      return { from: new Date(base.getTime() - 30 * 60 * 1000), to: new Date(base.getTime() + 30 * 60 * 1000) };
    }
  }

  return null;
}

export function formatClock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
