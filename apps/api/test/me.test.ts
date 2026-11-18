import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { tasks, users } from '../src/db/schema';
import { runMaintenance } from '../src/jobs/maintenance';
import {
  STRONG_PASSWORD,
  client,
  latestOtp,
  signUpWithEmail,
  signUpWithPhone,
  skipOtpCooldown,
  useApp,
} from './helpers';

const ctx = useApp();

function multipart(name: string, filename: string, type: string, data: Buffer) {
  const boundary = '----todo' + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, data, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('profile', () => {
  it('updates name, language, theme and time zone with validation', async () => {
    const c = await signUpWithEmail(ctx);
    const res = await c.patch('/api/v1/me', {
      name: ' Asha  V ',
      locale: 'hi',
      theme: 'dark',
      timeZone: 'Europe/London',
    });
    expect(res.json()).toMatchObject({
      name: 'Asha V',
      locale: 'hi',
      theme: 'dark',
      timeZone: 'Europe/London',
    });
    expect((await c.patch('/api/v1/me', { timeZone: 'Mars/Olympus' })).statusCode).toBe(400);
    expect((await c.patch('/api/v1/me', { email: 'evil@example.com' })).statusCode).toBe(400);
  });

  it('uploads an avatar (re-encoded to WebP) and serves it by signed URL', async () => {
    const c = await signUpWithEmail(ctx);
    const png = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#2F6B5F' },
    })
      .png()
      .toBuffer();
    const { body, contentType } = multipart('file', 'me.png', 'image/png', png);
    const res = await c.put('/api/v1/me/avatar', body, { 'content-type': contentType });
    expect(res.statusCode, res.body).toBe(200);
    const url = res.json().avatarUrl as string;
    expect(url).toMatch(/^\/api\/v1\/files\/local\//);
    const img = await c.get(url);
    expect(img.headers['content-type']).toBe('image/webp');
    expect((await sharp(img.rawPayload).metadata()).width).toBe(256);
    expect((await c.get(url.slice(0, -3) + 'abc')).statusCode).toBe(404);
  });

  it('rejects files that are not images', async () => {
    const c = await signUpWithEmail(ctx);
    const { body, contentType } = multipart(
      'file',
      'evil.png',
      'image/png',
      Buffer.from('<script>alert(1)</script>'),
    );
    const res = await c.put('/api/v1/me/avatar', body, { 'content-type': contentType });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('unsupported_file');
  });

  it('adds a verified email to a phone account via OTP', async () => {
    const c = await signUpWithPhone(ctx);
    expect(
      (await c.post('/api/auth/email-otp/request-email-change', { newEmail: 'ravi@example.com' }))
        .statusCode,
    ).toBe(200);
    const otp = await latestOtp(ctx, 'ravi@example.com');
    const res = await c.post('/api/auth/email-otp/change-email', {
      newEmail: 'ravi@example.com',
      otp,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await c.get('/api/v1/me')).json()).toMatchObject({
      email: 'ravi@example.com',
      emailVerified: true,
    });
  });

  it('adds a verified phone to an email account via OTP', async () => {
    const c = await signUpWithEmail(ctx);
    await c.post('/api/auth/phone-number/send-otp', { phoneNumber: '+919812345678' });
    const code = await latestOtp(ctx, '+919812345678');
    const res = await c.post('/api/auth/phone-number/verify', {
      phoneNumber: '+919812345678',
      code,
      updatePhoneNumber: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await c.get('/api/v1/me')).json()).toMatchObject({
      phoneNumber: '+919812345678',
      phoneNumberVerified: true,
    });
  });
});

describe('export and delete', () => {
  it('exports my data as JSON', async () => {
    const c = await signUpWithEmail(ctx);
    await c.post('/api/v1/tasks', { title: 'Exported task' });
    const res = await c.get('/api/v1/me/export');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="todo-export-/);
    const data = res.json();
    expect(data.profile.email).toBe('asha@example.com');
    expect(data.tasks.map((t: { title: string }) => t.title)).toEqual(['Exported task']);
    expect(data.consents).toHaveLength(2);
    expect(JSON.stringify(data)).not.toMatch(/argon2|password"/);
  });

  it('deletes the account: needs the password, keeps an encrypted record and hides content', async () => {
    const c = await signUpWithEmail(ctx);
    const t = (await c.post('/api/v1/tasks', { title: 'Mine' })).json();
    expect(
      (await c.del('/api/v1/me', { confirm: 'DELETE', password: 'wrong-password-1' })).statusCode,
    ).toBe(401);
    expect((await c.del('/api/v1/me', { password: STRONG_PASSWORD })).statusCode).toBe(400);
    expect(
      (await c.del('/api/v1/me', { confirm: 'DELETE', password: STRONG_PASSWORD })).statusCode,
    ).toBe(204);

    expect((await c.get('/api/v1/me')).statusCode).toBe(401);
    expect(
      await ctx.deps.db.query.users.findFirst({ where: eq(users.email, 'asha@example.com') }),
    ).toBeUndefined();
    const record = (await ctx.deps.db.query.deletedAccounts.findMany())[0]!;
    expect(record.encryptedData).not.toContain('asha');
    expect(JSON.parse(ctx.deps.crypto.decrypt(record.encryptedData)).email).toBe(
      'asha@example.com',
    );
    const row = await ctx.deps.db.query.tasks.findFirst({ where: eq(tasks.id, t.id) });
    expect(row?.deletedAt).toBeTruthy();
    // The address can be used again for a new account.
    await skipOtpCooldown(ctx, 'asha@example.com');
    await signUpWithEmail(ctx, 'asha@example.com');
  });
});

describe('maintenance job', () => {
  it('purges expired content and records, and deletes stale unverified sign-ups', async () => {
    const c = await signUpWithEmail(ctx);
    const t = (await c.post('/api/v1/tasks', { title: 'Old' })).json();
    await c.del(`/api/v1/tasks/${t.id}`);
    await client(ctx).post('/api/auth/sign-up/email', {
      name: 'Ghost',
      email: 'ghost@example.com',
      password: STRONG_PASSWORD,
      acceptTerms: true,
    });
    await ctx.deps.db
      .update(users)
      .set({ createdAt: new Date(Date.now() - 25 * 3600 * 1000) })
      .where(eq(users.email, 'ghost@example.com'));

    const notYet = await runMaintenance(ctx.deps.db, ctx.deps.storage);
    expect(notYet.purgedTasks).toBe(0);
    expect(notYet.deletedUnverifiedUsers).toBe(1);

    const later = new Date(Date.now() + 181 * 86400000);
    const result = await runMaintenance(ctx.deps.db, ctx.deps.storage, later);
    expect(result.purgedTasks).toBe(1);
    expect(await ctx.deps.db.query.tasks.findFirst({ where: eq(tasks.id, t.id) })).toBeUndefined();
  });
});
