import type { FastifyRequest } from 'fastify';
import { safeEqual } from './crypto';

/**
 * Real client IP. The Cloudflare Pages proxy forwards it in x-real-client-ip and proves
 * it is the proxy with x-proxy-secret. Without a valid secret we fall back to the
 * address Fastify sees (honouring TRUST_PROXY_HOPS for Railway's edge).
 */
export function clientIp(req: FastifyRequest, proxySecret: string | undefined): string {
  const secret = req.headers['x-proxy-secret'];
  const forwarded = req.headers['x-real-client-ip'];
  if (
    proxySecret &&
    typeof secret === 'string' &&
    safeEqual(secret, proxySecret) &&
    typeof forwarded === 'string' &&
    forwarded.length <= 64
  ) {
    return forwarded;
  }
  return req.ip;
}
