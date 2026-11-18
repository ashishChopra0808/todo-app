import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
export const OUTBOX = fileURLToPath(new URL('./e2e/.outbox', import.meta.url));
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/todo_e2e';
const REDIS = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/2';
const channel = process.env.PW_CHANNEL || undefined; // 'chrome' to use an installed Chrome

const apiEnv = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  PORT: '3100',
  DATABASE_URL: DB,
  REDIS_URL: REDIS,
  APP_ORIGIN: 'http://localhost:5180',
  BETTER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-1234',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  IP_HASH_SALT: 'e2e-salt-e2e-salt',
  EMAIL_DRIVER: 'file',
  SMS_DRIVER: 'file',
  OUTBOX_DIR: OUTBOX,
  STORAGE_DRIVER: 'local',
  LOCAL_STORAGE_DIR: fileURLToPath(new URL('./e2e/.storage', import.meta.url)),
  RATE_LIMITS_ENABLED: 'false',
  RUN_WORKER_IN_PROCESS: 'false',
  TRUST_PROXY_HOPS: '0',
  LOG_LEVEL: 'error',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'retain-on-failure',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], channel } },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, channel },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @todo/api exec tsx src/server.ts',
      cwd: root,
      url: 'http://localhost:3100/health',
      env: apiEnv,
      stdout: 'pipe',
      stderr: 'pipe',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Production build + preview: tests the real bundle, service worker and Content Security Policy.
      command:
        'pnpm --filter @todo/web exec vite build && pnpm --filter @todo/web exec vite preview --port 5180 --strictPort',
      cwd: root,
      url: 'http://localhost:5180',
      env: { VITE_API_PROXY: 'http://localhost:3100' },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
