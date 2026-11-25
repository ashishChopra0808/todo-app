import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp, type AppDeps } from '../src/app';
import type { Config } from '../src/config';
import { ORIGIN, testConfig } from './env';

export interface TestCtx {
  app: FastifyInstance;
  deps: AppDeps;
  config: Config;
}

/** Boots the real app against the test database. Truncates data and flushes Redis before each test. */
export function useApp(overrides: Record<string, string> = {}): TestCtx {
  const ctx = {} as TestCtx;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ctx.config = testConfig(overrides);
    const built = await buildApp(ctx.config);
    ctx.app = built.app;
    ctx.deps = built.deps;
    close = built.close;
  });
  beforeEach(async () => {
    await ctx.deps.db.execute(
      sql`TRUNCATE users, sessions, accounts, verifications, consents, deleted_accounts, audit_logs, files, tasks, task_activity, groups, group_members, group_invites, comments, reports, notifications, notification_preferences, push_subscriptions CASCADE`,
    );
    await ctx.deps.redis.flushdb();
  });
  afterAll(async () => close?.());
  return ctx;
}

let ipCounter = 1;
/** A browser-like client with its own cookie jar and IP address. */
export function client(ctx: TestCtx, opts: { ip?: string; origin?: string | null } = {}) {
  const jar = new Map<string, string>();
  const ip = opts.ip ?? `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;

  function store(res: LightMyRequestResponse) {
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const c of list) {
      const [pair = '', ...attrs] = c.split(';');
      const [name = '', value = ''] = pair.split('=');
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim())) || value === '';
      if (expired) jar.delete(name.trim());
      else jar.set(name.trim(), value);
    }
  }

  async function request(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ) {
    const headers: Record<string, string> = {
      'x-proxy-secret': 'proxy-secret',
      'x-real-client-ip': ip,
      'user-agent': 'vitest',
      ...extraHeaders,
    };
    if (origin) headers.origin = origin;
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload: string | Buffer | undefined;
    if (Buffer.isBuffer(body)) payload = body;
    else if (body !== undefined) {
      headers['content-type'] ??= 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await ctx.app.inject({ method, url, headers, payload });
    store(res);
    return res;
  }

  return {
    ip,
    jar,
    get: (url: string, h?: Record<string, string>) => request('GET', url, undefined, h),
    post: (url: string, body?: unknown, h?: Record<string, string>) =>
      request('POST', url, body ?? {}, h),
    patch: (url: string, body?: unknown, h?: Record<string, string>) =>
      request('PATCH', url, body ?? {}, h),
    put: (url: string, body?: unknown, h?: Record<string, string>) => request('PUT', url, body, h),
    del: (url: string, body?: unknown, h?: Record<string, string>) =>
      request('DELETE', url, body, h),
  };
}
export type Client = ReturnType<typeof client>;

/** Reads the newest OTP sent to an email or phone from the file outbox. */
export async function latestOtp(ctx: TestCtx, to: string): Promise<string> {
  const dir = ctx.config.OUTBOX_DIR;
  const names = (await readdir(dir)).sort().reverse();
  for (const name of names) {
    const msg = JSON.parse(await readFile(join(dir, name), 'utf8')) as {
      to: string;
      text: string;
      code?: string;
    };
    if (msg.to === to) {
      const code = msg.code ?? msg.text.match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
  }
  throw new Error(`no OTP found for ${to}`);
}

/** Every message in the file outbox (emails and texts), oldest first. */
export async function outboxMessages(
  ctx: TestCtx,
): Promise<{ to: string; subject?: string; text: string; purpose?: string }[]> {
  const names = (await readdir(ctx.config.OUTBOX_DIR)).sort();
  return Promise.all(
    names.map(async (n) => JSON.parse(await readFile(join(ctx.config.OUTBOX_DIR, n), 'utf8'))),
  );
}

export async function outboxCount(ctx: TestCtx, to: string): Promise<number> {
  const names = await readdir(ctx.config.OUTBOX_DIR);
  let n = 0;
  for (const name of names) {
    const msg = JSON.parse(await readFile(join(ctx.config.OUTBOX_DIR, name), 'utf8')) as {
      to: string;
    };
    if (msg.to === to) n++;
  }
  return n;
}

export const STRONG_PASSWORD = 'mango-river-lamp-91';

/** Full email sign-up + OTP verification. Returns a signed-in client. */
export async function signUpWithEmail(
  ctx: TestCtx,
  email = 'asha@example.com',
  name = 'Asha Verma',
  c = client(ctx),
) {
  const res = await c.post('/api/auth/sign-up/email', {
    name,
    email,
    password: STRONG_PASSWORD,
    acceptTerms: true,
    locale: 'en',
    timeZone: 'Asia/Kolkata',
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  const otp = await latestOtp(ctx, email);
  const v = await c.post('/api/auth/email-otp/verify-email', { email, otp });
  if (v.statusCode !== 200) throw new Error(`verify failed: ${v.statusCode} ${v.body}`);
  return c;
}

export async function signUpWithPhone(
  ctx: TestCtx,
  phone = '+919876543210',
  name = 'Ravi Kumar',
  c = client(ctx),
) {
  const res = await c.post('/api/v1/auth/phone/sign-up', {
    name,
    phoneNumber: phone,
    password: STRONG_PASSWORD,
    acceptTerms: true,
  });
  if (res.statusCode !== 201)
    throw new Error(`phone sign-up failed: ${res.statusCode} ${res.body}`);
  const code = await latestOtp(ctx, phone);
  const v = await c.post('/api/auth/phone-number/verify', { phoneNumber: phone, code });
  if (v.statusCode !== 200) throw new Error(`phone verify failed: ${v.statusCode} ${v.body}`);
  return c;
}

/** Skips the 60 s resend cooldown (tests only). */
export async function skipOtpCooldown(ctx: TestCtx, identifier: string) {
  await ctx.deps.redis.del(`otp:cooldown:${identifier.toLowerCase()}`);
}

/** Creates a group as `c` and returns it. */
export async function createGroup(c: Client, name = 'Sharma family', icon: string | null = '🏠') {
  const res = await c.post('/api/v1/groups', { name, icon });
  if (res.statusCode !== 201) throw new Error(`create group failed: ${res.statusCode} ${res.body}`);
  return res.json() as { id: string; name: string; role: string };
}

/** Admin `admin` invites by link, `joiner` accepts. */
export async function joinByLink(admin: Client, joiner: Client, groupId: string) {
  const inv = await admin.post(`/api/v1/groups/${groupId}/invites`, { channel: 'link' });
  if (inv.statusCode !== 201) throw new Error(`invite failed: ${inv.statusCode} ${inv.body}`);
  const res = await joiner.post(`/api/v1/invites/${inv.json().code}/accept`);
  if (res.statusCode !== 201) throw new Error(`join failed: ${res.statusCode} ${res.body}`);
  return inv.json() as { id: string; code: string };
}

export async function meId(c: Client): Promise<string> {
  return (await c.get('/api/v1/me')).json().id;
}

/** Reads the newest outbox message (email or SMS) to `to`. */
export async function latestMessage(ctx: TestCtx, to: string) {
  const dir = ctx.config.OUTBOX_DIR;
  const names = (await readdir(dir)).sort().reverse();
  for (const name of names) {
    const msg = JSON.parse(await readFile(join(dir, name), 'utf8')) as Record<string, string>;
    if (msg.to === to) return msg;
  }
  throw new Error(`no message for ${to}`);
}
