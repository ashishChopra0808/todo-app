/**
 * Cloudflare Pages Function: forwards /api/* to the API on Railway, so the browser only ever
 * talks to one origin (first-party HttpOnly cookies, no CORS).
 *
 * Environment variables (Cloudflare Pages → Settings → Variables and secrets):
 *   API_ORIGIN           e.g. https://todo-api-staging.up.railway.app
 *   PROXY_SHARED_SECRET  same value as the API's PROXY_SHARED_SECRET (marked as a secret)
 */
interface Env {
  API_ORIGIN: string;
  PROXY_SHARED_SECRET: string;
}

const HOP_BY_HOP = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host'];

export const onRequest = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, env.API_ORIGIN);

  const headers = new Headers(request.headers);
  for (const h of HOP_BY_HOP) headers.delete(h);
  // Never let a client choose its own IP or impersonate the proxy.
  headers.delete('x-real-client-ip');
  headers.delete('x-proxy-secret');
  headers.set('x-real-client-ip', request.headers.get('cf-connecting-ip') ?? '');
  headers.set('x-proxy-secret', env.PROXY_SHARED_SECRET);
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', 'https');

  const res = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
};
