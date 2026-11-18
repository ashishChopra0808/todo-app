import type { FastifyInstance } from 'fastify';
import {
  canonicalTimeZone,
  taskCreateSchema,
  taskListQuerySchema,
  taskUpdateSchema,
  uuidSchema,
} from '@todo/shared';
import type { AppDeps } from '../app';

export function taskRoutes(app: FastifyInstance, deps: AppDeps) {
  const pre = { preHandler: deps.requireUser };
  const viewer = (req: { user: { id: string; timeZone: string } | null }) => ({
    id: req.user!.id,
    timeZone: canonicalTimeZone(req.user!.timeZone),
  });
  const ipHash = (req: { clientIp: string }) => deps.crypto.hashIp(req.clientIp);
  const idParam = (params: unknown) => uuidSchema.parse((params as { id: string }).id);

  app.get('/api/v1/tasks', pre, async (req) =>
    deps.tasks.list(viewer(req), taskListQuerySchema.parse(req.query)),
  );
  app.get('/api/v1/tasks/counts', pre, async (req) => deps.tasks.counts(viewer(req)));

  app.post('/api/v1/tasks', pre, async (req, reply) => {
    const { task, created } = await deps.tasks.create(
      viewer(req),
      taskCreateSchema.parse(req.body),
      ipHash(req),
    );
    return reply.status(created ? 201 : 200).send(task);
  });

  app.get('/api/v1/tasks/:id', pre, async (req) =>
    deps.tasks.get(viewer(req), idParam(req.params)),
  );

  app.patch('/api/v1/tasks/:id', pre, async (req) =>
    deps.tasks.update(
      viewer(req),
      idParam(req.params),
      taskUpdateSchema.parse(req.body),
      ipHash(req),
    ),
  );

  app.delete('/api/v1/tasks/:id', pre, async (req, reply) => {
    await deps.tasks.remove(viewer(req), idParam(req.params), ipHash(req));
    return reply.status(204).send();
  });

  app.get('/api/v1/tasks/:id/activity', pre, async (req) =>
    deps.tasks.activity(viewer(req), idParam(req.params)),
  );
}
