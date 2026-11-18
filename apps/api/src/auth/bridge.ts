import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from './auth';
import { CLIENT_IP_HEADER } from './auth';
import { mapAuthError } from './error-map';

/** Converts a Fastify request into a Fetch Request for Better Auth. */
export function toWebRequest(req: FastifyRequest, ip: string, origin: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (key === CLIENT_IP_HEADER || key === 'x-proxy-secret' || key === 'x-real-client-ip')
      continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set(CLIENT_IP_HEADER, ip);
  headers.set('x-request-id', req.id);
  const url = new URL(req.url, origin);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined;
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody
      ? typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body)
      : undefined,
  });
}

/** Sends a Fetch Response back through Fastify, normalising error bodies to our format. */
export async function sendWebResponse(res: Response, reply: FastifyReply, requestId: string) {
  reply.status(res.status);
  const cookies = res.headers.getSetCookie();
  res.headers.forEach((value, key) => {
    if (key === 'set-cookie' || key === 'content-length') return;
    reply.header(key, value);
  });
  if (cookies.length) reply.header('set-cookie', cookies);
  reply.header('cache-control', 'no-store');

  const text = res.body ? await res.text() : '';
  if (res.status < 400) return reply.send(text || null);

  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error */
  }
  const code = mapAuthError(typeof parsed.code === 'string' ? parsed.code : undefined, res.status);
  const retryAfter = typeof parsed.retryAfter === 'number' ? parsed.retryAfter : undefined;
  if (retryAfter) reply.header('retry-after', String(retryAfter));
  reply.header('content-type', 'application/json; charset=utf-8');
  return reply.send({
    error: {
      code,
      message: typeof parsed.message === 'string' ? parsed.message : code,
      ...(parsed.fields ? { fields: parsed.fields } : {}),
      ...(retryAfter ? { retryAfterSeconds: retryAfter } : {}),
    },
    requestId,
  });
}

export function registerAuthBridge(
  app: FastifyInstance,
  auth: Auth,
  opts: { origin: string; ipOf: (req: FastifyRequest) => string },
) {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    config: { rateLimit: false }, // Better Auth applies its own per-path limits.
    async handler(req, reply) {
      const res = await auth.handler(toWebRequest(req, opts.ipOf(req), opts.origin));
      return sendWebResponse(res, reply, req.id);
    },
  });
}
