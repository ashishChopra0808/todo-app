import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP, phoneNumber } from 'better-auth/plugins';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { checkPassword } from '@todo/shared/password';
import {
  LOGIN_LOCKOUT,
  OTP,
  canonicalTimeZone,
  isPlaceholderEmail,
  isValidTimeZone,
  normalizePhone,
  placeholderEmailFor,
} from '@todo/shared';
import { isLocale, matchLocale, parseAcceptLanguage, translate, type Locale } from '@todo/i18n';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { accounts, consents, schema, users } from '../db/schema';
import type { CryptoKit } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { newId } from '../lib/ids';
import type { RedisClient } from '../lib/redis';
import type { Audit } from '../services/audit';
import type { EmailSender } from '../services/email';
import type { OtpLimiter } from '../services/otp-limiter';
import type { SmsSender } from '../services/sms';
import { hashPassword, verifyPassword } from './password-hash';

export interface AuthDeps {
  config: Config;
  db: Db;
  redis: RedisClient;
  email: EmailSender;
  sms: SmsSender;
  otpLimiter: OtpLimiter;
  audit: Audit;
  crypto: CryptoKit;
  log: FastifyBaseLogger;
}

/** Header the Fastify bridge sets to the real client IP (never trusted from the client). */
export const CLIENT_IP_HEADER = 'x-client-ip';

/**
 * Phone sign-up is two steps. Step 1 (POST /api/v1/auth/phone/sign-up) stores the pending
 * sign-up in Redis under phone + a random nonce, and gives the browser the nonce in an
 * HttpOnly cookie. Step 2 (POST /api/auth/phone-number/verify) creates the account only if
 * the OTP is right AND the same browser presents the nonce. No account exists before
 * verification, and nobody can swap in their own password for someone else's number.
 */
export const PHONE_SIGNUP_COOKIE = 'todo_phone_signup';
export const PHONE_SIGNUP_TTL_SECONDS = 15 * 60;
export const pendingPhoneKey = (phone: string, nonce: string) => `phone-signup:${phone}:${nonce}`;
export interface PendingPhoneSignUp {
  name: string;
  passwordHash: string;
  locale?: string;
  timeZone?: string;
  ip: string | null;
}

function readCookie(headers: Headers | undefined | null, name: string): string | null {
  const raw = headers?.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Paths that send an OTP; limited per email/phone (60 s cooldown, 5 per hour). */
const OTP_SEND_PATHS: Record<string, (body: Record<string, unknown>) => unknown> = {
  '/email-otp/send-verification-otp': (b) => b.email,
  '/email-otp/request-password-reset': (b) => b.email,
  '/forget-password/email-otp': (b) => b.email,
  '/email-otp/request-email-change': (b) => b.newEmail,
  '/phone-number/send-otp': (b) => b.phoneNumber,
  '/phone-number/request-password-reset': (b) => b.phoneNumber,
};

const PASSWORD_FIELDS: Record<string, string> = {
  '/sign-up/email': 'password',
  '/email-otp/reset-password': 'password',
  '/phone-number/reset-password': 'newPassword',
  '/change-password': 'newPassword',
};

const SIGN_IN_PATHS = new Set(['/sign-in/email', '/sign-in/phone-number']);

function apiError(
  status: 'BAD_REQUEST' | 'FORBIDDEN' | 'TOO_MANY_REQUESTS' | 'LOCKED',
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return new APIError(status, { code, message, ...extra });
}

export function createAuth(deps: AuthDeps) {
  const { config, db, redis, email, sms, otpLimiter, audit, crypto, log } = deps;

  const reqMeta = (
    ctx: { headers?: Headers | null; request?: Request | null } | null | undefined,
  ) => {
    const headers = ctx?.headers ?? ctx?.request?.headers;
    return {
      ip: headers?.get(CLIENT_IP_HEADER) ?? null,
      userAgent: headers?.get('user-agent') ?? null,
      requestId: headers?.get('x-request-id') ?? null,
      acceptLanguage: headers?.get('accept-language') ?? undefined,
    };
  };

  /** Tell the owner their account was locked by wrong passwords, and how to get back in. */
  async function notifyLockout(
    user: { email: string; emailVerified: boolean; locale: string | null },
    acceptLanguage?: string,
  ) {
    if (!user.emailVerified || isPlaceholderEmail(user.email)) return;
    const locale =
      user.locale && isLocale(user.locale)
        ? user.locale
        : await localeForEmail(user.email, acceptLanguage);
    try {
      await email.send({
        to: user.email,
        purpose: 'lockout',
        subject: translate(locale, 'email.lockout.subject'),
        text: translate(locale, 'email.lockout.text', {
          minutes: LOGIN_LOCKOUT.lockMinutes,
          url: `${config.APP_ORIGIN}/forgot`,
        }),
      });
    } catch (err) {
      log.warn({ err }, 'lockout email failed');
    }
  }

  // Failed sign-ins, counted in Redis: per account + network, and per account overall.
  const failKey = (userId: string, ip: string | null) =>
    `signin:fail:${userId}:${crypto.hashIp(ip) ?? 'unknown'}`;
  const ipLockKey = (userId: string, ip: string | null) =>
    `signin:lock:${userId}:${crypto.hashIp(ip) ?? 'unknown'}`;
  const accountFailKey = (userId: string) => `signin:fail:${userId}:all`;

  async function localeForEmail(addr: string, acceptLanguage?: string): Promise<Locale> {
    const row = await db.query.users.findFirst({
      where: eq(users.email, addr.toLowerCase()),
      columns: { locale: true },
    });
    if (row && isLocale(row.locale)) return row.locale;
    return matchLocale(parseAcceptLanguage(acceptLanguage));
  }
  async function localeForPhone(phone: string, acceptLanguage?: string): Promise<Locale> {
    const row = await db.query.users.findFirst({
      where: eq(users.phoneNumber, phone),
      columns: { locale: true },
    });
    if (row && isLocale(row.locale)) return row.locale;
    return matchLocale(parseAcceptLanguage(acceptLanguage));
  }

  async function findUserForSignIn(body: Record<string, unknown>) {
    if (typeof body.email === 'string') {
      return db.query.users.findFirst({ where: eq(users.email, body.email.trim().toLowerCase()) });
    }
    if (typeof body.phoneNumber === 'string') {
      const phone = normalizePhone(body.phoneNumber);
      if (!phone) return undefined;
      body.phoneNumber = phone;
      return db.query.users.findFirst({ where: eq(users.phoneNumber, phone) });
    }
    return undefined;
  }

  async function loadPendingPhoneSignUp(
    phone: string,
    ctx: { headers?: Headers | null; request?: Request | null } | null | undefined,
  ) {
    const nonce = readCookie(ctx?.headers ?? ctx?.request?.headers, PHONE_SIGNUP_COOKIE);
    if (!nonce) return null;
    const raw = await redis.get(pendingPhoneKey(phone, nonce));
    return raw ? (JSON.parse(raw) as PendingPhoneSignUp) : null;
  }

  async function passwordMatches(userId: string, password: unknown): Promise<boolean> {
    if (typeof password !== 'string') return false;
    const acct = await db.query.accounts.findFirst({
      where: and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')),
      columns: { password: true },
    });
    return !!acct?.password && (await verifyPassword({ hash: acct.password, password }));
  }

  const auth = betterAuth({
    appName: 'ToDo',
    baseURL: config.APP_ORIGIN,
    basePath: '/api/auth',
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_ORIGIN],
    database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: true }),
    telemetry: { enabled: false },
    logger: {
      level: config.APP_ENV === 'test' ? 'error' : 'warn',
      log: (level, message) => {
        const fn =
          level === 'error'
            ? log.error.bind(log)
            : level === 'warn'
              ? log.warn.bind(log)
              : log.debug.bind(log);
        fn({ component: 'better-auth' }, message);
      },
    },
    advanced: {
      cookiePrefix: 'todo',
      useSecureCookies: config.APP_ORIGIN.startsWith('https://'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      database: { generateId: () => newId() },
    },
    // Disabled: link-based flows we replaced with OTPs, and generic endpoints we
    // replaced with our own validated routes (/api/v1/me, /api/v1/me/sessions).
    disabledPaths: [
      '/sign-in/email-otp',
      '/request-password-reset',
      '/reset-password',
      '/send-verification-email',
      '/verify-email',
      '/update-user',
      '/delete-user',
      '/change-email',
      '/list-sessions',
      '/list-accounts',
      '/link-social',
      '/unlink-account',
      '/set-password',
    ],
    user: {
      additionalFields: {
        locale: { type: 'string', required: false, defaultValue: 'en', input: true },
        timeZone: { type: 'string', required: false, defaultValue: 'Asia/Kolkata', input: true },
        emailIsPlaceholder: {
          type: 'boolean',
          required: false,
          defaultValue: false,
          input: false,
          returned: false,
        },
        signupIp: { type: 'string', required: false, input: false, returned: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10,
    },
    account: {
      accountLinking: { enabled: true, trustedProviders: ['google'] },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    emailVerification: { autoSignInAfterVerification: true, sendOnSignIn: false },
    socialProviders:
      config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: config.GOOGLE_CLIENT_ID,
              clientSecret: config.GOOGLE_CLIENT_SECRET,
              prompt: 'select_account',
            },
          }
        : {},
    rateLimit: {
      enabled: config.RATE_LIMITS_ENABLED,
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 15 * 60, max: 10 },
        '/sign-in/phone-number': { window: 15 * 60, max: 10 },
        '/sign-up/email': { window: 60 * 60, max: 5 },
        '/email-otp/verify-email': { window: 15 * 60, max: 15 },
        '/phone-number/verify': { window: 15 * 60, max: 15 },
        '/email-otp/reset-password': { window: 15 * 60, max: 10 },
        '/phone-number/reset-password': { window: 15 * 60, max: 10 },
        '/get-session': false,
      },
      customStorage: {
        // Fixed window in Redis, shared by all API instances. INCR + EXPIRE NX in one round trip.
        async consume(key, rule) {
          const k = `ba:rl:${key}`;
          const res = await redis.multi().incr(k).expire(k, rule.window, 'NX').ttl(k).exec();
          const count = Number(res?.[0]?.[1] ?? 0);
          const ttl = Number(res?.[2]?.[1] ?? rule.window);
          if (count > rule.max) return { allowed: false, retryAfter: ttl > 0 ? ttl : rule.window };
          return { allowed: true, retryAfter: null };
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: OTP.length,
        expiresIn: OTP.expiresInSeconds,
        allowedAttempts: OTP.maxAttempts,
        storeOTP: 'hashed',
        sendVerificationOnSignUp: true,
        overrideDefaultEmailVerification: true,
        disableSignUp: true,
        changeEmail: { enabled: true, verifyCurrentEmail: false },
        rateLimit: { window: 60, max: 10 },
        async sendVerificationOTP({ email: to, otp, type }, ctx) {
          if (isPlaceholderEmail(to)) return;
          const locale = await localeForEmail(to, reqMeta(ctx).acceptLanguage);
          const purpose =
            type === 'forget-password' ? 'reset' : type === 'change-email' ? 'change' : 'verify';
          await email.send({
            to,
            purpose: `otp-${purpose}`,
            subject: translate(locale, `email.otp.subject`, { code: otp }),
            text: translate(locale, `email.otp.${purpose}`, {
              code: otp,
              minutes: OTP.expiresInSeconds / 60,
            }),
          });
        },
      }),
      phoneNumber({
        otpLength: OTP.length,
        expiresIn: OTP.expiresInSeconds,
        allowedAttempts: OTP.maxAttempts,
        // Verification is enforced by our own hooks so that an unverified account only learns
        // it is unverified after giving the right password (see hooks.before).
        requireVerification: false,
        phoneNumberValidator: (value) => normalizePhone(value) === value,
        // Accounts are created at verification time — but only for a pending sign-up (see above).
        signUpOnVerification: { getTempEmail: placeholderEmailFor, getTempName: (p) => p },
        async sendOTP({ phoneNumber: to, code }, ctx) {
          const locale = await localeForPhone(to, reqMeta(ctx).acceptLanguage);
          await sms.sendOtp({
            to,
            code,
            purpose: 'verify',
            text: translate(locale, 'sms.otp', { code, minutes: OTP.expiresInSeconds / 60 }),
          });
        },
        async sendPasswordResetOTP({ phoneNumber: to, code }, ctx) {
          const locale = await localeForPhone(to, reqMeta(ctx).acceptLanguage);
          await sms.sendOtp({
            to,
            code,
            purpose: 'reset',
            text: translate(locale, 'sms.reset', { code, minutes: OTP.expiresInSeconds / 60 }),
          });
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          async before(user, ctx) {
            const meta = reqMeta(ctx);
            let data = user as Record<string, unknown>;
            if (
              typeof data.phoneNumber === 'string' &&
              data.phoneNumberVerified === true &&
              isPlaceholderEmail(user.email)
            ) {
              const pending = await loadPendingPhoneSignUp(data.phoneNumber, ctx);
              if (!pending) return false; // OTP alone never creates an account.
              data = {
                ...data,
                name: pending.name,
                locale: pending.locale,
                timeZone: pending.timeZone,
                signupIp: pending.ip,
              };
              user = { ...user, name: pending.name };
            }
            const locale = isLocale(data.locale)
              ? data.locale
              : matchLocale(parseAcceptLanguage(meta.acceptLanguage));
            const timeZone =
              typeof data.timeZone === 'string' && isValidTimeZone(data.timeZone)
                ? canonicalTimeZone(data.timeZone)
                : 'Asia/Kolkata';
            return {
              data: {
                ...data,
                ...user,
                email: user.email.toLowerCase(),
                locale,
                timeZone,
                emailIsPlaceholder: isPlaceholderEmail(user.email),
                signupIp: meta.ip ?? (typeof data.signupIp === 'string' ? data.signupIp : null),
              },
            };
          },
          async after(user, ctx) {
            const meta = reqMeta(ctx);
            const ipHash = crypto.hashIp(meta.ip);
            const phone = (user as Record<string, unknown>).phoneNumber;
            if (typeof phone === 'string' && isPlaceholderEmail(user.email)) {
              const pending = await loadPendingPhoneSignUp(phone, ctx);
              if (pending) {
                await db.insert(accounts).values({
                  id: newId(),
                  userId: user.id,
                  providerId: 'credential',
                  accountId: user.id,
                  password: pending.passwordHash,
                });
                const nonce = readCookie(
                  ctx?.headers ?? ctx?.request?.headers,
                  PHONE_SIGNUP_COOKIE,
                );
                if (nonce) await redis.del(pendingPhoneKey(phone, nonce));
              }
            }
            await db.insert(consents).values([
              {
                id: newId(),
                userId: user.id,
                kind: 'terms',
                version: config.TERMS_VERSION,
                ipHash,
              },
              {
                id: newId(),
                userId: user.id,
                kind: 'privacy',
                version: config.PRIVACY_VERSION,
                ipHash,
              },
            ]);
            await audit('signup', {
              actorUserId: user.id,
              targetType: 'user',
              targetId: user.id,
              ...meta,
            });
          },
        },
      },
      account: {
        create: {
          // Pre-hijack protection: if someone registered this email with a password but never
          // verified it, linking Google (which proves ownership) removes that unverified password.
          async before(account) {
            if (account.providerId === 'credential') return;
            const owner = await db.query.users.findFirst({
              where: eq(users.id, account.userId),
              columns: { emailVerified: true },
            });
            if (owner && !owner.emailVerified) {
              await db
                .delete(accounts)
                .where(
                  and(eq(accounts.userId, account.userId), eq(accounts.providerId, 'credential')),
                );
            }
          },
        },
      },
      session: {
        create: {
          // The last line of defence for every sign-in method: no session for suspended or unverified users.
          async before(session) {
            const u = await db.query.users.findFirst({
              where: eq(users.id, session.userId),
              columns: { suspendedAt: true, emailVerified: true, phoneNumberVerified: true },
            });
            if (!u || u.suspendedAt || (!u.emailVerified && !u.phoneNumberVerified)) return false;
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;

        try {
          const pickId = OTP_SEND_PATHS[ctx.path];
          if (pickId) {
            const id = pickId(body);
            if (typeof id === 'string' && id) await otpLimiter.check(id);
          }
        } catch (err) {
          if (err instanceof AppError) {
            throw apiError('TOO_MANY_REQUESTS', 'RATE_LIMITED', err.message, {
              retryAfter: err.extra.retryAfterSeconds,
            });
          }
          throw err;
        }

        const pwField = PASSWORD_FIELDS[ctx.path];
        if (pwField && typeof body[pwField] === 'string') {
          const inputs = [body.name, body.email, body.phoneNumber].filter(
            (v): v is string => typeof v === 'string',
          );
          const check = await checkPassword(body[pwField] as string, inputs);
          if (!check.ok)
            throw apiError('BAD_REQUEST', 'WEAK_PASSWORD', 'Please choose a stronger password', {
              problem: check.problem,
            });
        }

        if (ctx.path === '/sign-up/email') {
          if (body.acceptTerms !== true) {
            throw apiError('BAD_REQUEST', 'VALIDATION_FAILED', 'You must accept the terms', {
              fields: { acceptTerms: 'consent_required' },
            });
          }
          delete body.acceptTerms;
          if (typeof body.email === 'string') {
            const addr = body.email.trim().toLowerCase();
            body.email = addr;
            // An abandoned, never-verified sign-up must not block the real owner of the address.
            await db
              .delete(users)
              .where(
                and(
                  eq(users.email, addr),
                  eq(users.emailVerified, false),
                  eq(users.phoneNumberVerified, false),
                ),
              );
          }
          if (typeof body.name === 'string')
            body.name = body.name.replace(/\s+/g, ' ').trim().slice(0, 80);
        }

        if (SIGN_IN_PATHS.has(ctx.path)) {
          const user = await findUserForSignIn(body);
          if (!user) return;
          const ipLockTtl = await redis.ttl(ipLockKey(user.id, reqMeta(ctx).ip));
          const accountLockSeconds =
            user.lockedUntil && user.lockedUntil > new Date()
              ? Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000)
              : 0;
          const retryAfter = Math.max(ipLockTtl > 0 ? ipLockTtl : 0, accountLockSeconds);
          if (retryAfter > 0) {
            throw apiError(
              'LOCKED',
              'ACCOUNT_LOCKED',
              'Too many failed attempts. Try again later.',
              { retryAfter },
            );
          }
          const unverified = !user.emailVerified && !user.phoneNumberVerified;
          if ((user.suspendedAt || unverified) && (await passwordMatches(user.id, body.password))) {
            if (user.suspendedAt)
              throw apiError('FORBIDDEN', 'ACCOUNT_SUSPENDED', 'This account is suspended');
            throw apiError('FORBIDDEN', 'NOT_VERIFIED', 'Please verify your account first');
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        const failed = returned instanceof APIError;
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const meta = reqMeta(ctx);

        if (SIGN_IN_PATHS.has(ctx.path)) {
          const user = await findUserForSignIn(body);
          if (!user) return;
          if (!failed) {
            await redis.del(failKey(user.id, meta.ip));
            await db
              .update(users)
              .set({ failedLoginCount: 0, lockedUntil: null })
              .where(eq(users.id, user.id));
            await audit('login', {
              actorUserId: user.id,
              metadata: { method: ctx.path.endsWith('email') ? 'email' : 'phone' },
              ...meta,
            });
            return;
          }
          const code = (returned as APIError).body?.code;
          if (code === 'INVALID_EMAIL_OR_PASSWORD' || code === 'INVALID_PHONE_NUMBER_OR_PASSWORD') {
            await audit('login_failed', { actorUserId: user.id, ...meta });
            const lockSeconds = LOGIN_LOCKOUT.lockMinutes * 60;
            const fk = failKey(user.id, meta.ip);
            const ak = accountFailKey(user.id);
            const res = await redis
              .multi()
              .incr(fk)
              .expire(fk, lockSeconds, 'NX')
              .incr(ak)
              .expire(ak, LOGIN_LOCKOUT.accountWindowMinutes * 60, 'NX')
              .exec();
            const fromHere = Number(res?.[0]?.[1] ?? 0);
            const overall = Number(res?.[2]?.[1] ?? 0);
            await db
              .update(users)
              .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
              .where(eq(users.id, user.id));
            if (overall >= LOGIN_LOCKOUT.accountMaxFailures) {
              // Attempts from many networks: lock the account itself and tell the owner.
              await redis.del(ak);
              await db
                .update(users)
                .set({
                  lockedUntil: new Date(Date.now() + lockSeconds * 1000),
                  failedLoginCount: 0,
                })
                .where(eq(users.id, user.id));
              await audit('lockout', {
                actorUserId: user.id,
                metadata: { scope: 'account' },
                ...meta,
              });
              await notifyLockout(user, meta.acceptLanguage);
            } else if (fromHere >= LOGIN_LOCKOUT.maxFailures) {
              // Only this network is paused; the owner can still sign in from their own.
              await redis.del(fk);
              await redis.set(ipLockKey(user.id, meta.ip), '1', 'EX', lockSeconds);
              await audit('lockout', {
                actorUserId: user.id,
                metadata: { scope: 'network' },
                ...meta,
              });
            }
          }
          return;
        }

        if (failed) return;
        const sessionUser = ctx.context.newSession?.user ?? ctx.context.session?.user;
        switch (ctx.path) {
          case '/email-otp/verify-email':
            if (sessionUser)
              await audit('email_verified', { actorUserId: sessionUser.id, ...meta });
            break;
          case '/phone-number/verify':
            if (sessionUser)
              await audit(body.updatePhoneNumber ? 'phone_change' : 'phone_verified', {
                actorUserId: sessionUser.id,
                ...meta,
              });
            break;
          case '/email-otp/change-email':
            if (sessionUser) {
              await db
                .update(users)
                .set({ emailIsPlaceholder: false })
                .where(eq(users.id, sessionUser.id));
              await audit('email_change', { actorUserId: sessionUser.id, ...meta });
            }
            break;
          case '/email-otp/reset-password':
          case '/phone-number/reset-password': {
            const user = await findUserForSignIn(body);
            if (user) {
              await db
                .update(users)
                .set({ failedLoginCount: 0, lockedUntil: null })
                .where(eq(users.id, user.id));
              await redis.del(accountFailKey(user.id));
              await audit('password_reset', { actorUserId: user.id, ...meta });
            }
            break;
          }
          case '/change-password':
            if (sessionUser)
              await audit('password_change', { actorUserId: sessionUser.id, ...meta });
            break;
          case '/revoke-sessions':
            if (sessionUser) await audit('logout_all', { actorUserId: sessionUser.id, ...meta });
            break;
        }
      }),
    },
  });

  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
export { placeholderEmailFor };
