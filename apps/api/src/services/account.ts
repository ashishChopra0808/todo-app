import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import sharp, { type Metadata } from 'sharp';
import {
  RETENTION_DAYS,
  canonicalTimeZone,
  isPlaceholderEmail,
  type AppLocale,
  type MeDto,
  type SessionDto,
  type Theme,
} from '@todo/shared';
import type { Db } from '../db/client';
import {
  accounts,
  auditLogs,
  comments,
  consents,
  deletedAccounts,
  files,
  groupMembers,
  groups,
  notificationPreferences,
  notifications,
  pushSubscriptions,
  reports,
  sessions,
  taskActivity,
  tasks,
  users,
} from '../db/schema';
import type { CryptoKit } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { newId } from '../lib/ids';
import type { GroupService } from './groups';
import type { Storage } from './storage';

type UserRow = typeof users.$inferSelect;
const days = (n: number) => new Date(Date.now() + n * 24 * 3600 * 1000);

export function createAccountService(
  db: Db,
  storage: Storage,
  crypto: CryptoKit,
  groupService: Pick<GroupService, 'handOverOnAccountDelete'>,
) {
  async function avatarUrl(user: UserRow): Promise<string | null> {
    if (user.avatarFileId) {
      const file = await db.query.files.findFirst({
        where: and(eq(files.id, user.avatarFileId), isNull(files.deletedAt)),
      });
      if (file) return storage.signedUrl(file.storageKey);
    }
    return user.image ?? null;
  }

  return {
    async me(user: UserRow): Promise<MeDto> {
      const accts = await db.query.accounts.findMany({
        where: eq(accounts.userId, user.id),
        columns: { providerId: true, password: true },
      });
      return {
        id: user.id,
        name: user.name,
        email: user.emailIsPlaceholder || isPlaceholderEmail(user.email) ? null : user.email,
        emailVerified: user.emailIsPlaceholder ? false : user.emailVerified,
        phoneNumber: user.phoneNumber,
        phoneNumberVerified: user.phoneNumberVerified,
        avatarUrl: await avatarUrl(user),
        locale: user.locale as AppLocale,
        timeZone: canonicalTimeZone(user.timeZone),
        theme: user.theme as Theme,
        simpleMode: user.simpleMode,
        hasPassword: accts.some((a) => a.providerId === 'credential' && !!a.password),
        providers: [...new Set(accts.map((a) => a.providerId))],
        createdAt: user.createdAt.toISOString(),
      };
    },

    async setAvatar(user: UserRow, upload: Buffer) {
      let meta: Metadata;
      try {
        meta = await sharp(upload).metadata();
      } catch {
        throw new AppError('unsupported_file', 'Use a JPEG, PNG or WebP image');
      }
      if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) {
        throw new AppError('unsupported_file', 'Use a JPEG, PNG or WebP image');
      }
      // Re-encode: strips EXIF/GPS metadata and anything hidden in the original file.
      const out = await sharp(upload)
        .rotate()
        .resize(256, 256, { fit: 'cover' })
        .webp({ quality: 82 })
        .toBuffer();
      const id = newId();
      const key = `avatars/${user.id}/${id}.webp`;
      await storage.put(key, out, 'image/webp');
      await db.insert(files).values({
        id,
        ownerId: user.id,
        kind: 'avatar',
        storageKey: key,
        mimeType: 'image/webp',
        sizeBytes: out.length,
      });
      await this.removeAvatarFile(user);
      await db.update(users).set({ avatarFileId: id }).where(eq(users.id, user.id));
    },

    async removeAvatarFile(user: UserRow) {
      if (!user.avatarFileId) return;
      const old = await db.query.files.findFirst({ where: eq(files.id, user.avatarFileId) });
      if (old) {
        await storage.remove(old.storageKey).catch(() => undefined);
        await db.delete(files).where(eq(files.id, old.id));
      }
      await db.update(users).set({ avatarFileId: null }).where(eq(users.id, user.id));
    },

    async listSessions(userId: string, currentId: string | null): Promise<SessionDto[]> {
      const rows = await db.query.sessions.findMany({
        where: eq(sessions.userId, userId),
        orderBy: desc(sessions.updatedAt),
      });
      return rows
        .filter((s) => s.expiresAt > new Date())
        .map((s) => ({
          id: s.id,
          current: s.id === currentId,
          userAgent: s.userAgent,
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
        }));
    },

    async revokeSession(userId: string, sessionId: string) {
      const rows = await db
        .delete(sessions)
        .where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId)))
        .returning({ id: sessions.id });
      if (!rows.length) throw new AppError('not_found', 'Session not found');
    },

    /** DPDP: everything we hold about the user that they can see in the app, as JSON. */
    async exportData(user: UserRow) {
      /**
       * Voice recordings the person made, with a private download link for each. The links
       * work for 7 days (the longest storage allows), long enough to save them.
       */
      const exportRecordings = async (userId: string) => {
        const rows = await db.query.files.findMany({
          where: and(
            eq(files.ownerId, userId),
            inArray(files.kind, ['task_audio', 'comment_audio']),
            eq(files.status, 'ready'),
            isNull(files.deletedAt),
          ),
          orderBy: asc(files.createdAt),
        });
        if (!rows.length) return [];
        const ids = rows.map((r) => r.id);
        const onTasks = await db
          .select({ fileId: tasks.audioFileId, taskId: tasks.id })
          .from(tasks)
          .where(and(inArray(tasks.audioFileId, ids), isNull(tasks.deletedAt)));
        const onComments = await db
          .select({ fileId: comments.audioFileId, commentId: comments.id, taskId: comments.taskId })
          .from(comments)
          .where(and(inArray(comments.audioFileId, ids), isNull(comments.deletedAt)));
        const LINK_SECONDS = 7 * 24 * 60 * 60;
        return Promise.all(
          rows.map(async (f) => {
            const t = onTasks.find((x) => x.fileId === f.id);
            const c = onComments.find((x) => x.fileId === f.id);
            // Only recordings still attached to something the person can see.
            if (!t && !c) return null;
            return {
              id: f.id,
              kind: f.kind === 'task_audio' ? 'voice_task' : 'voice_reply',
              taskId: t?.taskId ?? c?.taskId ?? null,
              commentId: c?.commentId ?? null,
              durationSeconds: f.durationMs ? Math.round(f.durationMs / 1000) : null,
              type: f.mimeType,
              createdAt: f.createdAt,
              downloadUrl: await storage.signedUrl(f.storageKey, LINK_SECONDS),
              downloadUrlExpiresAt: new Date(Date.now() + LINK_SECONDS * 1000).toISOString(),
            };
          }),
        ).then((list) => list.filter((x) => x !== null));
      };

      const me = await this.me(user);
      const myTasks = await db.query.tasks.findMany({
        where: and(eq(tasks.createdBy, user.id), isNull(tasks.deletedAt), isNull(tasks.removedAt)),
        orderBy: asc(tasks.createdAt),
      });
      const activity = myTasks.length
        ? await db.query.taskActivity.findMany({
            where: eq(taskActivity.actorId, user.id),
            orderBy: asc(taskActivity.createdAt),
          })
        : [];
      return {
        exportedAt: new Date().toISOString(),
        format: 'todo-export-v3',
        profile: { ...me, avatarUrl: undefined },
        consents: await db.query.consents.findMany({
          where: eq(consents.userId, user.id),
          columns: { kind: true, version: true, grantedAt: true },
        }),
        sessions: (await this.listSessions(user.id, null)).map(({ userAgent, createdAt }) => ({
          userAgent,
          createdAt,
        })),
        tasks: myTasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          dueAt: t.dueAt,
          dueHasTime: t.dueHasTime,
          priority: t.priority,
          status: t.status,
          completedAt: t.completedAt,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
        taskActivity: activity.map((a) => ({
          taskId: a.taskId,
          type: a.type,
          from: a.fromValue,
          to: a.toValue,
          at: a.createdAt,
        })),
        groups: (
          await db
            .select({
              id: groups.id,
              name: groups.name,
              role: groupMembers.role,
              joinedAt: groupMembers.joinedAt,
            })
            .from(groupMembers)
            .innerJoin(groups, eq(groups.id, groupMembers.groupId))
            .where(and(eq(groupMembers.userId, user.id), isNull(groups.deletedAt)))
            .orderBy(asc(groupMembers.joinedAt))
        ).map((g) => ({ ...g, joinedAt: g.joinedAt.toISOString() })),
        comments: (
          await db.query.comments.findMany({
            where: and(
              eq(comments.authorId, user.id),
              isNull(comments.deletedAt),
              isNull(comments.removedAt),
            ),
            orderBy: asc(comments.createdAt),
          })
        ).map((c) => ({
          id: c.id,
          taskId: c.taskId,
          body: c.body,
          createdAt: c.createdAt,
          editedAt: c.editedAt,
        })),
        voiceRecordings: await exportRecordings(user.id),
        notificationSettings: (
          await db.query.notificationPreferences.findMany({
            where: eq(notificationPreferences.userId, user.id),
            columns: { type: true, channel: true, enabled: true },
          })
        ).map((p) => ({ ...p })),
        reportsMade: (
          await db.query.reports.findMany({
            where: eq(reports.reporterId, user.id),
            columns: { targetType: true, reason: true, status: true, createdAt: true },
            orderBy: asc(reports.createdAt),
          })
        ).map((r) => ({ ...r })),
        securityEvents: (
          await db.query.auditLogs.findMany({
            where: eq(auditLogs.actorUserId, user.id),
            columns: { action: true, createdAt: true },
            orderBy: asc(auditLogs.createdAt),
          })
        ).map((e) => ({ action: e.action, at: e.createdAt })),
      };
    },

    async hasPassword(userId: string): Promise<{ hash: string } | null> {
      const acct = await db.query.accounts.findFirst({
        where: and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')),
        columns: { password: true },
      });
      return acct?.password ? { hash: acct.password } : null;
    },

    /**
     * Deletes the account immediately. Registration details move to deleted_accounts
     * (encrypted, 180 days, IT Rules 3(1)(h)); the user's content is hidden and purged after 180 days.
     */
    async deleteAccount(user: UserRow) {
      const purgeAfter = days(RETENTION_DAYS);
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.insert(deletedAccounts).values({
          id: newId(),
          formerUserId: user.id,
          encryptedData: crypto.encrypt(
            JSON.stringify({
              name: user.name,
              email: user.emailIsPlaceholder ? null : user.email,
              phoneNumber: user.phoneNumber,
              signupIp: user.signupIp,
            }),
          ),
          signedUpAt: user.createdAt,
          purgeAfter,
        });
        await tx
          .update(tasks)
          .set({ deletedAt: now, purgeAfter })
          .where(and(eq(tasks.createdBy, user.id), isNull(tasks.groupId), isNull(tasks.deletedAt)));
        // Their comments disappear for everyone (kept hidden 180 days). Group tasks they created
        // stay with the group; their open group tasks become unassigned (assignee FK is SET NULL).
        await tx
          .update(comments)
          .set({ deletedAt: now, purgeAfter })
          .where(and(eq(comments.authorId, user.id), isNull(comments.deletedAt)));
        await groupService.handOverOnAccountDelete(tx, user.id);
        await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
        await tx.delete(notifications).where(eq(notifications.userId, user.id));
        await tx
          .update(files)
          .set({ deletedAt: now, purgeAfter: now })
          .where(and(eq(files.ownerId, user.id), eq(files.kind, 'avatar')));
        await tx
          .update(files)
          .set({ deletedAt: now, purgeAfter })
          .where(and(eq(files.ownerId, user.id), isNull(files.deletedAt)));
        // Sessions, accounts and consents cascade. Audit rows keep the event, actor becomes null.
        await tx.delete(users).where(eq(users.id, user.id));
      });
    },
  };
}
export type AccountService = ReturnType<typeof createAccountService>;
