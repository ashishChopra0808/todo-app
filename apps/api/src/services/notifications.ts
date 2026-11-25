import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import webpush from 'web-push';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  isPlaceholderEmail,
  type NotificationChannel,
  type NotificationDto,
  type NotificationListResponse,
  type NotificationPreferencesDto,
  type NotificationType,
  type PushSubscriptionInput,
  type notificationListQuerySchema,
} from '@todo/shared';
import { isLocale, translate } from '@todo/i18n';
import type { FastifyBaseLogger } from 'fastify';
import type { z } from 'zod';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { AppError } from '../lib/errors';
import {
  files,
  notificationPreferences,
  notifications,
  pushSubscriptions,
  tasks,
  users,
} from '../db/schema';
import { notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import type { AvatarUrl } from './avatars';
import type { EmailSender } from './email';

type UserRow = typeof users.$inferSelect;

/**
 * Push messages go only to the browsers' own push services. Any other address would let a
 * caller make our server send requests wherever they like (server-side request forgery).
 */
const PUSH_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge on Android, Samsung Internet, Opera
  'updates.push.services.mozilla.com', // Firefox
  '.push.services.mozilla.com',
  'web.push.apple.com', // Safari / iPhone home-screen apps
  '.push.apple.com',
  '.notify.windows.com', // Edge on Windows
];

export function isPushEndpointAllowed(endpoint: string, extraHosts: string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return [...PUSH_HOSTS, ...extraHosts].some((h) =>
    h.startsWith('.') ? host.endsWith(h) && host.length > h.length : host === h,
  );
}

export interface NotifyEvent {
  type: NotificationType;
  taskId: string;
  taskTitle: string;
  actorId: string | null;
  /** Who should hear about it. The actor and duplicates are removed. */
  recipients: Array<string | null | undefined>;
  data?: Record<string, unknown>;
}

const excerpt = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function createNotificationService(d: {
  db: Db;
  config: Config;
  email: EmailSender;
  avatarUrl: AvatarUrl;
  log: FastifyBaseLogger;
}) {
  const { db, config } = d;
  const pushEnabled = !!(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);
  const extraPushHosts = config.PUSH_EXTRA_HOSTS.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (pushEnabled)
    webpush.setVapidDetails(
      config.VAPID_SUBJECT,
      config.VAPID_PUBLIC_KEY!,
      config.VAPID_PRIVATE_KEY!,
    );
  /** Deliveries in flight (push + email), so tests and shutdown can wait for them. */
  const pending = new Set<Promise<unknown>>();
  const track = (p: Promise<unknown>) => {
    const q = p.catch((err: unknown) => d.log.warn({ err }, 'notification delivery failed'));
    pending.add(q);
    void q.finally(() => pending.delete(q));
  };

  const emailOf = (u: UserRow) =>
    u.emailVerified && !u.emailIsPlaceholder && !isPlaceholderEmail(u.email) ? u.email : null;

  async function disabledFor(userIds: string[], type: NotificationType) {
    if (!userIds.length) return new Set<string>();
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          inArray(notificationPreferences.userId, userIds),
          eq(notificationPreferences.type, type),
          eq(notificationPreferences.enabled, false),
        ),
      );
    return new Set(rows.map((r) => `${r.userId}:${r.channel}`));
  }

  /** Words for push and email, in the recipient's language. */
  function message(u: UserRow, e: NotifyEvent, actorName: string | null) {
    const locale = isLocale(u.locale) ? u.locale : 'en';
    const vars = {
      name: actorName ?? translate(locale, 'notify.someone'),
      task: excerpt(e.taskTitle, 60),
      status: e.data?.status ? translate(locale, `task.status.${String(e.data.status)}`) : '',
      comment: typeof e.data?.excerpt === 'string' ? e.data.excerpt : '',
    };
    const key =
      e.type === 'comment_added' && e.data?.voice ? 'comment_added_voice' : (e.type as string);
    return {
      locale,
      title: translate(locale, `notify.${key}.title`, vars),
      body: translate(locale, `notify.${key}.body`, vars),
    };
  }

  async function deliverPush(userId: string, payload: Record<string, unknown>) {
    const subs = await db.query.pushSubscriptions.findMany({
      where: eq(pushSubscriptions.userId, userId),
    });
    for (const s of subs) {
      if (!isPushEndpointAllowed(s.endpoint, extraPushHosts)) continue; // saved before the check
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 24 * 3600, urgency: 'normal' },
        );
        await db
          .update(pushSubscriptions)
          .set({ lastUsedAt: new Date() })
          .where(eq(pushSubscriptions.id, s.id));
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // The browser threw the subscription away: forget it.
        if (status === 404 || status === 410)
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        else throw err;
      }
    }
  }

  return {
    pushEnabled,
    vapidPublicKey: config.VAPID_PUBLIC_KEY ?? null,

    /** Waits for push/email deliveries started so far (tests, graceful shutdown). */
    async flush() {
      await Promise.all([...pending]);
    },

    /**
     * Records an in-app notification and sends push and email, each only if the recipient has
     * that type and channel switched on. Never throws into the caller's request.
     */
    async notify(e: NotifyEvent) {
      try {
        const ids = [...new Set(e.recipients.filter((x): x is string => !!x && x !== e.actorId))];
        if (!ids.length) return;
        const people = await db.query.users.findMany({
          where: and(inArray(users.id, ids), isNull(users.suspendedAt)),
        });
        if (!people.length) return;
        const off = await disabledFor(
          people.map((p) => p.id),
          e.type,
        );
        const on = (u: string, c: NotificationChannel) => !off.has(`${u}:${c}`);
        const actor = e.actorId
          ? await db.query.users.findFirst({ where: eq(users.id, e.actorId) })
          : undefined;

        const inApp = people.filter((p) => on(p.id, 'in_app'));
        if (inApp.length)
          await db.insert(notifications).values(
            inApp.map((p) => ({
              id: newId(),
              userId: p.id,
              type: e.type,
              taskId: e.taskId,
              actorId: e.actorId,
              data: e.data ?? {},
            })),
          );

        for (const p of people) {
          const m = message(p, e, actor?.name ?? null);
          const url = `/tasks/${e.taskId}`;
          if (pushEnabled && on(p.id, 'push'))
            track(
              deliverPush(p.id, {
                title: m.title,
                body: m.body,
                url,
                tag: `${e.type}:${e.taskId}`,
              }),
            );
          const to = emailOf(p);
          if (to && on(p.id, 'email'))
            track(
              d.email.send({
                to,
                subject: m.title,
                text: `${m.body}\n\n${translate(m.locale, 'notify.open')}: ${config.APP_ORIGIN}${url}\n\n${translate(m.locale, 'notify.manage', { url: `${config.APP_ORIGIN}/settings#notifications` })}`,
                purpose: `notify-${e.type}`,
              }),
            );
        }
      } catch (err) {
        d.log.error({ err, type: e.type }, 'notify failed');
      }
    },

    async list(
      userId: string,
      q: z.output<typeof notificationListQuerySchema>,
    ): Promise<NotificationListResponse> {
      const offset = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString()) || 0 : 0;
      const rows = await db
        .select({
          n: notifications,
          taskTitle: tasks.title,
          taskHidden: sql<boolean>`(${tasks.deletedAt} IS NOT NULL OR ${tasks.removedAt} IS NOT NULL)`,
          actorName: users.name,
          actorImage: users.image,
          actorAvatarKey: files.storageKey,
        })
        .from(notifications)
        .leftJoin(tasks, eq(tasks.id, notifications.taskId))
        .leftJoin(users, eq(users.id, notifications.actorId))
        .leftJoin(files, and(eq(files.id, users.avatarFileId), isNull(files.deletedAt)))
        .where(
          and(
            eq(notifications.userId, userId),
            q.unread === '1' ? isNull(notifications.readAt) : undefined,
          ),
        )
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(q.limit + 1)
        .offset(offset);
      const hasMore = rows.length > q.limit;
      const items: NotificationDto[] = await Promise.all(
        rows.slice(0, q.limit).map(async (r) => ({
          id: r.n.id,
          type: r.n.type,
          // A deleted or removed task: keep the entry, drop the link and the title.
          task:
            r.n.taskId && r.taskTitle && !r.taskHidden
              ? { id: r.n.taskId, title: r.taskTitle }
              : null,
          actor: r.n.actorId
            ? {
                id: r.n.actorId,
                name: r.actorName ?? '',
                avatarUrl: await d.avatarUrl({ avatarKey: r.actorAvatarKey, image: r.actorImage }),
              }
            : null,
          data: r.n.data,
          readAt: r.n.readAt?.toISOString() ?? null,
          createdAt: r.n.createdAt.toISOString(),
        })),
      );
      return {
        items,
        nextCursor: hasMore ? Buffer.from(String(offset + q.limit)).toString('base64url') : null,
        unreadCount: await this.unreadCount(userId),
      };
    },

    async unreadCount(userId: string) {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
      return r?.n ?? 0;
    },

    async markRead(userId: string, id: string) {
      const rows = await db
        .update(notifications)
        .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
        .returning({ id: notifications.id });
      if (!rows.length) throw notFound();
    },

    async markAllRead(userId: string) {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    },

    /** Opening a task marks its notifications read. */
    async markTaskRead(userId: string, taskId: string) {
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.taskId, taskId),
            isNull(notifications.readAt),
          ),
        );
    },

    async preferences(user: UserRow): Promise<NotificationPreferencesDto> {
      const rows = await db.query.notificationPreferences.findMany({
        where: eq(notificationPreferences.userId, user.id),
      });
      const off = new Set(rows.filter((r) => !r.enabled).map((r) => `${r.type}:${r.channel}`));
      return {
        preferences: NOTIFICATION_TYPES.flatMap((type) =>
          NOTIFICATION_CHANNELS.map((channel) => ({
            type,
            channel,
            enabled: !off.has(`${type}:${channel}`),
          })),
        ),
        pushAvailable: pushEnabled,
        emailAvailable: !!emailOf(user),
      };
    },

    async setPreferences(
      user: UserRow,
      prefs: Array<{ type: NotificationType; channel: NotificationChannel; enabled: boolean }>,
    ) {
      for (const p of prefs) {
        if (p.enabled)
          await db
            .delete(notificationPreferences)
            .where(
              and(
                eq(notificationPreferences.userId, user.id),
                eq(notificationPreferences.type, p.type),
                eq(notificationPreferences.channel, p.channel),
              ),
            );
        else
          await db
            .insert(notificationPreferences)
            .values({ userId: user.id, type: p.type, channel: p.channel, enabled: false })
            .onConflictDoUpdate({
              target: [
                notificationPreferences.userId,
                notificationPreferences.type,
                notificationPreferences.channel,
              ],
              set: { enabled: false, updatedAt: new Date() },
            });
      }
      return this.preferences(user);
    },

    async subscribe(userId: string, sub: PushSubscriptionInput, userAgent: string | null) {
      if (!isPushEndpointAllowed(sub.endpoint, extraPushHosts)) {
        throw new AppError('validation_failed', 'Not a browser push service', {
          fields: { endpoint: 'invalid' },
        });
      }
      // An endpoint belongs to one browser: if someone else signs in there, it moves to them.
      await db
        .insert(pushSubscriptions)
        .values({
          id: newId(),
          userId,
          endpoint: sub.endpoint,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
          userAgent: userAgent?.slice(0, 300) ?? null,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, createdAt: new Date() },
        });
    },

    async unsubscribe(userId: string, endpoint: string) {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
    },

    /** Daily job: in-app notifications older than 90 days go. */
    async prune(now = new Date()) {
      const rows = await db
        .delete(notifications)
        .where(lt(notifications.createdAt, new Date(now.getTime() - 90 * 864e5)))
        .returning({ id: notifications.id });
      return rows.length;
    },
  };
}
export type NotificationService = ReturnType<typeof createNotificationService>;
