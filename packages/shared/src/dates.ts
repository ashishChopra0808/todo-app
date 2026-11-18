import { TZDate } from '@date-fns/tz';
import { addDays, format, startOfDay } from 'date-fns';

/**
 * Due dates are stored in UTC.
 * - With a time (dueHasTime = true): dueAt is the exact instant.
 * - Date only (dueHasTime = false): dueAt is that calendar date at 00:00 UTC, and
 *   "today"/"overdue" compare calendar dates in the user's own time zone.
 */

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local calendar date (YYYY-MM-DD) for an instant in a time zone. */
export function localDate(tz: string, at: Date = new Date()): string {
  return format(new TZDate(at, tz), 'yyyy-MM-dd');
}

/** UTC instants for the start of today and start of tomorrow in the user's zone. */
export function localDayRange(tz: string, at: Date = new Date()) {
  const start = startOfDay(new TZDate(at, tz));
  const end = addDays(start, 1);
  return {
    startUtc: new Date(start.getTime()),
    endUtc: new Date(end.getTime()),
    localDate: format(start, 'yyyy-MM-dd'),
  };
}

/** Builds the stored dueAt from what the user picked in their own time zone. */
export function toDueAt(date: string, time: string | null | undefined, tz: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid date');
  if (!time) return `${date}T00:00:00.000Z`;
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('invalid time');
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, tz).getTime()).toISOString();
}

/** Splits a stored dueAt back into the date/time the user sees in their zone. */
export function fromDueAt(dueAt: string, hasTime: boolean, tz: string) {
  if (!hasTime) return { date: dueAt.slice(0, 10), time: null as string | null };
  const local = new TZDate(new Date(dueAt), tz);
  return { date: format(local, 'yyyy-MM-dd'), time: format(local, 'HH:mm') };
}

interface DueLike {
  dueAt: string | null;
  dueHasTime: boolean;
  status: string;
}

export function isOverdue(task: DueLike, tz: string, now: Date = new Date()): boolean {
  if (!task.dueAt || task.status === 'done') return false;
  if (task.dueHasTime) return new Date(task.dueAt).getTime() < now.getTime();
  return task.dueAt.slice(0, 10) < localDate(tz, now);
}

export function isDueToday(task: DueLike, tz: string, now: Date = new Date()): boolean {
  if (!task.dueAt) return false;
  if (task.dueHasTime) {
    const { startUtc, endUtc } = localDayRange(tz, now);
    const t = new Date(task.dueAt).getTime();
    return t >= startUtc.getTime() && t < endUtc.getTime();
  }
  return task.dueAt.slice(0, 10) === localDate(tz, now);
}
