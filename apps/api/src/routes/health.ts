import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';

export function healthRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  // Same check through the web origin (Cloudflare forwards /api/*), for uptime monitors.
  app.get('/api/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));
  /** Non-secret settings the sign-in screen needs (e.g. whether Google sign-in is configured). */
  app.get('/api/v1/public-config', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return {
      googleEnabled: !!(deps.config.GOOGLE_CLIENT_ID && deps.config.GOOGLE_CLIENT_SECRET),
      termsVersion: deps.config.TERMS_VERSION,
      privacyVersion: deps.config.PRIVACY_VERSION,
    };
  });
  app.get('/health/ready', { config: { rateLimit: false } }, async (_req, reply) => {
    const checks: Record<string, 'ok' | 'fail'> = {};
    try {
      await deps.db.execute(sql`select 1`);
      checks.database = 'ok';
    } catch {
      checks.database = 'fail';
    }
    try {
      checks.redis = (await deps.redis.ping()) === 'PONG' ? 'ok' : 'fail';
    } catch {
      checks.redis = 'fail';
    }
    const ok = Object.values(checks).every((v) => v === 'ok');
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'degraded', checks });
  });
}
