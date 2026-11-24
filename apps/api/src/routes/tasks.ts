import type { FastifyInstance } from 'fastify';
import { taskCreateSchema, taskListQuerySchema, taskUpdateSchema, uuidSchema } from '@todo/shared';
import type { AppDeps } from '../app';

export function taskRoutes(app: FastifyInstance, deps: AppDeps) {
  const pre = { preHandler: deps.requireUser };
  const viewer = deps.viewerOf;
  const ipHash = (req: { clientIp: string }) => deps.crypto.hashIp(req.clientIp);
  const idParam = (params: unknown) => uuidSchema.parse((params as { id: string }).id);

  app.get('/api/v1/tasks', pre, async (req) =>
    deps.tasks.list(await viewer(req), taskListQuerySchema.parse(req.query)),
  );
  app.get('/api/v1/tasks/counts', pre, async (req) => deps.tasks.counts(await viewer(req)));

  app.post('/api/v1/tasks', pre, async (req, reply) => {
    const { task, created } = await deps.tasks.create(
      await viewer(req),
      taskCreateSchema.parse(req.body),
      ipHash(req),
    );
    return reply.status(created ? 201 : 200).send(task);
  });

  app.get('/api/v1/tasks/:id', pre, async (req) => {
    const task = await deps.tasks.get(await viewer(req), idParam(req.params));
    await deps.notifications.markTaskRead(req.user!.id, task.id);
    return task;
  });

  app.patch('/api/v1/tasks/:id', pre, async (req) =>
    deps.tasks.update(
      await viewer(req),
      idParam(req.params),
      taskUpdateSchema.parse(req.body),
      ipHash(req),
    ),
  );

  app.delete('/api/v1/tasks/:id', pre, async (req, reply) => {
    await deps.tasks.remove(await viewer(req), idParam(req.params), ipHash(req));
    return reply.status(204).send();
  });

  app.get('/api/v1/tasks/:id/activity', pre, async (req) =>
    deps.tasks.activity(await viewer(req), idParam(req.params)),
  );
}
