/**
 * Wall-clock time in a named IANA timezone, without a date library.
 * Used to tell the LLM what "now" is for the user and to turn the local time it
 * answers with ("2026-10-15T17:00") back into an exact instant.
 */

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

function wallClock(instant: Date, timezone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: get('weekday'),
  };
}

const pad = (value: number): string => value.toString().padStart(2, '0');

/** e.g. "Wednesday 2026-10-14 16:05" in the given timezone. */
export function formatZoned(instant: Date, timezone: string): string {
  const c = wallClock(instant, timezone);
  return `${c.weekday} ${c.year}-${pad(c.month)}-${pad(c.day)} ${pad(c.hour)}:${pad(c.minute)}`;
}

/** Minutes the timezone is ahead of UTC at the given instant. */
function offsetMinutes(instant: Date, timezone: string): number {
  const c = wallClock(instant, timezone);
  const asUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60000) * 60000) / 60000);
}

/** "YYYY-MM-DDTHH:mm" read as wall-clock time in the timezone; null if malformed. */
export function zonedToUtc(local: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // Apply the offset, then re-check it at the result in case a DST change lies in between.
  let result = naive - offsetMinutes(new Date(naive), timezone) * 60000;
  result = naive - offsetMinutes(new Date(result), timezone) * 60000;
  return new Date(result);
}

/** e.g. "16:05" in the given timezone. */
export function formatZonedClock(instant: Date, timezone: string): string {
  const c = wallClock(instant, timezone);
  return `${pad(c.hour)}:${pad(c.minute)}`;
}

/** e.g. "Πέμπτη 15 Οκτωβρίου 2026 στις 18:21" in the given timezone, for the answer model to quote. */
export function formatZonedGreek(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('el-GR', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}
