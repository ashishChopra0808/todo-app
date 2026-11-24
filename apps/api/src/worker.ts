import pino from 'pino';
import { createDb } from './db/client';
import { loadConfig } from './config';
import { startScheduler } from './jobs/scheduler';
import { createRedis } from './lib/redis';
import { initSentry } from './lib/sentry';
import { createAvatars } from './services/avatars';
import { createEmailSender } from './services/email';
import { createNotificationService } from './services/notifications';
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
const storage = createStorage(config);
const notifications = createNotificationService({
  db,
  config,
  email: createEmailSender(config, log),
  avatarUrl: createAvatars(storage),
  log,
});
const scheduler = await startScheduler({ redis, db, storage, log, notifications });
log.info('worker started');

process.on('SIGTERM', async () => {
  await scheduler.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
});
