import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  RETENTION_DAYS,
  canComment,
  canDeleteComment,
  canEditComment,
  canReport,
  type CommentDto,
  type CommentListResponse,
  type commentCreateSchema,
  type commentListQuerySchema,
} from '@todo/shared';
import type { z } from 'zod';
import type { Db } from '../db/client';
import { comments, files, taskActivity, users } from '../db/schema';
import { AppError, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import type { AvatarUrl } from './avatars';
import type { DailyLimits } from './daily-limits';
import type { Viewer } from './membership';
import { taskFacts, type TaskService } from './tasks';

type CommentRow = typeof comments.$inferSelect;

const authorNotSuspended = sql`NOT EXISTS (SELECT 1 FROM users su WHERE su.id = ${comments.authorId} AND su.suspended_at IS NOT NULL)`;

export function createCommentService(
  db: Db,
  tasks: TaskService,
  avatarUrl: AvatarUrl,
  limits: DailyLimits,
) {
  const selectJoined = () =>
    db
      .select({
        c: comments,
        authorName: users.name,
        authorImage: users.image,
        authorAvatarKey: files.storageKey,
      })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.authorId))
      .leftJoin(files, and(eq(files.id, users.avatarFileId), isNull(files.deletedAt)));

  type Joined = Awaited<ReturnType<ReturnType<typeof selectJoined>['where']>>[number];

  async function toDto(r: Joined, viewer: Viewer): Promise<CommentDto> {
    const removed = !!r.c.removedAt;
    return {
      id: r.c.id,
      taskId: r.c.taskId,
      author: r.c.authorId
        ? {
            id: r.c.authorId,
            name: r.authorName ?? '',
            avatarUrl: await avatarUrl({ avatarKey: r.authorAvatarKey, image: r.authorImage }),
          }
        : null,
      body: removed ? null : r.c.body,
      removed,
      editedAt: r.c.editedAt?.toISOString() ?? null,
      createdAt: r.c.createdAt.toISOString(),
      permissions: {
        edit: !removed && canEditComment(viewer, r.c),
        delete: !removed && canDeleteComment(viewer, r.c),
        report: !removed && canReport(viewer, { type: 'comment', ownerId: r.c.authorId }),
      },
    };
  }

  /** The comment, if the viewer can see its task. Deleted or suspended authors' comments are 404. */
  async function visibleComment(viewer: Viewer, id: string): Promise<CommentRow> {
    const c = await db.query.comments.findFirst({
      where: and(eq(comments.id, id), isNull(comments.deletedAt), authorNotSuspended),
    });
    if (!c) throw notFound();
    await tasks.getVisible(viewer, c.taskId); // throws 404 if the task isn't visible
    return c;
  }

  async function getDto(viewer: Viewer, id: string) {
    const [row] = await selectJoined().where(eq(comments.id, id)).limit(1);
    if (!row) throw notFound();
    return toDto(row, viewer);
  }

  return {
    visibleComment,

    async list(
      viewer: Viewer,
      taskId: string,
      q: z.output<typeof commentListQuerySchema>,
    ): Promise<CommentListResponse> {
      await tasks.getVisible(viewer, taskId);
      const offset = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString()) || 0 : 0;
      const rows = await selectJoined()
        .where(and(eq(comments.taskId, taskId), isNull(comments.deletedAt), authorNotSuspended))
        .orderBy(asc(comments.createdAt), asc(comments.id))
        .limit(q.limit + 1)
        .offset(offset);
      const hasMore = rows.length > q.limit;
      return {
        items: await Promise.all(rows.slice(0, q.limit).map((r) => toDto(r, viewer))),
        nextCursor: hasMore ? Buffer.from(String(offset + q.limit)).toString('base64url') : null,
      };
    },

    async create(
      viewer: Viewer,
      taskId: string,
      input: z.output<typeof commentCreateSchema>,
      ipHash: string | null,
    ) {
      const task = await tasks.getVisible(viewer, taskId);
      if (!canComment(viewer, taskFacts(task)))
        throw new AppError('forbidden', 'You cannot comment on this task');
      const id = input.id ?? newId();
      if (input.id) {
        const existing = await db.query.comments.findFirst({ where: eq(comments.id, id) });
        if (existing) {
          if (existing.authorId === viewer.id && existing.taskId === taskId)
            return { comment: await getDto(viewer, id), created: false };
          throw new AppError('conflict', 'This id is already used');
        }
      }
      await limits.consume('comments', viewer.id);
      await db.transaction(async (tx) => {
        await tx.insert(comments).values({ id, taskId, authorId: viewer.id, body: input.body });
        await tx.insert(taskActivity).values({
          id: newId(),
          taskId,
          actorId: viewer.id,
          type: 'commented',
          toValue: { commentId: id },
          ipHash,
        });
      });
      return { comment: await getDto(viewer, id), created: true };
    },

    async update(viewer: Viewer, id: string, body: string) {
      const c = await visibleComment(viewer, id);
      if (c.removedAt || !canEditComment(viewer, c))
        throw new AppError('forbidden', 'You can only edit your own comments');
      if (c.body !== body)
        await db.update(comments).set({ body, editedAt: new Date() }).where(eq(comments.id, id));
      return getDto(viewer, id);
    },

    /** Hidden at once; kept for 180 days (evidence), then purged. */
    async remove(viewer: Viewer, id: string) {
      const c = await visibleComment(viewer, id);
      if (c.removedAt || !canDeleteComment(viewer, c))
        throw new AppError('forbidden', 'You can only delete your own comments');
      await db
        .update(comments)
        .set({
          deletedAt: new Date(),
          purgeAfter: new Date(Date.now() + RETENTION_DAYS * 24 * 3600 * 1000),
        })
        .where(eq(comments.id, id));
    },
  };
}
export type CommentService = ReturnType<typeof createCommentService>;
