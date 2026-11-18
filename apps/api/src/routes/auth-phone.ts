import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { checkPassword } from '@todo/shared/password';
import { phoneSignUpSchema } from '@todo/shared';
import type { AppDeps } from '../app';
import {
  PHONE_SIGNUP_COOKIE,
  PHONE_SIGNUP_TTL_SECONDS,
  pendingPhoneKey,
  type PendingPhoneSignUp,
} from '../auth/auth';
import { hashPassword } from '../auth/password-hash';
import { toWebRequest } from '../auth/bridge';
import { users } from '../db/schema';
import { AppError } from '../lib/errors';

/**
 * Step 1 of phone + password sign-up (Better Auth has phone OTP but no phone+password sign-up).
 * Stores the pending sign-up, sends the OTP. Step 2 is POST /api/auth/phone-number/verify,
 * which creates the account and signs the user in (see auth/auth.ts).
 */
export function phoneAuthRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post(
    '/api/v1/auth/phone/sign-up',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const input = phoneSignUpSchema.parse(req.body);
      const strength = await checkPassword(input.password, [input.name, input.phoneNumber]);
      if (!strength.ok)
        throw new AppError('weak_password', 'Please choose a stronger password', {
          fields: { password: strength.problem ?? 'too_weak' },
        });

      const existing = await deps.db.query.users.findFirst({
        where: eq(users.phoneNumber, input.phoneNumber),
        columns: { id: true },
      });
      if (existing) throw new AppError('phone_taken', 'This number is already registered');

      // Send the OTP first: if the per-number limit blocks it, nothing is stored.
      const webReq = toWebRequest(req, req.clientIp, deps.config.APP_ORIGIN);
      const headers = new Headers(webReq.headers);
      headers.set('content-type', 'application/json');
      const res = await deps.auth.handler(
        new Request(new URL('/api/auth/phone-number/send-otp', deps.config.APP_ORIGIN), {
          method: 'POST',
          headers,
          body: JSON.stringify({ phoneNumber: input.phoneNumber }),
        }),
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { retryAfter?: number };
        throw new AppError('rate_limited', 'Please wait before requesting another code', {
          retryAfterSeconds: body.retryAfter ?? 60,
        });
      }

      const nonce = randomBytes(18).toString('base64url');
      const pending: PendingPhoneSignUp = {
        name: input.name,
        passwordHash: await hashPassword(input.password),
        locale: input.locale,
        timeZone: input.timeZone,
        ip: req.clientIp,
      };
      await deps.redis.set(
        pendingPhoneKey(input.phoneNumber, nonce),
        JSON.stringify(pending),
        'EX',
        PHONE_SIGNUP_TTL_SECONDS,
      );

      const secure = deps.config.APP_ORIGIN.startsWith('https://') ? '; Secure' : '';
      reply.header(
        'set-cookie',
        `${PHONE_SIGNUP_COOKIE}=${nonce}; Path=/api/auth; Max-Age=${PHONE_SIGNUP_TTL_SECONDS}; HttpOnly; SameSite=Strict${secure}`,
      );
      return reply.status(201).send({ status: 'otp_sent', phoneNumber: input.phoneNumber });
    },
  );
}
