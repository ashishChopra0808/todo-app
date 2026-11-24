import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  AUDIO,
  notificationListQuerySchema,
  notificationPreferencesSchema,
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
  uuidSchema,
} from '@todo/shared';
import type { AppDeps } from '../app';
import { users } from '../db/schema';
import { AppError } from '../lib/errors';

/** Voice recordings, notifications, web push and Simple mode. */
export function phase3Routes(app: FastifyInstance, deps: AppDeps) {
  const pre = { preHandler: deps.requireUser };
  const id = (params: unknown) => uuidSchema.parse((params as { id: string }).id);

  // Upload a recording; attach it with POST /tasks (audioFileId) or POST /tasks/:id/comments.
  app.post(
    '/api/v1/files',
    { ...pre, config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const file = await req.file({ limits: { fileSize: AUDIO.maxBytes, files: 1, fields: 3 } });
      if (!file) throw new AppError('validation_failed', 'No file uploaded');
      const buf = await file.toBuffer();
      if (file.file.truncated)
        throw new AppError('file_too_large', 'Recordings must be 5 MB or smaller');
      const field = (name: string) => {
        const f = file.fields[name] as { value?: unknown } | undefined;
        return typeof f?.value === 'string' ? f.value : undefined;
      };
      const kind = field('kind') === 'comment_audio' ? 'comment_audio' : 'task_audio';
      const raw = Number(field('durationMs'));
      const saved = await deps.files.uploadAudio(
        req.user!.id,
        kind,
        buf,
        Number.isFinite(raw) && raw > 0 ? raw : null,
      );
      return reply.status(201).send(saved);
    },
  );

  app.get('/api/v1/notifications', pre, async (req) =>
    deps.notifications.list(req.user!.id, notificationListQuerySchema.parse(req.query)),
  );
  app.get('/api/v1/notifications/unread-count', pre, async (req) => ({
    count: await deps.notifications.unreadCount(req.user!.id),
  }));
  app.post('/api/v1/notifications/:id/read', pre, async (req, reply) => {
    await deps.notifications.markRead(req.user!.id, id(req.params));
    return reply.status(204).send();
  });
  app.post('/api/v1/notifications/read-all', pre, async (req, reply) => {
    await deps.notifications.markAllRead(req.user!.id);
    return reply.status(204).send();
  });

  app.get('/api/v1/me/notification-preferences', pre, async (req) =>
    deps.notifications.preferences(req.user!),
  );
  app.put('/api/v1/me/notification-preferences', pre, async (req) => {
    const body = notificationPreferencesSchema.parse(req.body);
    const fresh = await deps.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    return deps.notifications.setPreferences(fresh!, body.preferences);
  });

  // Public key only; the private key never leaves the server.
  app.get('/api/v1/push/vapid-key', pre, async () => ({
    key: deps.notifications.vapidPublicKey,
  }));
  app.post('/api/v1/push-subscriptions', pre, async (req, reply) => {
    if (!deps.notifications.pushEnabled)
      throw new AppError('validation_failed', 'Push notifications are not set up yet');
    const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    await deps.notifications.subscribe(req.user!.id, pushSubscriptionSchema.parse(req.body), ua);
    return reply.status(204).send();
  });
  app.delete('/api/v1/push-subscriptions', pre, async (req, reply) => {
    await deps.notifications.unsubscribe(
      req.user!.id,
      pushUnsubscribeSchema.parse(req.body).endpoint,
    );
    return reply.status(204).send();
  });

  app.get('/api/v1/simple/home', pre, async (req) => deps.simple.home(await deps.viewerOf(req)));
  app.get('/api/v1/simple/people/:id', pre, async (req) =>
    deps.simple.conversation(await deps.viewerOf(req), id(req.params)),
  );
  app.post('/api/v1/simple/people/:id/heard', pre, async (req, reply) => {
    await deps.simple.markHeard(await deps.viewerOf(req), id(req.params));
    return reply.status(204).send();
  });
}
