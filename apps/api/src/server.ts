import { buildApp } from './app';
import { loadConfig } from './config';
import { startScheduler } from './jobs/scheduler';
import { initSentry } from './lib/sentry';

const config = loadConfig();
initSentry(config);

const { app, deps, close } = await buildApp(config);
const scheduler = config.RUN_WORKER_IN_PROCESS
  ? await startScheduler({
      redis: deps.redis,
      db: deps.db,
      storage: deps.storage,
      log: app.log,
      notifications: deps.notifications,
    })
  : null;

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await scheduler?.close();
  await close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
