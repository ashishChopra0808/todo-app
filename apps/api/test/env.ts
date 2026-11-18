import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config';

export const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/todo_test';
export const TEST_REDIS = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';
export const ORIGIN = 'http://localhost:5173';

export function testConfig(overrides: Record<string, string> = {}) {
  const outbox = mkdtempSync(join(tmpdir(), 'todo-outbox-'));
  const storage = mkdtempSync(join(tmpdir(), 'todo-storage-'));
  return loadConfig({
    NODE_ENV: 'test',
    APP_ENV: 'test',
    DATABASE_URL: TEST_DB,
    REDIS_URL: TEST_REDIS,
    APP_ORIGIN: ORIGIN,
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    IP_HASH_SALT: 'test-salt-test-salt',
    EMAIL_DRIVER: 'file',
    SMS_DRIVER: 'file',
    OUTBOX_DIR: outbox,
    STORAGE_DRIVER: 'local',
    LOCAL_STORAGE_DIR: storage,
    PROXY_SHARED_SECRET: 'proxy-secret',
    TRUST_PROXY_HOPS: '0',
    RUN_WORKER_IN_PROCESS: 'false',
    LOG_LEVEL: 'silent',
    RATE_LIMITS_ENABLED: 'true',
    ...overrides,
  });
}
