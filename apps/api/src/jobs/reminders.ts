import { and, eq, gt, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { REMINDERS } from '@todo/shared';
import type { Db } from '../db/client';
import { tasks, users } from '../db/schema';
import type { NotificationService } from '../services/notifications';

/**
 * Sends "due soon" (timed tasks, an hour before) and "overdue" reminders, once each per due date,
 * to the assignee (or the creator when nobody is assigned). Overdue reminders only go out for
 * tasks that became late in the last 7 days, so switching this on never floods anyone.
 */
export async function runReminders(
  db: Db,
  notify: NotificationService['notify'],
  now = new Date(),
) {
  const recipient = sql<string>`coalesce(${tasks.assigneeId}, ${tasks.createdBy})`;
  const open = and(ne(tasks.status, 'done'), isNull(tasks.deletedAt), isNull(tasks.removedAt));
  const soonUntil = new Date(now.getTime() + REMINDERS.dueSoonMinutes * 60_000);

  const dueSoon = await db
    .update(tasks)
    .set({ remindedDueSoonAt: now })
    .where(
      and(
        open,
        eq(tasks.dueHasTime, true),
        isNull(tasks.remindedDueSoonAt),
        gt(tasks.dueAt, now),
        lte(tasks.dueAt, soonUntil),
      ),
    )
    .returning({ id: tasks.id, title: tasks.title, to: recipient });

  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  const late = await db
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(users, eq(users.id, recipient))
    .where(
      and(
        open,
        isNull(tasks.remindedOverdueAt),
        gt(tasks.dueAt, weekAgo),
        or(
          and(eq(tasks.dueHasTime, true), lte(tasks.dueAt, now)),
          and(
            eq(tasks.dueHasTime, false),
            // A date-only task is late after midnight of its date, in the recipient's time zone.
            sql`(${tasks.dueAt} AT TIME ZONE 'UTC')::date < (${now.toISOString()}::timestamptz AT TIME ZONE ${users.timeZone})::date`,
          ),
        ),
      ),
    );
  const overdue = late.length
    ? await db
        .update(tasks)
        .set({ remindedOverdueAt: now })
        .where(and(sql`${tasks.id} IN ${late.map((l) => l.id)}`, isNull(tasks.remindedOverdueAt)))
        .returning({ id: tasks.id, title: tasks.title, to: recipient })
    : [];

  for (const t of dueSoon)
    await notify({
      type: 'due_soon',
      taskId: t.id,
      taskTitle: t.title,
      actorId: null,
      recipients: [t.to],
    });
  for (const t of overdue)
    await notify({
      type: 'overdue',
      taskId: t.id,
      taskTitle: t.title,
      actorId: null,
      recipients: [t.to],
    });
  return { dueSoon: dueSoon.length, overdue: overdue.length };
}
