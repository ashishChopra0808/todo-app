import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { LIMITS, deleteAccountSchema, profileUpdateSchema } from '@todo/shared';
import type { AppDeps } from '../app';
import { verifyPassword } from '../auth/password-hash';
import { users } from '../db/schema';
import { AppError } from '../lib/errors';

export function meRoutes(app: FastifyInstance, deps: AppDeps) {
  const pre = { preHandler: deps.requireUser };
  const meta = (req: { clientIp: string; headers: Record<string, unknown>; id: string }) => ({
    ip: req.clientIp,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    requestId: req.id,
  });

  app.get('/api/v1/me', pre, async (req) => deps.accounts.me(req.user!));

  app.patch('/api/v1/me', pre, async (req) => {
    const input = profileUpdateSchema.parse(req.body);
    if (Object.keys(input).length) {
      await deps.db.update(users).set(input).where(eq(users.id, req.user!.id));
    }
    const fresh = await deps.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    return deps.accounts.me(fresh!);
  });

  app.put('/api/v1/me/avatar', pre, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: LIMITS.avatarBytes, files: 1, fields: 0 } });
    if (!file) throw new AppError('validation_failed', 'No file uploaded');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw new AppError('file_too_large', 'Images must be 2 MB or smaller');
    await deps.accounts.setAvatar(req.user!, buf);
    const fresh = await deps.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    return reply.send(await deps.accounts.me(fresh!));
  });

  app.delete('/api/v1/me/avatar', pre, async (req) => {
    await deps.accounts.removeAvatarFile(req.user!);
    const fresh = await deps.db.query.users.findFirst({ where: eq(users.id, req.user!.id) });
    return deps.accounts.me(fresh!);
  });

  app.get('/api/v1/me/sessions', pre, async (req) =>
    deps.accounts.listSessions(req.user!.id, req.authSession!.id),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/me/sessions/:id', pre, async (req, reply) => {
    await deps.accounts.revokeSession(req.user!.id, req.params.id);
    await deps.audit('session_revoke', {
      actorUserId: req.user!.id,
      targetType: 'session',
      targetId: req.params.id,
      ...meta(req),
    });
    return reply.status(204).send();
  });

  app.get(
    '/api/v1/me/export',
    { ...pre, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const data = await deps.accounts.exportData(req.user!);
      // The file is used outside the app, so every link in it is a full address.
      for (const r of data.voiceRecordings)
        if (r.downloadUrl.startsWith('/'))
          r.downloadUrl = `${deps.config.APP_ORIGIN}${r.downloadUrl}`;
      await deps.audit('data_export', { actorUserId: req.user!.id, ...meta(req) });
      const date = new Date().toISOString().slice(0, 10);
      return reply
        .header('content-disposition', `attachment; filename="todo-export-${date}.json"`)
        .header('cache-control', 'no-store')
        .send(data);
    },
  );

  app.delete(
    '/api/v1/me',
    { ...pre, config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const input = deleteAccountSchema.parse(req.body);
      const user = req.user!;
      const cred = await deps.accounts.hasPassword(user.id);
      if (cred) {
        if (
          !input.password ||
          !(await verifyPassword({ hash: cred.hash, password: input.password }))
        ) {
          throw new AppError('invalid_credentials', 'Password is incorrect', {
            fields: { password: 'invalid' },
          });
        }
      } else if (Date.now() - req.authSession!.createdAt.getTime() > 10 * 60 * 1000) {
        // No password (e.g. Google-only): require a sign-in within the last 10 minutes.
        throw new AppError('reauth_required', 'Please sign in again to confirm');
      }
      await deps.accounts.deleteAccount(user);
      await deps.audit('account_delete', {
        actorUserId: null,
        targetType: 'user',
        targetId: user.id,
        ...meta(req),
      });
      // Clear the session cookie (the session row is already gone).
      return reply
        .header('set-cookie', [
          `${deps.cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${deps.config.APP_ORIGIN.startsWith('https') ? '; Secure' : ''}`,
        ])
        .status(204)
        .send();
    },
  );
}
