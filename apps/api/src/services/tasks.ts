import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  RETENTION_DAYS,
  canAssign,
  canChangeTaskStatus,
  canComment,
  canCreateTaskIn,
  canDeleteTask,
  canEditTask,
  canMoveTask,
  canReport,
  canViewTask,
  localDate,
  type ActivityDto,
  type GroupRef,
  type TaskCountsDto,
  type TaskDto,
  type TaskListResponse,
  type taskCreateSchema,
  type taskListQuerySchema,
  type taskUpdateSchema,
} from '@todo/shared';
import type { z } from 'zod';
import type { Db } from '../db/client';
import { files, groupMembers, groups, taskActivity, tasks, users } from '../db/schema';
import { AppError, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import type { AvatarUrl } from './avatars';
import type { DailyLimits } from './daily-limits';
import type { FileService } from './files';
import { groupIdsOf, type Viewer } from './membership';
import type { NotificationService } from './notifications';

type TaskRow = typeof tasks.$inferSelect;
type ActivityInsert = typeof taskActivity.$inferInsert;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const creator = alias(users, 'creator');
const assignee = alias(users, 'assignee');
const assigneeAvatar = alias(files, 'assignee_avatar');

const retentionDate = () => new Date(Date.now() + RETENTION_DAYS * 24 * 3600 * 1000);

/** Content by suspended users is hidden from everyone else (the viewer is never suspended). */
export const creatorNotSuspended = sql`NOT EXISTS (SELECT 1 FROM users su WHERE su.id = ${tasks.createdBy} AND su.suspended_at IS NOT NULL)`;

/**
 * Rows the viewer may see: their personal tasks, plus every task in the active groups they
 * belong to. Hidden: deleted, removed by a moderator, or created by a suspended user.
 */
export function visibleTo(viewer: Viewer): SQL {
  const groupIds = groupIdsOf(viewer);
  const personal = and(
    isNull(tasks.groupId),
    or(eq(tasks.createdBy, viewer.id), eq(tasks.assigneeId, viewer.id)),
  ) as SQL;
  return and(
    isNull(tasks.deletedAt),
    isNull(tasks.removedAt),
    groupIds.length ? (or(personal, inArray(tasks.groupId, groupIds)) as SQL) : personal,
    creatorNotSuspended,
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

const commentCount = sql<number>`(SELECT count(*) FROM comments c WHERE c.task_id = ${tasks.id} AND c.deleted_at IS NULL AND c.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM users cu WHERE cu.id = c.author_id AND cu.suspended_at IS NOT NULL))::int`;

type JoinedRow = {
  task: TaskRow;
  creatorName: string | null;
  assigneeName: string | null;
  assigneeImage: string | null;
  assigneeAvatarKey: string | null;
  groupName: string | null;
  groupIcon: string | null;
  commentCount: number;
};

export const taskFacts = (t: Pick<TaskRow, 'createdBy' | 'assigneeId' | 'groupId'>) => ({
  createdBy: t.createdBy,
  assigneeId: t.assigneeId,
  groupId: t.groupId,
});

export function createTaskService(
  db: Db,
  avatarUrl: AvatarUrl,
  limits: DailyLimits,
  extra: { files: FileService; notify: NotificationService['notify'] },
) {
  const selectJoined = () =>
    db
      .select({
        task: tasks,
        creatorName: creator.name,
        assigneeName: assignee.name,
        assigneeImage: assignee.image,
        assigneeAvatarKey: assigneeAvatar.storageKey,
        groupName: groups.name,
        groupIcon: groups.icon,
        commentCount,
      })
      .from(tasks)
      .leftJoin(creator, eq(creator.id, tasks.createdBy))
      .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
      .leftJoin(
        assigneeAvatar,
        and(eq(assigneeAvatar.id, assignee.avatarFileId), isNull(assigneeAvatar.deletedAt)),
      )
      .leftJoin(groups, eq(groups.id, tasks.groupId));

  async function toDto(row: JoinedRow, viewer: Viewer): Promise<TaskDto> {
    const t = row.task;
    const facts = taskFacts(t);
    const group: GroupRef | null =
      t.groupId && row.groupName !== null
        ? { id: t.groupId, name: row.groupName, icon: row.groupIcon }
        : null;
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
      group,
      createdBy: t.createdBy ? { id: t.createdBy, name: row.creatorName ?? '' } : null,
      assignee: t.assigneeId
        ? {
            id: t.assigneeId,
            name: row.assigneeName ?? '',
            avatarUrl: await avatarUrl({
              avatarKey: row.assigneeAvatarKey,
              image: row.assigneeImage,
            }),
          }
        : null,
      commentCount: row.commentCount ?? 0,
      audio: await extra.files.audioDto(t.audioFileId),
      completedAt: t.completedAt?.toISOString() ?? null,
      version: t.version,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      permissions: {
        edit: canEditTask(viewer, facts),
        delete: canDeleteTask(viewer, facts),
        changeStatus: canChangeTaskStatus(viewer, facts),
        assign: canAssign(viewer, facts),
        move: t.createdBy === viewer.id,
        comment: canComment(viewer, facts),
        report: canReport(viewer, { type: 'task', ownerId: t.createdBy }),
      },
    };
  }

  async function getVisibleRow(viewer: Viewer, id: string): Promise<JoinedRow> {
    const [row] = await selectJoined()
      .where(and(eq(tasks.id, id), visibleTo(viewer)))
      .limit(1);
    // 404 (never 403) so other users' task ids do not leak.
    if (!row || !canViewTask(viewer, row.task)) throw notFound();
    return row;
  }

  /** The assignee must be a member of the group (checked against the database, not the request). */
  async function assertMember(tx: Db | Tx, groupId: string, userId: string) {
    const [m] = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.userId, userId),
          isNull(users.suspendedAt),
        ),
      )
      .limit(1);
    if (!m)
      throw new AppError('not_a_member', 'The assignee is not a member of this group', {
        fields: { assigneeId: 'not_a_member' },
      });
  }

  async function userRef(tx: Db | Tx, id: string | null) {
    if (!id) return null;
    const u = await tx.query.users.findFirst({
      where: eq(users.id, id),
      columns: { id: true, name: true },
    });
    return u ? { id: u.id, name: u.name } : { id, name: '' };
  }

  async function groupRef(tx: Db | Tx, id: string | null) {
    if (!id) return null;
    const g = await tx.query.groups.findFirst({
      where: eq(groups.id, id),
      columns: { id: true, name: true, icon: true },
    });
    return g ? { id: g.id, name: g.name, icon: g.icon } : null;
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
      const openUnlessFiltered = () => {
        if (!q.status?.length) conds.push(ne(tasks.status, 'done'));
      };
      const byDue = [
        sql`${tasks.dueAt} ASC NULLS LAST`,
        desc(tasks.priority),
        desc(tasks.createdAt),
      ];

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
        case 'assigned_by_me':
          conds.push(
            eq(tasks.createdBy, viewer.id),
            isNotNull(tasks.assigneeId),
            ne(tasks.assigneeId, viewer.id),
          );
          openUnlessFiltered();
          order = byDue;
          break;
        case 'all':
          openUnlessFiltered();
          order = byDue;
          break;
        case 'mine':
        default:
          conds.push(eq(tasks.assigneeId, viewer.id));
          openUnlessFiltered();
          order = byDue;
      }

      if (q.group === 'personal') conds.push(isNull(tasks.groupId));
      else if (q.group) conds.push(eq(tasks.groupId, q.group));
      if (q.assignee === 'me') conds.push(eq(tasks.assigneeId, viewer.id));
      else if (q.assignee === 'none') conds.push(isNull(tasks.assigneeId));
      else if (q.assignee) conds.push(eq(tasks.assigneeId, q.assignee));

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
        items: await Promise.all(rows.slice(0, q.limit).map((r) => toDto(r, viewer))),
        nextCursor: hasMore ? Buffer.from(String(offset + q.limit)).toString('base64url') : null,
      };
    },

    /** Badge counts: tasks assigned to me (personal and group). */
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
        .where(and(visibleTo(viewer), eq(tasks.assigneeId, viewer.id)));
      return { today: row?.today ?? 0, overdue: row?.overdue ?? 0, open: row?.open ?? 0 };
    },

    async get(viewer: Viewer, id: string): Promise<TaskDto> {
      return toDto(await getVisibleRow(viewer, id), viewer);
    },

    /** For comments and reports: the raw row, if the viewer can see it. */
    async getVisible(viewer: Viewer, id: string): Promise<TaskRow> {
      return (await getVisibleRow(viewer, id)).task;
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
      const groupId = input.groupId ?? null;
      // A group the viewer isn't in looks the same as one that doesn't exist.
      if (!canCreateTaskIn(viewer, groupId)) throw notFound();
      let assigneeId: string | null;
      if (!groupId) {
        if (input.assigneeId && input.assigneeId !== viewer.id)
          throw new AppError('validation_failed', 'Personal tasks are assigned to you', {
            fields: { assigneeId: 'invalid' },
          });
        assigneeId = viewer.id; // Personal tasks are always assigned to the creator.
      } else {
        assigneeId = input.assigneeId ?? null;
        if (assigneeId) await assertMember(db, groupId, assigneeId);
      }
      if (input.audioFileId)
        await extra.files.claimable(viewer.id, input.audioFileId, 'task_audio');
      await limits.consume('tasks', viewer.id);

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
          assigneeId,
          groupId,
          source: input.audioFileId ? 'voice' : 'text',
          audioFileId: input.audioFileId ?? null,
        });
        const activity: ActivityInsert[] = [
          { id: newId(), taskId: id, actorId: viewer.id, type: 'created', ipHash },
        ];
        if (groupId && assigneeId)
          activity.push({
            id: newId(),
            taskId: id,
            actorId: viewer.id,
            type: 'assigned',
            toValue: await userRef(tx, assigneeId),
            ipHash,
          });
        await tx.insert(taskActivity).values(activity);
      });
      if (groupId && assigneeId)
        await extra.notify({
          type: 'task_assigned',
          taskId: id,
          taskTitle: input.title,
          actorId: viewer.id,
          recipients: [assigneeId],
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
      const facts = taskFacts(current);
      const fieldKeys = (
        ['title', 'description', 'dueAt', 'dueHasTime', 'priority'] as const
      ).filter((k) => input[k] !== undefined);
      if (fieldKeys.length && !canEditTask(viewer, facts))
        throw new AppError('forbidden', 'You cannot edit this task');
      if (input.status !== undefined && !canChangeTaskStatus(viewer, facts))
        throw new AppError('forbidden', 'You cannot change this task');

      const moving = input.groupId !== undefined && input.groupId !== current.groupId;
      const targetGroup = moving ? (input.groupId ?? null) : current.groupId;
      if (moving && !canMoveTask(viewer, facts, targetGroup)) {
        if (targetGroup && !viewer.groupRoles[targetGroup]) throw notFound();
        throw new AppError('forbidden', 'Only the person who created a task can move it');
      }

      // Work out the assignee after this change.
      let nextAssignee = current.assigneeId;
      if (!targetGroup) {
        // Personal: always the creator.
        if (input.assigneeId !== undefined && input.assigneeId !== current.createdBy)
          throw new AppError('validation_failed', 'Personal tasks are assigned to their creator', {
            fields: { assigneeId: 'invalid' },
          });
        nextAssignee = current.createdBy;
      } else if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) {
        if (!moving && !canAssign(viewer, facts))
          throw new AppError('forbidden', 'You cannot reassign this task');
        nextAssignee = input.assigneeId;
        if (nextAssignee) await assertMember(db, targetGroup, nextAssignee);
      } else if (moving && current.assigneeId) {
        // Keep the assignee if they are in the new group too; otherwise it becomes unassigned.
        try {
          await assertMember(db, targetGroup, current.assigneeId);
        } catch {
          nextAssignee = null;
        }
      }

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
          // A new due date gets its own reminders.
          patch.remindedDueSoonAt = null;
          patch.remindedOverdueAt = null;
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
      if (moving) {
        patch.groupId = targetGroup;
        log('moved', await groupRef(db, current.groupId), await groupRef(db, targetGroup));
      }
      if (nextAssignee !== current.assigneeId) {
        patch.assigneeId = nextAssignee;
        // Moving to Personal resets the assignee to the creator silently (it's implied by the move).
        if (targetGroup) {
          if (nextAssignee) log('assigned', null, await userRef(db, nextAssignee));
          else log('unassigned', await userRef(db, current.assigneeId), null);
        }
      }

      if (!activity.length && !Object.keys(patch).length) {
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
        if (activity.length) await tx.insert(taskActivity).values(activity);
        return true;
      });
      if (!updated)
        throw new AppError('conflict', 'This task was changed elsewhere', {
          details: await this.get(viewer, id),
        });
      const title = patch.title ?? current.title;
      if (targetGroup && patch.assigneeId)
        await extra.notify({
          type: 'task_assigned',
          taskId: id,
          taskTitle: title,
          actorId: viewer.id,
          recipients: [patch.assigneeId],
        });
      if (patch.status)
        await extra.notify({
          type: 'status_changed',
          taskId: id,
          taskTitle: title,
          actorId: viewer.id,
          recipients: [current.createdBy, nextAssignee],
          data: { status: patch.status },
        });
      return this.get(viewer, id);
    },

    async remove(viewer: Viewer, id: string, ipHash: string | null) {
      const { task } = await getVisibleRow(viewer, id);
      if (!canDeleteTask(viewer, task))
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
      await extra.files.hide(task.audioFileId);
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

    /**
     * A member left or was removed: their open tasks in that group become unassigned.
     * Runs inside the caller's transaction.
     */
    async unassignMember(
      tx: Tx,
      groupId: string,
      userId: string,
      actorId: string,
      ipHash: string | null,
    ) {
      const open = await tx
        .update(tasks)
        .set({ assigneeId: null, version: sql`${tasks.version} + 1` })
        .where(
          and(
            eq(tasks.groupId, groupId),
            eq(tasks.assigneeId, userId),
            ne(tasks.status, 'done'),
            isNull(tasks.deletedAt),
          ),
        )
        .returning({ id: tasks.id });
      if (!open.length) return 0;
      const who = await userRef(tx, userId);
      await tx.insert(taskActivity).values(
        open.map((t) => ({
          id: newId(),
          taskId: t.id,
          actorId,
          type: 'unassigned' as const,
          fromValue: who,
          toValue: null,
          ipHash,
        })),
      );
      return open.length;
    },
  };
}
export type TaskService = ReturnType<typeof createTaskService>;
