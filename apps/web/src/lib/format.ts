import type { TFunction } from 'i18next';
import { fromDueAt, isOverdue, localDate } from '@todo/shared';
import type { TaskDto } from '@todo/shared';

function addDaysIso(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatTime(iso: string, tz: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  }).format(new Date(iso));
}

export function formatDate(
  date: string,
  locale: string,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
) {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

export function formatDateTime(iso: string, tz: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: tz,
  }).format(new Date(iso));
}

export function formatLongToday(tz: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: tz,
  }).format(new Date());
}

/** "Today, 3:00 PM", "Tomorrow", "Yesterday", "18 Nov" — in the user's language and time zone. */
export function formatDue(
  task: Pick<TaskDto, 'dueAt' | 'dueHasTime' | 'status'>,
  tz: string,
  locale: string,
  t: TFunction,
) {
  if (!task.dueAt) return { label: t('task.due.none'), overdue: false };
  const { date } = fromDueAt(task.dueAt, task.dueHasTime, tz);
  const today = localDate(tz);
  const time = task.dueHasTime ? formatTime(task.dueAt, tz, locale) : null;
  let label: string;
  if (date === today) label = time ? t('task.due.todayAt', { time }) : t('task.due.today');
  else if (date === addDaysIso(today, 1))
    label = time ? t('task.due.tomorrowAt', { time }) : t('task.due.tomorrow');
  else if (date === addDaysIso(today, -1)) label = t('task.due.yesterday');
  else {
    const d = formatDate(
      date,
      locale,
      date.slice(0, 4) === today.slice(0, 4)
        ? { day: 'numeric', month: 'short' }
        : { day: 'numeric', month: 'short', year: 'numeric' },
    );
    label = time ? t('task.due.onAt', { date: d, time }) : t('task.due.on', { date: d });
  }
  return { label, overdue: isOverdue(task, tz) };
}

export function greetingKey(tz: string) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(
      new Date(),
    ),
  );
  if (hour < 12) return 'today.greeting.morning';
  if (hour < 17) return 'today.greeting.afternoon';
  return 'today.greeting.evening';
}

export { addDaysIso };
