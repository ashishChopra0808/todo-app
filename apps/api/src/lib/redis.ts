import { Redis } from 'ioredis';

export function createRedis(url: string) {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
}
export type RedisClient = Redis;
