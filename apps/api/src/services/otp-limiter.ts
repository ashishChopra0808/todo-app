import { OTP } from '@todo/shared';
import type { RedisClient } from '../lib/redis';
import { AppError } from '../lib/errors';

/**
 * Per-identifier limits for sending OTPs (email or phone), on top of per-IP limits:
 * one send per 60 s (resend cooldown) and at most 5 per hour.
 */
export function createOtpLimiter(redis: RedisClient, enabled: boolean) {
  return {
    async check(identifier: string) {
      if (!enabled) return;
      const id = identifier.trim().toLowerCase();
      const cooldownKey = `otp:cooldown:${id}`;
      const hourKey = `otp:hour:${id}`;
      const ttl = await redis.pttl(cooldownKey);
      if (ttl > 0) {
        throw new AppError('rate_limited', 'Please wait before requesting another code', {
          retryAfterSeconds: Math.ceil(ttl / 1000),
        });
      }
      const count = await redis.incr(hourKey);
      if (count === 1) await redis.expire(hourKey, 3600);
      if (count > OTP.maxSendsPerHour) {
        const hourTtl = await redis.ttl(hourKey);
        throw new AppError('rate_limited', 'Too many codes requested. Try again later.', {
          retryAfterSeconds: Math.max(hourTtl, 60),
        });
      }
      await redis.set(cooldownKey, '1', 'EX', OTP.resendCooldownSeconds);
    },
  };
}
export type OtpLimiter = ReturnType<typeof createOtpLimiter>;
