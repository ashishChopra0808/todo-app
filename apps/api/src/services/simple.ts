import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type {
  PersonRef,
  SimpleConversationDto,
  SimpleHomeDto,
  SimpleItemDto,
  SimplePersonDto,
} from '@todo/shared';
import type { Db } from '../db/client';
import { comments, files, groupMembers, notifications, tasks, users } from '../db/schema';
import { notFound } from '../lib/errors';
import type { AvatarUrl } from './avatars';
import type { FileService } from './files';
import { groupIdsOf, type Viewer } from './membership';

type TaskRow = typeof tasks.$inferSelect;
type CommentRow = typeof comments.$inferSelect;

/**
 * Simple mode (P4): a voice-first view built on tasks and comments, so there is no chat system.
 * A "message to a person" is a task assigned to them in a group you share; a "reply" is a comment
 * on it; "Yes, done" sets the task to Done.
 */
export function createSimpleService(db: Db, fileService: FileService, avatarUrl: AvatarUrl) {
  async function people(viewer: Viewer, ids?: string[]) {
    const groupIds = groupIdsOf(viewer);
    if (!groupIds.length) return [];
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        image: users.image,
        avatarKey: files.storageKey,
        groupId: groupMembers.groupId,
      })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .leftJoin(files, and(eq(files.id, users.avatarFileId), isNull(files.deletedAt)))
      .where(
        and(
          inArray(groupMembers.groupId, groupIds),
          ne(groupMembers.userId, viewer.id),
          isNull(users.suspendedAt),
          ids ? inArray(users.id, ids) : undefined,
        ),
      )
      .orderBy(asc(groupMembers.joinedAt));
    const seen = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r);
    return [...seen.values()];
  }

  const visibleTask = and(
    isNull(tasks.deletedAt),
    isNull(tasks.removedAt),
    sql`NOT EXISTS (SELECT 1 FROM users su WHERE su.id = ${tasks.createdBy} AND su.suspended_at IS NOT NULL)`,
  );

  /** Tasks between me and one person (either direction), in groups we're both in. */
  function between(viewer: Viewer, otherId: string) {
    return and(
      visibleTask,
      inArray(tasks.groupId, groupIdsOf(viewer)),
      or(
        and(eq(tasks.createdBy, viewer.id), eq(tasks.assigneeId, otherId)),
        and(eq(tasks.createdBy, otherId), eq(tasks.assigneeId, viewer.id)),
      ),
    );
  }

  async function unreadTaskActors(userId: string) {
    const rows = await db
      .select({ taskId: notifications.taskId, actorId: notifications.actorId })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          inArray(notifications.type, ['task_assigned', 'comment_added']),
        ),
      );
    return new Set(rows.map((r) => `${r.taskId}:${r.actorId}`));
  }

  async function taskItem(
    viewer: Viewer,
    t: TaskRow,
    from: PersonRef | null,
    unread: Set<string>,
  ): Promise<SimpleItemDto> {
    const fromMe = t.createdBy === viewer.id;
    return {
      kind: 'task',
      id: t.id,
      taskId: t.id,
      fromMe,
      from,
      title: t.title,
      text: t.description,
      audio: await fileService.audioDto(t.audioFileId),
      status: t.status,
      forMe: t.assigneeId === viewer.id && t.status !== 'done',
      unread: !fromMe && unread.has(`${t.id}:${t.createdBy}`),
      createdAt: t.createdAt.toISOString(),
    };
  }

  async function replyItem(
    viewer: Viewer,
    c: CommentRow,
    task: TaskRow,
    from: PersonRef | null,
    unread: Set<string>,
  ): Promise<SimpleItemDto> {
    const fromMe = c.authorId === viewer.id;
    return {
      kind: 'reply',
      id: c.id,
      taskId: c.taskId,
      fromMe,
      from,
      title: null,
      text: c.removedAt ? null : c.body,
      audio: c.removedAt ? null : await fileService.audioDto(c.audioFileId),
      status: task.status,
      forMe: false,
      unread: !fromMe && unread.has(`${c.taskId}:${c.authorId}`),
      createdAt: c.createdAt.toISOString(),
    };
  }

  async function personRef(r: {
    id: string;
    name: string;
    image: string | null;
    avatarKey: string | null;
  }) {
    return {
      id: r.id,
      name: r.name,
      avatarUrl: await avatarUrl({ avatarKey: r.avatarKey, image: r.image }),
    };
  }

  return {
    async home(viewer: Viewer): Promise<SimpleHomeDto> {
      const list = await people(viewer);
      const unread = await unreadTaskActors(viewer.id);
      const refs = new Map(
        await Promise.all(list.map(async (p) => [p.id, await personRef(p)] as const)),
      );

      // Unread counts and recency per person.
      const recent = new Map<string, number>();
      const unreadBy = new Map<string, number>();
      for (const key of unread) {
        const actor = key.split(':')[1]!;
        unreadBy.set(actor, (unreadBy.get(actor) ?? 0) + 1);
      }
      if (list.length) {
        const ts = await db
          .select({
            other: sql<string>`CASE WHEN ${tasks.createdBy} = ${viewer.id} THEN ${tasks.assigneeId} ELSE ${tasks.createdBy} END`,
            at: sql<string>`max(${tasks.updatedAt})`,
          })
          .from(tasks)
          .where(
            and(
              visibleTask,
              inArray(tasks.groupId, groupIdsOf(viewer)),
              or(eq(tasks.createdBy, viewer.id), eq(tasks.assigneeId, viewer.id)),
            ),
          )
          .groupBy(sql`1`);
        for (const r of ts) if (r.other) recent.set(r.other, new Date(r.at).getTime());
      }
      const ppl: SimplePersonDto[] = list
        .map((p) => ({ ...refs.get(p.id)!, groupId: p.groupId, unread: unreadBy.get(p.id) ?? 0 }))
        .sort((a, b) => (recent.get(b.id) ?? 0) - (recent.get(a.id) ?? 0));

      // Newest unheard: the latest unread notification about a task or reply from someone.
      let newest: SimpleItemDto | null = null;
      const [n] = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, viewer.id),
            isNull(notifications.readAt),
            inArray(notifications.type, ['task_assigned', 'comment_added']),
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(1);
      if (n?.taskId && n.actorId && refs.has(n.actorId)) {
        const [t] = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, n.taskId), visibleTask))
          .limit(1);
        if (t && t.groupId && viewer.groupRoles[t.groupId]) {
          if (n.type === 'comment_added') {
            const [c] = await db
              .select()
              .from(comments)
              .where(
                and(
                  eq(comments.taskId, t.id),
                  eq(comments.authorId, n.actorId),
                  isNull(comments.deletedAt),
                ),
              )
              .orderBy(desc(comments.createdAt))
              .limit(1);
            if (c) newest = await replyItem(viewer, c, t, refs.get(n.actorId)!, unread);
          } else newest = await taskItem(viewer, t, refs.get(n.actorId)!, unread);
        }
      }

      // The oldest open task someone else gave me.
      let taskForMe: SimpleItemDto | null = null;
      const groups = groupIdsOf(viewer);
      if (groups.length) {
        const [t] = await db
          .select()
          .from(tasks)
          .where(
            and(
              visibleTask,
              inArray(tasks.groupId, groups),
              eq(tasks.assigneeId, viewer.id),
              ne(tasks.createdBy, viewer.id),
              ne(tasks.status, 'done'),
            ),
          )
          .orderBy(asc(tasks.createdAt))
          .limit(1);
        if (t) taskForMe = await taskItem(viewer, t, refs.get(t.createdBy ?? '') ?? null, unread);
      }
      return { newest, taskForMe, people: ppl };
    },

    async conversation(viewer: Viewer, otherId: string): Promise<SimpleConversationDto> {
      const [p] = await people(viewer, [otherId]);
      if (!p) throw notFound(); // not someone I share a group with
      const unread = await unreadTaskActors(viewer.id);
      const them = await personRef(p);
      const ts = await db
        .select()
        .from(tasks)
        .where(between(viewer, otherId))
        .orderBy(desc(tasks.createdAt))
        .limit(30);
      const items: SimpleItemDto[] = [];
      for (const t of ts)
        items.push(await taskItem(viewer, t, t.createdBy === otherId ? them : null, unread));
      if (ts.length) {
        const cs = await db
          .select()
          .from(comments)
          .where(
            and(
              inArray(
                comments.taskId,
                ts.map((t) => t.id),
              ),
              isNull(comments.deletedAt),
              inArray(comments.authorId, [viewer.id, otherId]),
            ),
          );
        const byId = new Map(ts.map((t) => [t.id, t]));
        for (const c of cs)
          items.push(
            await replyItem(
              viewer,
              c,
              byId.get(c.taskId)!,
              c.authorId === otherId ? them : null,
              unread,
            ),
          );
      }
      items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const unreadCount = items.filter((i) => i.unread).length;
      return { person: { ...them, groupId: p.groupId, unread: unreadCount }, items };
    },

    /** Listening to their messages: mark what they sent me as heard. */
    async markHeard(viewer: Viewer, otherId: string) {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, viewer.id),
            eq(notifications.actorId, otherId),
            isNull(notifications.readAt),
          ),
        );
    },
  };
}
export type SimpleService = ReturnType<typeof createSimpleService>;
