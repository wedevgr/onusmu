const pad = (value: number): string => value.toString().padStart(2, '0');

export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayStart(offsetDays = 0): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date;
}

export function startOfTodayIso(): string {
  return dayStart(0).toISOString();
}

export function dayBoundsIso(offsetDays = 0): { from: string; to: string } {
  const from = dayStart(offsetDays);
  const to = dayStart(offsetDays + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  if (isSameDay(date, today)) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateHeader(offsetDays: number): string {
  const { from } = dayBoundsIso(offsetDays);
  const label = formatDayLabel(from);
  if (label.length > 0) {
    const date = new Date(from);
    const suffix = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${label} · ${suffix}`;
  }
  return new Date(from).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTimeRange(startIso: string, endIso: string): string {
  const dayPrefix = formatDayLabel(startIso);
  const prefix = dayPrefix === 'Today' ? '' : `${dayPrefix} `;
  return `${prefix}${formatClock(startIso)}–${formatClock(endIso)}`;
}

export function formatDurationSeconds(seconds: number): string {
  return formatDurationMs(seconds * 1000);
}
