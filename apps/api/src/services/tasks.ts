import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  RETENTION_DAYS,
  canChangeTaskStatus,
  canDeleteTask,
  canEditTask,
  canViewTask,
  localDate,
  type ActivityDto,
  type Actor,
  type TaskCountsDto,
  type TaskDto,
  type TaskListResponse,
  type taskCreateSchema,
  type taskListQuerySchema,
  type taskUpdateSchema,
} from '@todo/shared';
import type { z } from 'zod';
import type { Db } from '../db/client';
import { taskActivity, tasks, users } from '../db/schema';
import { AppError, notFound } from '../lib/errors';
import { newId } from '../lib/ids';

type TaskRow = typeof tasks.$inferSelect;
type ActivityInsert = typeof taskActivity.$inferInsert;
type Viewer = { id: string; timeZone: string };

const creator = alias(users, 'creator');
const assignee = alias(users, 'assignee');

const retentionDate = () => new Date(Date.now() + RETENTION_DAYS * 24 * 3600 * 1000);

/** Rows the viewer may see. Phase 1: personal tasks only; Phase 2 adds group membership. */
function visibleTo(viewer: Viewer): SQL {
  return and(
    isNull(tasks.deletedAt),
    isNull(tasks.removedAt),
    isNull(tasks.groupId),
    or(eq(tasks.createdBy, viewer.id), eq(tasks.assigneeId, viewer.id)),
  ) as SQL;
}

/** Calendar date of the due date as the viewer sees it (see packages/shared/src/dates.ts). */
const dueLocalDate = (tz: string) =>
  sql`(CASE WHEN ${tasks.dueHasTime} THEN (${tasks.dueAt} AT TIME ZONE ${tz})::date ELSE (${tasks.dueAt} AT TIME ZONE 'UTC')::date END)`;

function overdueCond(tz: string, today: string, now: Date): SQL {
  return and(
    ne(tasks.status, 'done'),
    isNotNull(tasks.dueAt),
    or(
      and(eq(tasks.dueHasTime, true), sql`${tasks.dueAt} < ${now.toISOString()}::timestamptz`),
      and(eq(tasks.dueHasTime, false), sql`${dueLocalDate(tz)} < ${today}::date`),
    ),
  ) as SQL;
}
const dueTodayCond = (tz: string, today: string): SQL =>
  and(isNotNull(tasks.dueAt), sql`${dueLocalDate(tz)} = ${today}::date`) as SQL;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function actorOf(viewer: Viewer): Actor {
  return { id: viewer.id };
}

type JoinedRow = { task: TaskRow; creatorName: string | null; assigneeName: string | null };

function toDto(row: JoinedRow, viewer: Viewer): TaskDto {
  const t = row.task;
  const facts = { createdBy: t.createdBy, assigneeId: t.assigneeId, groupId: t.groupId };
  const actor = actorOf(viewer);
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    dueAt: t.dueAt?.toISOString() ?? null,
    dueHasTime: t.dueHasTime,
    priority: t.priority,
    status: t.status,
    source: t.source,
    groupId: t.groupId,
    createdBy: t.createdBy ? { id: t.createdBy, name: row.creatorName ?? '' } : null,
    assignee: t.assigneeId ? { id: t.assigneeId, name: row.assigneeName ?? '' } : null,
    completedAt: t.completedAt?.toISOString() ?? null,
    version: t.version,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    permissions: {
      edit: canEditTask(actor, facts),
      delete: canDeleteTask(actor, facts),
      changeStatus: canChangeTaskStatus(actor, facts),
    },
  };
}

export function createTaskService(db: Db) {
  const selectJoined = () =>
    db
      .select({ task: tasks, creatorName: creator.name, assigneeName: assignee.name })
      .from(tasks)
      .leftJoin(creator, eq(creator.id, tasks.createdBy))
      .leftJoin(assignee, eq(assignee.id, tasks.assigneeId));

  async function getVisibleRow(viewer: Viewer, id: string): Promise<JoinedRow> {
    const [row] = await selectJoined()
      .where(and(eq(tasks.id, id), visibleTo(viewer)))
      .limit(1);
    // 404 (never 403) so other users' task ids do not leak.
    if (!row || !canViewTask(actorOf(viewer), row.task)) throw notFound();
    return row;
  }

  return {
    async list(
      viewer: Viewer,
      q: z.output<typeof taskListQuerySchema>,
      now = new Date(),
    ): Promise<TaskListResponse> {
      const tz = viewer.timeZone;
      const today = localDate(tz, now);
      const conds: SQL[] = [visibleTo(viewer)];
      let order: SQL[];

      switch (q.view) {
        case 'today':
          conds.push(or(dueTodayCond(tz, today), overdueCond(tz, today, now)) as SQL);
          order = [
            sql`${tasks.status} = 'done'`,
            sql`${tasks.dueAt} ASC NULLS LAST`,
            desc(tasks.priority),
            desc(tasks.createdAt),
          ];
          break;
        case 'overdue':
          conds.push(overdueCond(tz, today, now));
          order = [asc(tasks.dueAt), desc(tasks.priority)];
          break;
        case 'completed':
          conds.push(eq(tasks.status, 'done'));
          order = [sql`${tasks.completedAt} DESC NULLS LAST`, desc(tasks.updatedAt)];
          break;
        case 'mine':
        default:
          if (!q.status?.length) conds.push(ne(tasks.status, 'done'));
          order = [sql`${tasks.dueAt} ASC NULLS LAST`, desc(tasks.priority), desc(tasks.createdAt)];
      }

      if (q.status?.length) conds.push(inArray(tasks.status, q.status));
      if (q.priority?.length) conds.push(inArray(tasks.priority, q.priority));
      if (q.dueFrom) conds.push(sql`${dueLocalDate(tz)} >= ${q.dueFrom}::date`);
      if (q.dueTo) conds.push(sql`${dueLocalDate(tz)} <= ${q.dueTo}::date`);
      if (q.q) {
        conds.push(
          sql`(${tasks.title} || ' ' || coalesce(${tasks.description}, '')) ILIKE ${`%${escapeLike(q.q)}%`}`,
        );
      }

      const offset = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString()) || 0 : 0;
      const rows = await selectJoined()
        .where(and(...conds))
        .orderBy(...order, desc(tasks.id))
        .limit(q.limit + 1)
        .offset(offset);
      const hasMore = rows.length > q.limit;
      return {
        items: rows.slice(0, q.limit).map((r) => toDto(r, viewer)),
        nextCursor: hasMore ? Buffer.from(String(offset + q.limit)).toString('base64url') : null,
      };
    },

    async counts(viewer: Viewer, now = new Date()): Promise<TaskCountsDto> {
      const tz = viewer.timeZone;
      const today = localDate(tz, now);
      const [row] = await db
        .select({
          today: sql<number>`count(*) FILTER (WHERE ${and(ne(tasks.status, 'done'), dueTodayCond(tz, today))})::int`,
          overdue: sql<number>`count(*) FILTER (WHERE ${overdueCond(tz, today, now)})::int`,
          open: sql<number>`count(*) FILTER (WHERE ${ne(tasks.status, 'done')})::int`,
        })
        .from(tasks)
        .where(visibleTo(viewer));
      return { today: row?.today ?? 0, overdue: row?.overdue ?? 0, open: row?.open ?? 0 };
    },

    async get(viewer: Viewer, id: string): Promise<TaskDto> {
      return toDto(await getVisibleRow(viewer, id), viewer);
    },

    async create(viewer: Viewer, input: z.output<typeof taskCreateSchema>, ipHash: string | null) {
      const id = input.id ?? newId();
      if (input.id) {
        // Idempotent create: offline clients may retry with the same id.
        const existing = await db.query.tasks.findFirst({
          where: eq(tasks.id, id),
          columns: { createdBy: true },
        });
        if (existing) {
          if (existing.createdBy === viewer.id)
            return { task: await this.get(viewer, id), created: false };
          throw new AppError('conflict', 'This id is already used');
        }
      }
      const dueAt = input.dueAt ? new Date(input.dueAt) : null;
      await db.transaction(async (tx) => {
        await tx.insert(tasks).values({
          id,
          title: input.title,
          description: input.description ?? null,
          dueAt,
          dueHasTime: dueAt ? input.dueHasTime : false,
          priority: input.priority,
          status: input.status,
          completedAt: input.status === 'done' ? new Date() : null,
          createdBy: viewer.id,
          assigneeId: viewer.id, // Personal tasks are always assigned to the creator.
          groupId: null,
          source: 'text',
        });
        await tx
          .insert(taskActivity)
          .values({ id: newId(), taskId: id, actorId: viewer.id, type: 'created', ipHash });
      });
      return { task: await this.get(viewer, id), created: true };
    },

    async update(
      viewer: Viewer,
      id: string,
      input: z.output<typeof taskUpdateSchema>,
      ipHash: string | null,
    ) {
      const { task: current } = await getVisibleRow(viewer, id);
      const actor = actorOf(viewer);
      const facts = {
        createdBy: current.createdBy,
        assigneeId: current.assigneeId,
        groupId: current.groupId,
      };
      const fieldKeys = (
        ['title', 'description', 'dueAt', 'dueHasTime', 'priority'] as const
      ).filter((k) => input[k] !== undefined);
      if (fieldKeys.length && !canEditTask(actor, facts))
        throw new AppError('forbidden', 'You cannot edit this task');
      if (input.status !== undefined && !canChangeTaskStatus(actor, facts))
        throw new AppError('forbidden', 'You cannot change this task');

      const patch: Partial<typeof tasks.$inferInsert> = {};
      const activity: ActivityInsert[] = [];
      const log = (type: ActivityInsert['type'], from: unknown, to: unknown) =>
        activity.push({
          id: newId(),
          taskId: id,
          actorId: viewer.id,
          type,
          fromValue: from ?? null,
          toValue: to ?? null,
          ipHash,
        });

      if (input.title !== undefined && input.title !== current.title) {
        patch.title = input.title;
        log('title_changed', current.title, input.title);
      }
      if (input.description !== undefined && input.description !== current.description) {
        patch.description = input.description;
        log('description_changed', null, null);
      }
      if (input.dueAt !== undefined || input.dueHasTime !== undefined) {
        const nextDue =
          input.dueAt !== undefined ? (input.dueAt ? new Date(input.dueAt) : null) : current.dueAt;
        const nextHasTime = nextDue ? (input.dueHasTime ?? current.dueHasTime) : false;
        if (nextDue?.getTime() !== current.dueAt?.getTime() || nextHasTime !== current.dueHasTime) {
          patch.dueAt = nextDue;
          patch.dueHasTime = nextHasTime;
          log(
            'due_changed',
            current.dueAt ? { at: current.dueAt.toISOString(), hasTime: current.dueHasTime } : null,
            nextDue ? { at: nextDue.toISOString(), hasTime: nextHasTime } : null,
          );
        }
      }
      if (input.priority !== undefined && input.priority !== current.priority) {
        patch.priority = input.priority;
        log('priority_changed', current.priority, input.priority);
      }
      if (input.status !== undefined && input.status !== current.status) {
        patch.status = input.status;
        patch.completedAt = input.status === 'done' ? new Date() : null;
        log('status_changed', current.status, input.status);
      }

      if (!activity.length) {
        if (input.version !== current.version)
          throw new AppError('conflict', 'This task was changed elsewhere', {
            details: await this.get(viewer, id),
          });
        return this.get(viewer, id);
      }

      const updated = await db.transaction(async (tx) => {
        const rows = await tx
          .update(tasks)
          .set({ ...patch, version: sql`${tasks.version} + 1` })
          .where(and(eq(tasks.id, id), eq(tasks.version, input.version), isNull(tasks.deletedAt)))
          .returning({ id: tasks.id });
        if (!rows.length) return false;
        await tx.insert(taskActivity).values(activity);
        return true;
      });
      if (!updated)
        throw new AppError('conflict', 'This task was changed elsewhere', {
          details: await this.get(viewer, id),
        });
      return this.get(viewer, id);
    },

    async remove(viewer: Viewer, id: string, ipHash: string | null) {
      const { task } = await getVisibleRow(viewer, id);
      if (!canDeleteTask(actorOf(viewer), task))
        throw new AppError('forbidden', 'You cannot delete this task');
      await db.transaction(async (tx) => {
        // Hidden at once for everyone; kept for 180 days, then purged by the daily job.
        await tx
          .update(tasks)
          .set({ deletedAt: new Date(), deletedBy: viewer.id, purgeAfter: retentionDate() })
          .where(eq(tasks.id, id));
        await tx
          .insert(taskActivity)
          .values({ id: newId(), taskId: id, actorId: viewer.id, type: 'deleted', ipHash });
      });
    },

    async activity(viewer: Viewer, id: string): Promise<ActivityDto[]> {
      await getVisibleRow(viewer, id);
      const actor = alias(users, 'actor');
      const rows = await db
        .select({ a: taskActivity, actorName: actor.name })
        .from(taskActivity)
        .leftJoin(actor, eq(actor.id, taskActivity.actorId))
        .where(eq(taskActivity.taskId, id))
        .orderBy(asc(taskActivity.createdAt), asc(taskActivity.id));
      return rows.map(({ a, actorName }) => ({
        id: a.id,
        type: a.type,
        actor: a.actorId ? { id: a.actorId, name: actorName ?? '' } : null,
        from: a.fromValue,
        to: a.toValue,
        createdAt: a.createdAt.toISOString(),
      }));
    },
  };
}
export type TaskService = ReturnType<typeof createTaskService>;
