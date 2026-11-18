import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../auth/auth';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { AppError } from '../lib/errors';

export function webHeaders(req: FastifyRequest): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  return h;
}

/**
 * Protected-route guard: a valid session, a verified account (email or phone), and not suspended.
 * Runs on every /api/v1 request that needs a user.
 */
export function createAuthGuard(auth: Auth, db: Db) {
  return async function requireUser(req: FastifyRequest, _reply: FastifyReply) {
    const result = await auth.api.getSession({ headers: webHeaders(req) });
    if (!result) throw new AppError('unauthenticated', 'Please sign in');
    const user = await db.query.users.findFirst({ where: eq(users.id, result.user.id) });
    if (!user) throw new AppError('unauthenticated', 'Please sign in');
    if (user.suspendedAt) throw new AppError('account_suspended', 'This account is suspended');
    if (!user.emailVerified && !user.phoneNumberVerified)
      throw new AppError('not_verified', 'Please verify your account');
    req.user = user;
    req.authSession = { id: result.session.id, createdAt: new Date(result.session.createdAt) };
  };
}
export type RequireUser = ReturnType<typeof createAuthGuard>;
