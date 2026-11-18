import pino from 'pino';
import { createDb } from './db/client';
import { loadConfig } from './config';
import { startScheduler } from './jobs/scheduler';
import { createRedis } from './lib/redis';
import { initSentry } from './lib/sentry';
import { createStorage } from './services/storage';

/** Standalone worker, for when RUN_WORKER_IN_PROCESS=false (e.g. production with a separate service). */
const config = loadConfig();
initSentry(config);
const log = pino({
  level: config.LOG_LEVEL,
  base: { service: 'todo-worker', env: config.APP_ENV },
});
const { db, pool } = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const scheduler = await startScheduler({ redis, db, storage: createStorage(config), log });
log.info('worker started');

process.on('SIGTERM', async () => {
  await scheduler.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
});
