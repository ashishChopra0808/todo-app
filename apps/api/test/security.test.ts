import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { client, signUpWithEmail, useApp } from './helpers';

const ctx = useApp();

describe('security', () => {
  it('sets security headers and a request id', async () => {
    const res = await client(ctx).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('public config says whether texts are forwarded to email (never the address)', async () => {
    const res = await client(ctx).get('/api/v1/public-config');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ smsToEmail: false });
    expect(res.body).not.toContain('@');
  });

  it('readiness checks the database and Redis', async () => {
    const res = await client(ctx).get('/health/ready');
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('blocks cross-site state-changing requests (CSRF)', async () => {
    const c = await signUpWithEmail(ctx);
    const evil = client(ctx, { origin: 'https://evil.example' });
    for (const [k, v] of c.jar) evil.jar.set(k, v);
    const res = await evil.post('/api/v1/tasks', { title: 'csrf' });
    expect(res.statusCode).toBe(403);
    const noOrigin = client(ctx, { origin: null });
    for (const [k, v] of c.jar) noOrigin.jar.set(k, v);
    expect((await noOrigin.post('/api/v1/tasks', { title: 'csrf' })).statusCode).toBe(403);
    const signOut = await evil.post('/api/auth/sign-out', {});
    expect(signOut.statusCode).toBe(403);
  });

  it('rejects form-encoded bodies', async () => {
    const c = await signUpWithEmail(ctx);
    const res = await c.post('/api/v1/tasks', undefined, {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(res.statusCode).toBe(415);
  });

  it('session cookie is HttpOnly and SameSite=Lax', async () => {
    const c = client(ctx);
    await signUpWithEmail(ctx, 'asha@example.com', 'Asha', c);
    expect([...c.jar.keys()].some((k) => k.includes('session_token'))).toBe(true);
    const res = await c.post('/api/auth/sign-in/email', {
      email: 'asha@example.com',
      password: 'mango-river-lamp-91',
    });
    const cookie = ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((h) => h.includes('session_token'))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('ignores a spoofed client IP without the proxy secret', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-real-client-ip': '1.2.3.4' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns JSON 404s', async () => {
    const res = await client(ctx).get('/api/v1/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});

describe('config', () => {
  const base = {
    DATABASE_URL: 'postgres://x',
    REDIS_URL: 'redis://x',
    BETTER_AUTH_SECRET: 'x'.repeat(40),
    DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    IP_HASH_SALT: 'y'.repeat(20),
  };
  it('refuses unsafe drivers when deployed, without printing secret values', () => {
    expect(() =>
      loadConfig({ ...base, APP_ENV: 'production', APP_ORIGIN: 'http://todo.example' }),
    ).toThrow(/EMAIL_DRIVER|APP_ORIGIN/);
    try {
      loadConfig({
        ...base,
        APP_ENV: 'production',
        APP_ORIGIN: 'https://todo.example',
        BETTER_AUTH_SECRET: 'short-secret-value',
      });
    } catch (e) {
      expect(String(e)).not.toContain('short-secret-value');
    }
  });
  it('rejects SMS forwarding in production', () => {
    expect(() =>
      loadConfig({
        ...base,
        APP_ENV: 'production',
        APP_ORIGIN: 'https://todo.example',
        EMAIL_DRIVER: 'resend',
        RESEND_API_KEY: 'k',
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'b',
        S3_ENDPOINT: 'https://s3',
        S3_ACCESS_KEY_ID: 'a',
        S3_SECRET_ACCESS_KEY: 's',
        PROXY_SHARED_SECRET: 'p',
        SMS_DRIVER: 'forward-email',
        SMS_FORWARD_TO: 'me@example.com',
      }),
    ).toThrow(/forward-email is not allowed/);
  });
});
