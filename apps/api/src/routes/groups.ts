import type { FastifyInstance } from 'fastify';
import {
  groupCreateSchema,
  groupUpdateSchema,
  inviteCodeSchema,
  inviteCreateSchema,
  memberRoleSchema,
  uuidSchema,
} from '@todo/shared';
import type { AppDeps } from '../app';
import { webHeaders } from '../plugins/auth-guard';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import { loadGroupRoles } from '../services/membership';
import { auditMeta } from './context';

export function groupRoutes(app: FastifyInstance, deps: AppDeps) {
  const pre = { preHandler: deps.requireUser };
  const viewer = deps.viewerOf;
  const id = (params: unknown) => uuidSchema.parse((params as { id: string }).id);
  const userId = (params: unknown) => uuidSchema.parse((params as { userId: string }).userId);
  const code = (params: unknown) => inviteCodeSchema.parse((params as { code: string }).code);

  app.get('/api/v1/groups', pre, async (req) => deps.groups.list(await viewer(req)));

  app.post('/api/v1/groups', pre, async (req, reply) => {
    const group = await deps.groups.create(
      await viewer(req),
      groupCreateSchema.parse(req.body),
      auditMeta(req),
    );
    return reply.status(201).send(group);
  });

  app.get('/api/v1/groups/:id', pre, async (req) =>
    deps.groups.get(await viewer(req), id(req.params)),
  );

  app.patch('/api/v1/groups/:id', pre, async (req) =>
    deps.groups.update(await viewer(req), id(req.params), groupUpdateSchema.parse(req.body)),
  );

  app.delete('/api/v1/groups/:id', pre, async (req, reply) => {
    await deps.groups.remove(await viewer(req), id(req.params), auditMeta(req));
    return reply.status(204).send();
  });

  app.get('/api/v1/groups/:id/members', pre, async (req) =>
    deps.groups.members(await viewer(req), id(req.params)),
  );

  app.patch('/api/v1/groups/:id/members/:userId', pre, async (req) =>
    deps.groups.changeRole(
      await viewer(req),
      id(req.params),
      userId(req.params),
      memberRoleSchema.parse(req.body).role,
      auditMeta(req),
    ),
  );

  app.delete('/api/v1/groups/:id/members/:userId', pre, async (req) =>
    deps.groups.removeMember(await viewer(req), id(req.params), userId(req.params), auditMeta(req)),
  );

  app.post(
    '/api/v1/groups/:id/invites',
    { ...pre, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const invite = await deps.groups.createInvite(
        await viewer(req),
        req.user!,
        id(req.params),
        inviteCreateSchema.parse(req.body),
        auditMeta(req),
      );
      return reply.status(201).send(invite);
    },
  );

  app.get('/api/v1/groups/:id/invites', pre, async (req) =>
    deps.groups.listInvites(await viewer(req), id(req.params)),
  );

  app.delete('/api/v1/invites/:id', pre, async (req, reply) => {
    await deps.groups.revokeInvite(await viewer(req), id(req.params), auditMeta(req));
    return reply.status(204).send();
  });

  // Join page preview. Signed-out visitors can see it; a tight per-IP limit stops code guessing.
  app.get(
    '/api/v1/invites/:code',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const c = code(req.params);
      const session = await deps.auth.api.getSession({ headers: webHeaders(req) }).catch(() => null);
      let v = null;
      if (session) {
        const user = await deps.db.query.users.findFirst({ where: eq(users.id, session.user.id) });
        if (user && !user.suspendedAt)
          v = {
            id: user.id,
            timeZone: user.timeZone,
            groupRoles: await loadGroupRoles(deps.db, user.id),
          };
      }
      reply.header('cache-control', 'no-store');
      return deps.groups.preview(c, v);
    },
  );

  app.post(
    '/api/v1/invites/:code/accept',
    { ...pre, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const result = await deps.groups.accept(
        await viewer(req),
        req.user!,
        code(req.params),
        auditMeta(req),
      );
      return reply.status(result.joined ? 201 : 200).send(result.group);
    },
  );
}
