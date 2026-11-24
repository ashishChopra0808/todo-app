import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  RETENTION_DAYS,
  canReport,
  isPlaceholderEmail,
  type AdminReportDetailDto,
  type AdminReportDto,
  type ReportAction,
  type adminReportListQuerySchema,
  type reportCreateSchema,
  type reportResolveSchema,
} from '@todo/shared';
import type { z } from 'zod';
import type { Config } from '../config';
import type { Db } from '../db/client';
import {
  comments,
  groupMembers,
  groups,
  reports,
  sessions,
  taskActivity,
  tasks,
  users,
} from '../db/schema';
import { AppError, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import type { Audit, AuditContext } from './audit';
import type { CommentService } from './comments';
import type { DailyLimits } from './daily-limits';
import type { Viewer } from './membership';
import type { TaskService } from './tasks';

type UserRow = typeof users.$inferSelect;
type ReportRow = typeof reports.$inferSelect;

const retention = () => new Date(Date.now() + RETENTION_DAYS * 24 * 3600 * 1000);

interface Deps {
  db: Db;
  config: Config;
  audit: Audit;
  limits: DailyLimits;
  tasks: TaskService;
  comments: CommentService;
}

export function createReportService(d: Deps) {
  const { db } = d;

  /** Owners are listed by email in OWNER_EMAILS and must have verified that email. */
  function isOwner(user: UserRow | null | undefined): boolean {
    if (!user || !user.emailVerified || user.emailIsPlaceholder || isPlaceholderEmail(user.email))
      return false;
    return d.config.OWNER_EMAILS.includes(user.email.toLowerCase());
  }

  /** Checks the reporter can see the item, and captures who owns it and what it said. */
  async function resolveTarget(viewer: Viewer, input: z.output<typeof reportCreateSchema>) {
    switch (input.targetType) {
      case 'task': {
        const t = await d.tasks.getVisible(viewer, input.targetId);
        return {
          ownerId: t.createdBy,
          groupId: t.groupId,
          snapshot: { title: t.title, description: t.description, status: t.status },
        };
      }
      case 'comment': {
        const c = await d.comments.visibleComment(viewer, input.targetId);
        if (c.removedAt) throw notFound();
        const t = await d.tasks.getVisible(viewer, c.taskId);
        return {
          ownerId: c.authorId,
          groupId: t.groupId,
          snapshot: { body: c.body, taskId: c.taskId, taskTitle: t.title, editedAt: c.editedAt },
        };
      }
      case 'group': {
        if (!viewer.groupRoles[input.targetId]) throw notFound();
        const g = await db.query.groups.findFirst({ where: eq(groups.id, input.targetId) });
        if (!g) throw notFound();
        // Reporting a group points at the group as a whole; anyone in it may report.
        return { ownerId: null, groupId: g.id, snapshot: { name: g.name, icon: g.icon } };
      }
      case 'user': {
        // You can only report people you share a group with.
        const myGroups = Object.keys(viewer.groupRoles);
        if (!myGroups.length) throw notFound();
        const shared = await db
          .select({ groupId: groupMembers.groupId })
          .from(groupMembers)
          .where(
            and(eq(groupMembers.userId, input.targetId), inArray(groupMembers.groupId, myGroups)),
          );
        if (!shared.length) throw notFound();
        const u = await db.query.users.findFirst({ where: eq(users.id, input.targetId) });
        if (!u) throw notFound();
        const groupId =
          input.groupId && shared.some((s) => s.groupId === input.groupId)
            ? input.groupId
            : shared[0]!.groupId;
        return { ownerId: u.id, groupId, snapshot: { name: u.name } };
      }
    }
  }

  async function toAdminDto(r: ReportRow, reporterName: string | null): Promise<AdminReportDto> {
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(reports)
      .where(
        and(
          eq(reports.targetType, r.targetType),
          eq(reports.targetId, r.targetId),
          eq(reports.status, 'open'),
        ),
      );
    return {
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason,
      details: r.details,
      status: r.status,
      action: (r.action as ReportAction | null) ?? null,
      reporter: r.reporterId ? { id: r.reporterId, name: reporterName ?? '' } : null,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      sameTargetOpen: n,
    };
  }

  async function suspend(owner: UserRow, userId: string, reason: string, meta: AuditContext) {
    if (userId === owner.id) throw new AppError('forbidden', 'You cannot suspend yourself');
    const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!target) throw notFound();
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          suspendedAt: target.suspendedAt ?? new Date(),
          suspensionReason: reason.slice(0, 500),
        })
        .where(eq(users.id, userId));
      // Ends every session: they are signed out everywhere at once.
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    });
    await d.audit('user_suspend', {
      actorUserId: owner.id,
      targetType: 'user',
      targetId: userId,
      ...meta,
    });
  }

  return {
    isOwner,

    async create(viewer: Viewer, input: z.output<typeof reportCreateSchema>, meta: AuditContext) {
      const target = await resolveTarget(viewer, input);
      if (!canReport(viewer, { type: input.targetType, ownerId: target.ownerId }))
        throw new AppError('forbidden', "You can't report your own content");
      // One open report per person per item: a second tap just confirms the first.
      const existing = await db.query.reports.findFirst({
        where: and(
          eq(reports.reporterId, viewer.id),
          eq(reports.targetType, input.targetType),
          eq(reports.targetId, input.targetId),
          eq(reports.status, 'open'),
        ),
      });
      if (existing) return { id: existing.id, created: false };
      await d.limits.consume('reports', viewer.id);
      const id = newId();
      await db.insert(reports).values({
        id,
        reporterId: viewer.id,
        targetType: input.targetType,
        targetId: input.targetId,
        groupId: target.groupId,
        ownerId: target.ownerId,
        reason: input.reason,
        details: input.details ?? null,
        snapshot: target.snapshot,
      });
      await d.audit('report_create', {
        actorUserId: viewer.id,
        targetType: 'report',
        targetId: id,
        metadata: { target: input.targetType, reason: input.reason },
        ...meta,
      });
      return { id, created: true };
    },

    async list(q: z.output<typeof adminReportListQuerySchema>) {
      const reporter = alias(users, 'reporter');
      const offset = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString()) || 0 : 0;
      const rows = await db
        .select({ r: reports, reporterName: reporter.name })
        .from(reports)
        .leftJoin(reporter, eq(reporter.id, reports.reporterId))
        .where(eq(reports.status, q.status))
        .orderBy(
          q.status === 'open' ? asc(reports.createdAt) : desc(reports.resolvedAt),
          desc(reports.id),
        )
        .limit(q.limit + 1)
        .offset(offset);
      const hasMore = rows.length > q.limit;
      return {
        items: await Promise.all(
          rows.slice(0, q.limit).map((x) => toAdminDto(x.r, x.reporterName)),
        ),
        nextCursor: hasMore ? Buffer.from(String(offset + q.limit)).toString('base64url') : null,
      };
    },

    async detail(id: string): Promise<AdminReportDetailDto> {
      const reporter = alias(users, 'reporter');
      const [row] = await db
        .select({ r: reports, reporterName: reporter.name })
        .from(reports)
        .leftJoin(reporter, eq(reporter.id, reports.reporterId))
        .where(eq(reports.id, id))
        .limit(1);
      if (!row) throw notFound();
      const r = row.r;
      const base = await toAdminDto(r, row.reporterName);
      const owner = r.ownerId
        ? await db.query.users.findFirst({ where: eq(users.id, r.ownerId) })
        : undefined;
      const group = r.groupId
        ? await db.query.groups.findFirst({ where: eq(groups.id, r.groupId) })
        : undefined;

      let current: Record<string, unknown> | null = null;
      const context: AdminReportDetailDto['context'] = [];
      const author = alias(users, 'author');
      const commentsAround = async (taskId: string, around?: Date) => {
        const near = await db
          .select({ c: comments, name: author.name })
          .from(comments)
          .leftJoin(author, eq(author.id, comments.authorId))
          .where(
            and(
              eq(comments.taskId, taskId),
              around
                ? sql`${comments.createdAt} BETWEEN ${new Date(around.getTime() - 7 * 864e5).toISOString()}::timestamptz AND ${new Date(around.getTime() + 7 * 864e5).toISOString()}::timestamptz`
                : undefined,
            ),
          )
          .orderBy(asc(comments.createdAt))
          .limit(10);
        for (const x of near)
          context.push({
            label: `${x.name ?? '—'}${x.c.deletedAt ? ' (deleted)' : ''}${x.c.removedAt ? ' (removed)' : ''}`,
            text: x.c.body ?? '',
            at: x.c.createdAt.toISOString(),
          });
      };

      if (r.targetType === 'task') {
        const t = await db.query.tasks.findFirst({ where: eq(tasks.id, r.targetId) });
        if (t) {
          current = {
            title: t.title,
            description: t.description,
            status: t.status,
            deleted: !!t.deletedAt,
            removed: !!t.removedAt,
          };
          await commentsAround(t.id);
        }
      } else if (r.targetType === 'comment') {
        const c = await db.query.comments.findFirst({ where: eq(comments.id, r.targetId) });
        if (c) {
          current = {
            body: c.body,
            edited: !!c.editedAt,
            deleted: !!c.deletedAt,
            removed: !!c.removedAt,
          };
          const t = await db.query.tasks.findFirst({ where: eq(tasks.id, c.taskId) });
          if (t) context.push({ label: 'Task', text: t.title, at: t.createdAt.toISOString() });
          await commentsAround(c.taskId, c.createdAt);
        }
      } else if (r.targetType === 'group') {
        if (group)
          current = {
            name: group.name,
            icon: group.icon,
            deleted: !!group.deletedAt,
            removed: !!group.removedAt,
          };
      } else if (owner) {
        current = { name: owner.name };
        // Their recent comments in the group where they were reported.
        const recent = await db
          .select({ c: comments, title: tasks.title })
          .from(comments)
          .innerJoin(tasks, eq(tasks.id, comments.taskId))
          .where(
            and(
              eq(comments.authorId, owner.id),
              r.groupId ? eq(tasks.groupId, r.groupId) : undefined,
            ),
          )
          .orderBy(desc(comments.createdAt))
          .limit(10);
        for (const x of recent)
          context.push({
            label: `On “${x.title}”`,
            text: x.c.body ?? '',
            at: x.c.createdAt.toISOString(),
          });
      }

      return {
        ...base,
        snapshot: r.snapshot,
        current,
        owner: owner ? { id: owner.id, name: owner.name, suspended: !!owner.suspendedAt } : null,
        group: group ? { id: group.id, name: group.name, icon: group.icon } : null,
        context,
      };
    },

    /**
     * Remove: the item is hidden ("Removed by a moderator") but kept for 180 days as evidence.
     * Reporting a person and choosing Remove suspends them. All open reports on the same item close.
     */
    async resolve(
      owner: UserRow,
      id: string,
      input: z.output<typeof reportResolveSchema>,
      meta: AuditContext,
    ) {
      const r = await db.query.reports.findFirst({ where: eq(reports.id, id) });
      if (!r) throw notFound();
      if (r.status !== 'open') throw new AppError('conflict', 'This report is already closed');
      const now = new Date();
      if (input.action === 'remove') {
        await db.transaction(async (tx) => {
          if (r.targetType === 'task') {
            await tx
              .update(tasks)
              .set({ removedAt: now, removedBy: owner.id, purgeAfter: retention() })
              .where(and(eq(tasks.id, r.targetId), isNull(tasks.removedAt)));
            await tx.insert(taskActivity).values({
              id: newId(),
              taskId: r.targetId,
              actorId: null,
              type: 'removed',
            });
          } else if (r.targetType === 'comment') {
            await tx
              .update(comments)
              .set({ removedAt: now, removedBy: owner.id, purgeAfter: retention() })
              .where(and(eq(comments.id, r.targetId), isNull(comments.removedAt)));
          } else if (r.targetType === 'group') {
            await tx
              .update(groups)
              .set({ removedAt: now, removedBy: owner.id, purgeAfter: retention() })
              .where(and(eq(groups.id, r.targetId), isNull(groups.removedAt)));
          }
        });
        if (r.targetType !== 'user')
          await d.audit('content_remove', {
            actorUserId: owner.id,
            targetType: r.targetType,
            targetId: r.targetId,
            metadata: { reportId: r.id, reason: r.reason },
            ...meta,
          });
      }
      const suspendId =
        (r.targetType === 'user' && input.action === 'remove') || input.suspendOwner
          ? r.ownerId
          : null;
      if (suspendId)
        await suspend(owner, suspendId, input.note || `Report ${r.id}: ${r.reason}`, meta);

      await db
        .update(reports)
        .set({
          status: input.action === 'remove' ? 'actioned' : 'dismissed',
          action: input.action,
          resolutionNote: input.note ?? null,
          resolvedBy: owner.id,
          resolvedAt: now,
        })
        .where(
          and(
            eq(reports.targetType, r.targetType),
            eq(reports.targetId, r.targetId),
            eq(reports.status, 'open'),
          ),
        );
      if (input.action === 'dismiss')
        await d.audit('report_dismiss', {
          actorUserId: owner.id,
          targetType: 'report',
          targetId: r.id,
          ...meta,
        });
      return this.detail(id);
    },

    suspend,

    async unsuspend(owner: UserRow, userId: string, meta: AuditContext) {
      const rows = await db
        .update(users)
        .set({ suspendedAt: null, suspensionReason: null })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      if (!rows.length) throw notFound();
      await d.audit('user_unsuspend', {
        actorUserId: owner.id,
        targetType: 'user',
        targetId: userId,
        ...meta,
      });
    },
  };
}
export type ReportService = ReturnType<typeof createReportService>;
