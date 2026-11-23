import { DAILY_LIMITS, type DailyLimitKind } from '@todo/shared';
import type { RedisClient } from '../lib/redis';
import { AppError } from '../lib/errors';

/**
 * Anti-spam: per-user daily counters in Redis (UTC day). `consume` counts and throws
 * `daily_limit` once the limit is passed. Off when rate limits are switched off.
 */
export function createDailyLimits(redis: RedisClient, enabled: boolean) {
  const keyFor = (kind: DailyLimitKind, userId: string, now: Date) =>
    `daily:${kind}:${userId}:${now.toISOString().slice(0, 10)}`;

  return {
    async consume(kind: DailyLimitKind, userId: string, amount = 1, now = new Date()) {
      if (!enabled) return;
      const key = keyFor(kind, userId, now);
      const count = await redis.incrby(key, amount);
      if (count === amount) await redis.expire(key, 2 * 24 * 3600);
      if (count > DAILY_LIMITS[kind]) {
        await redis.decrby(key, amount);
        const midnight = new Date(now);
        midnight.setUTCHours(24, 0, 0, 0);
        throw new AppError('daily_limit', `Daily limit reached (${kind})`, {
          retryAfterSeconds: Math.ceil((midnight.getTime() - now.getTime()) / 1000),
          details: { kind, limit: DAILY_LIMITS[kind] },
        });
      }
    },
    /** Gives back a unit when the action did not happen after all (e.g. validation failed later). */
    async refund(kind: DailyLimitKind, userId: string, amount = 1, now = new Date()) {
      if (!enabled) return;
      await redis.decrby(keyFor(kind, userId, now), amount);
    },
  };
}
export type DailyLimits = ReturnType<typeof createDailyLimits>;
