import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';

const TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  webm: 'audio/webm',
  m4a: 'audio/mp4',
};

/** Dev/test only: serves files from the local storage driver via signed, expiring tokens. */
export function localFileRoutes(app: FastifyInstance, deps: AppDeps) {
  const readLocal = deps.storage.readLocal;
  if (!readLocal) return;
  app.get<{ Params: { token: string } }>('/api/v1/files/local/:token', async (req, reply) => {
    const file = await readLocal(req.params.token);
    if (!file)
      return reply
        .status(404)
        .send({ error: { code: 'not_found', message: 'Not found' }, requestId: req.id });
    const ext = file.key.split('.').pop() ?? '';
    return reply
      .header('content-type', TYPES[ext] ?? 'application/octet-stream')
      .header('cache-control', 'private, max-age=600')
      .send(file.body);
  });
}
