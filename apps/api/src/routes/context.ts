import type { FastifyRequest } from 'fastify';
import { canonicalTimeZone } from '@todo/shared';
import type { Db } from '../db/client';
import { loadGroupRoles, type Viewer } from '../services/membership';

/** Builds the request's Viewer once (user id, time zone, group roles) and reuses it. */
export function createViewerLoader(db: Db) {
  const cache = new WeakMap<FastifyRequest, Promise<Viewer>>();
  return function viewerOf(req: FastifyRequest): Promise<Viewer> {
    let v = cache.get(req);
    if (!v) {
      const user = req.user!;
      v = loadGroupRoles(db, user.id).then((groupRoles) => ({
        id: user.id,
        timeZone: canonicalTimeZone(user.timeZone),
        groupRoles,
      }));
      cache.set(req, v);
    }
    return v;
  };
}
export type ViewerOf = ReturnType<typeof createViewerLoader>;

export const auditMeta = (req: FastifyRequest) => ({
  ip: req.clientIp,
  userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  requestId: req.id,
});
