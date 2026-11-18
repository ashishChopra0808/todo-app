import 'fastify';
import type { users } from './db/schema';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth guard on protected routes. */
    user: typeof users.$inferSelect | null;
    authSession: { id: string; createdAt: Date } | null;
    clientIp: string;
  }
}
