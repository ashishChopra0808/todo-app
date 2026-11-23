import type { FastifyInstance } from 'fastify';
import {
  adminReportListQuerySchema,
  commentCreateSchema,
  commentListQuerySchema,
  commentUpdateSchema,
  reportCreateSchema,
  reportResolveSchema,
  suspendSchema,
  uuidSchema,
} from '@todo/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app';
import { notFound } from '../lib/errors';
import { auditMeta } from './context';

export function commentRoutes(app: FastifyInstance, deps: AppDeps) {
  const pre = { preHandler: deps.requireUser };
  const viewer = deps.viewerOf;
  const id = (params: unknown) => uuidSchema.parse((params as { id: string }).id);
  const ipHash = (req: { clientIp: string }) => deps.crypto.hashIp(req.clientIp);

  app.get('/api/v1/tasks/:id/comments', pre, async (req) =>
    deps.comments.list(await viewer(req), id(req.params), commentListQuerySchema.parse(req.query)),
  );

  app.post('/api/v1/tasks/:id/comments', pre, async (req, reply) => {
    const { comment, created } = await deps.comments.create(
      await viewer(req),
      id(req.params),
      commentCreateSchema.parse(req.body),
      ipHash(req),
    );
    return reply.status(created ? 201 : 200).send(comment);
  });

  app.patch('/api/v1/comments/:id', pre, async (req) =>
    deps.comments.update(
      await viewer(req),
      id(req.params),
      commentUpdateSchema.parse(req.body).body,
    ),
  );

  app.delete('/api/v1/comments/:id', pre, async (req, reply) => {
    await deps.comments.remove(await viewer(req), id(req.params));
    return reply.status(204).send();
  });

  app.post(
    '/api/v1/reports',
    { ...pre, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const result = await deps.reports.create(
        await viewer(req),
        reportCreateSchema.parse(req.body),
        auditMeta(req),
      );
      return reply.status(result.created ? 201 : 200).send({ id: result.id });
    },
  );
}

/** Owner-only routes. Everyone else gets a plain 404, as if they didn't exist. */
export function adminRoutes(app: FastifyInstance, deps: AppDeps) {
  const requireOwner = async (req: FastifyRequest, reply: FastifyReply) => {
    await deps.requireUser(req, reply);
    if (!deps.reports.isOwner(req.user)) throw notFound();
  };
  const pre = { preHandler: requireOwner };
  const id = (params: unknown) => uuidSchema.parse((params as { id: string }).id);

  app.get('/api/v1/admin/me', pre, async () => ({ owner: true }));

  app.get('/api/v1/admin/reports', pre, async (req) =>
    deps.reports.list(adminReportListQuerySchema.parse(req.query)),
  );

  app.get('/api/v1/admin/reports/:id', pre, async (req) => deps.reports.detail(id(req.params)));

  app.post('/api/v1/admin/reports/:id/resolve', pre, async (req) =>
    deps.reports.resolve(
      req.user!,
      id(req.params),
      reportResolveSchema.parse(req.body),
      auditMeta(req),
    ),
  );

  app.post('/api/v1/admin/users/:id/suspend', pre, async (req, reply) => {
    await deps.reports.suspend(
      req.user!,
      id(req.params),
      suspendSchema.parse(req.body).reason,
      auditMeta(req),
    );
    return reply.status(204).send();
  });

  app.post('/api/v1/admin/users/:id/unsuspend', pre, async (req, reply) => {
    await deps.reports.unsuspend(req.user!, id(req.params), auditMeta(req));
    return reply.status(204).send();
  });
}
