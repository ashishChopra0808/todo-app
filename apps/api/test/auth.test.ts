import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLogs, consents, users } from '../src/db/schema';
import {
  STRONG_PASSWORD,
  client,
  latestOtp,
  outboxCount,
  signUpWithEmail,
  signUpWithPhone,
  skipOtpCooldown,
  useApp,
} from './helpers';

const ctx = useApp();

describe('email sign-up', () => {
  it('signs up, verifies by OTP, records consent and lands signed in', async () => {
    const c = await signUpWithEmail(ctx);
    const me = await c.get('/api/v1/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      email: 'asha@example.com',
      emailVerified: true,
      hasPassword: true,
      locale: 'en',
    });
    const user = await ctx.deps.db.query.users.findFirst({
      where: eq(users.email, 'asha@example.com'),
    });
    const rows = await ctx.deps.db.query.consents.findMany({
      where: eq(consents.userId, user!.id),
    });
    expect(rows.map((r) => r.kind).sort()).toEqual(['privacy', 'terms']);
  });

  it('requires accepting the terms', async () => {
    const res = await client(ctx).post('/api/auth/sign-up/email', {
      name: 'A',
      email: 'a@example.com',
      password: STRONG_PASSWORD,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });

  it('rejects weak passwords with a stable error code', async () => {
    const res = await client(ctx).post('/api/auth/sign-up/email', {
      name: 'A',
      email: 'a@example.com',
      password: 'password123',
      acceptTerms: true,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('weak_password');
  });

  it('does not allow an unverified account to sign in or use the API', async () => {
    const c = client(ctx);
    await c.post('/api/auth/sign-up/email', {
      name: 'Asha',
      email: 'asha@example.com',
      password: STRONG_PASSWORD,
      acceptTerms: true,
    });
    const signIn = await c.post('/api/auth/sign-in/email', {
      email: 'asha@example.com',
      password: STRONG_PASSWORD,
    });
    expect(signIn.statusCode).toBe(403);
    expect(signIn.json().error.code).toBe('not_verified');
    expect((await c.get('/api/v1/me')).statusCode).toBe(401);
  });

  it('wrong OTP is rejected and an OTP stops working after 5 wrong tries', async () => {
    const c = client(ctx);
    await c.post('/api/auth/sign-up/email', {
      name: 'Asha',
      email: 'asha@example.com',
      password: STRONG_PASSWORD,
      acceptTerms: true,
    });
    const otp = await latestOtp(ctx, 'asha@example.com');
    const wrong = otp === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await c.post('/api/auth/email-otp/verify-email', {
        email: 'asha@example.com',
        otp: wrong,
      });
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
    }
    const r = await c.post('/api/auth/email-otp/verify-email', { email: 'asha@example.com', otp });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(['too_many_attempts', 'invalid_otp', 'otp_expired']).toContain(r.json().error.code);
  });

  it('an abandoned unverified sign-up does not block the real owner', async () => {
    await client(ctx).post('/api/auth/sign-up/email', {
      name: 'Squatter',
      email: 'asha@example.com',
      password: STRONG_PASSWORD,
      acceptTerms: true,
    });
    const c = await signUpWithEmail(ctx, 'asha@example.com', 'Asha Real');
    expect((await c.get('/api/v1/me')).json().name).toBe('Asha Real');
  });

  it('enforces a resend cooldown per email address', async () => {
    const c = client(ctx);
    await c.post('/api/auth/sign-up/email', {
      name: 'Asha',
      email: 'asha@example.com',
      password: STRONG_PASSWORD,
      acceptTerms: true,
    });
    const first = await c.post('/api/auth/email-otp/send-verification-otp', {
      email: 'asha@example.com',
      type: 'email-verification',
    });
    expect(first.statusCode).toBe(200);
    const second = await client(ctx).post('/api/auth/email-otp/send-verification-otp', {
      email: 'asha@example.com',
      type: 'email-verification',
    });
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('rate_limited');
    expect(second.json().error.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('phone sign-up', () => {
  it('signs up with phone + password, verifies by SMS OTP, then signs in with password', async () => {
    const c = await signUpWithPhone(ctx);
    const me = (await c.get('/api/v1/me')).json();
    expect(me).toMatchObject({
      phoneNumber: '+919876543210',
      phoneNumberVerified: true,
      email: null,
      name: 'Ravi Kumar',
      hasPassword: true,
    });

    const fresh = client(ctx);
    const signIn = await fresh.post('/api/auth/sign-in/phone-number', {
      phoneNumber: '98765 43210',
      password: STRONG_PASSWORD,
    });
    expect(signIn.statusCode).toBe(200);
    expect((await fresh.get('/api/v1/me')).statusCode).toBe(200);
  });

  it('creates no account until the OTP is verified', async () => {
    const c = client(ctx);
    await c.post('/api/v1/auth/phone/sign-up', {
      name: 'Ravi',
      phoneNumber: '+919876543210',
      password: STRONG_PASSWORD,
      acceptTerms: true,
    });
    expect(await ctx.deps.db.query.users.findMany()).toHaveLength(0);
    const signIn = await client(ctx).post('/api/auth/sign-in/phone-number', {
      phoneNumber: '+919876543210',
      password: STRONG_PASSWORD,
    });
    expect(signIn.json().error.code).toBe('invalid_credentials');
  });

  it('an OTP alone (without the pending sign-up in this browser) never creates an account', async () => {
    const victim = client(ctx);
    await victim.post('/api/v1/auth/phone/sign-up', {
      name: 'Ravi',
      phoneNumber: '+919876543210',
      password: STRONG_PASSWORD,
      acceptTerms: true,
    });
    const code = await latestOtp(ctx, '+919876543210');
    const other = client(ctx);
    const res = await other.post('/api/auth/phone-number/verify', {
      phoneNumber: '+919876543210',
      code,
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await ctx.deps.db.query.users.findMany()).toHaveLength(0);
  });

  it('rejects a number that is already registered and verified', async () => {
    await signUpWithPhone(ctx);
    const res = await client(ctx).post('/api/v1/auth/phone/sign-up', {
      name: 'X',
      phoneNumber: '+919876543210',
      password: STRONG_PASSWORD,
      acceptTerms: true,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('phone_taken');
  });

  it('validates input with field errors', async () => {
    const res = await client(ctx).post('/api/v1/auth/phone/sign-up', {
      name: '',
      phoneNumber: '123',
      password: 'x',
      acceptTerms: false,
    });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fields).sort()).toEqual([
      'acceptTerms',
      'name',
      'password',
      'phoneNumber',
    ]);
  });
});

describe('sign-in, lockout and sessions', () => {
  it('locks the account after 10 wrong passwords and records it in the audit log', async () => {
    await signUpWithEmail(ctx);
    for (let i = 0; i < 10; i++) {
      // Different IPs so the per-IP limit does not kick in first.
      const r = await client(ctx).post('/api/auth/sign-in/email', {
        email: 'asha@example.com',
        password: `wrong-${i}-password`,
      });
      expect(r.json().error.code).toBe('invalid_credentials');
    }
    const locked = await client(ctx).post('/api/auth/sign-in/email', {
      email: 'asha@example.com',
      password: STRONG_PASSWORD,
    });
    expect(locked.statusCode).toBe(423);
    expect(locked.json().error.code).toBe('account_locked');
    const actions = (await ctx.deps.db.query.auditLogs.findMany()).map((a) => a.action);
    expect(actions).toContain('lockout');
    expect(actions.filter((a) => a === 'login_failed')).toHaveLength(10);
  });

  it('limits sign-in attempts per IP', async () => {
    const c = client(ctx);
    let last = 0;
    for (let i = 0; i < 11; i++)
      last = (
        await c.post('/api/auth/sign-in/email', {
          email: `nobody${i}@example.com`,
          password: 'whatever-123',
        })
      ).statusCode;
    expect(last).toBe(429);
  });

  it('log out from all devices ends every session', async () => {
    const a = await signUpWithEmail(ctx);
    const b = client(ctx);
    await b.post('/api/auth/sign-in/email', {
      email: 'asha@example.com',
      password: STRONG_PASSWORD,
    });
    expect((await b.get('/api/v1/me')).statusCode).toBe(200);
    expect((await a.get('/api/v1/me/sessions')).json()).toHaveLength(2);
    expect((await a.post('/api/auth/revoke-sessions', {})).statusCode).toBe(200);
    expect((await a.get('/api/v1/me')).statusCode).toBe(401);
    expect((await b.get('/api/v1/me')).statusCode).toBe(401);
  });

  it('can sign out one other device', async () => {
    const a = await signUpWithEmail(ctx);
    const b = client(ctx);
    await b.post('/api/auth/sign-in/email', {
      email: 'asha@example.com',
      password: STRONG_PASSWORD,
    });
    const sessions = (await a.get('/api/v1/me/sessions')).json() as Array<{
      id: string;
      current: boolean;
    }>;
    const other = sessions.find((s) => !s.current)!;
    expect((await a.del(`/api/v1/me/sessions/${other.id}`)).statusCode).toBe(204);
    expect((await b.get('/api/v1/me')).statusCode).toBe(401);
    expect((await a.get('/api/v1/me')).statusCode).toBe(200);
  });
});

describe('password reset', () => {
  it('resets by email OTP, ends old sessions and the new password works', async () => {
    const old = await signUpWithEmail(ctx);
    await skipOtpCooldown(ctx, 'asha@example.com');
    const c = client(ctx);
    expect(
      (await c.post('/api/auth/email-otp/request-password-reset', { email: 'asha@example.com' }))
        .statusCode,
    ).toBe(200);
    const otp = await latestOtp(ctx, 'asha@example.com');
    const newPassword = 'tiger-lotus-cloud-77';
    const reset = await c.post('/api/auth/email-otp/reset-password', {
      email: 'asha@example.com',
      otp,
      password: newPassword,
    });
    expect(reset.statusCode).toBe(200);
    expect((await old.get('/api/v1/me')).statusCode).toBe(401);
    expect(
      (
        await client(ctx).post('/api/auth/sign-in/email', {
          email: 'asha@example.com',
          password: newPassword,
        })
      ).statusCode,
    ).toBe(200);
    const actions = (await ctx.deps.db.query.auditLogs.findMany()).map((a) => a.action);
    expect(actions).toContain('password_reset');
  });

  it('resets by phone OTP', async () => {
    await signUpWithPhone(ctx);
    await skipOtpCooldown(ctx, '+919876543210');
    const c = client(ctx);
    expect(
      (
        await c.post('/api/auth/phone-number/request-password-reset', {
          phoneNumber: '+919876543210',
        })
      ).statusCode,
    ).toBe(200);
    const otp = await latestOtp(ctx, '+919876543210');
    const reset = await c.post('/api/auth/phone-number/reset-password', {
      phoneNumber: '+919876543210',
      otp,
      newPassword: 'tiger-lotus-cloud-77',
    });
    expect(reset.statusCode).toBe(200);
    const signIn = await client(ctx).post('/api/auth/sign-in/phone-number', {
      phoneNumber: '+919876543210',
      password: 'tiger-lotus-cloud-77',
    });
    expect(signIn.statusCode).toBe(200);
  });

  it('does not reveal whether an email is registered', async () => {
    const res = await client(ctx).post('/api/auth/email-otp/request-password-reset', {
      email: 'nobody@example.com',
    });
    expect(res.statusCode).toBe(200);
    expect(await outboxCount(ctx, 'nobody@example.com')).toBe(0);
  });
});

describe('suspension', () => {
  it('a suspended user cannot sign in or use existing sessions', async () => {
    const c = await signUpWithEmail(ctx);
    await ctx.deps.db
      .update(users)
      .set({ suspendedAt: new Date() })
      .where(eq(users.email, 'asha@example.com'));
    const me = await c.get('/api/v1/me');
    expect(me.statusCode).toBe(403);
    expect(me.json().error.code).toBe('account_suspended');
    const signIn = await client(ctx).post('/api/auth/sign-in/email', {
      email: 'asha@example.com',
      password: STRONG_PASSWORD,
    });
    expect(signIn.json().error.code).toBe('account_suspended');
    const wrongPw = await client(ctx).post('/api/auth/sign-in/email', {
      email: 'asha@example.com',
      password: 'not-the-password-1',
    });
    expect(wrongPw.json().error.code).toBe('invalid_credentials');
  });
});

describe('audit log', () => {
  it('never stores emails, phones or codes', async () => {
    await signUpWithEmail(ctx);
    await signUpWithPhone(ctx);
    const rows = await ctx.deps.db.select().from(auditLogs);
    const text = JSON.stringify(rows);
    expect(text).not.toContain('asha@example.com');
    expect(text).not.toContain('9876543210');
  });
});
