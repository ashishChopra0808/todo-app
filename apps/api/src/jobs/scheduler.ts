import { Queue, Worker } from 'bullmq';
import { REMINDERS } from '@todo/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client';
import type { RedisClient } from '../lib/redis';
import type { Storage } from '../services/storage';
import type { NotificationService } from '../services/notifications';
import { runMaintenance } from './maintenance';
import { runReminders } from './reminders';

const QUEUE = 'maintenance';

/** Registers the daily maintenance job (03:15 IST) and the 15-minute reminders, and runs them. */
export async function startScheduler(opts: {
  redis: RedisClient;
  db: Db;
  storage: Storage;
  log: FastifyBaseLogger;
  notifications: NotificationService;
}) {
  const connection = opts.redis.duplicate();
  const queue = new Queue(QUEUE, { connection });
  await queue.upsertJobScheduler(
    'daily-maintenance',
    { pattern: '15 3 * * *', tz: 'Asia/Kolkata' },
    { name: 'maintenance' },
  );
  await queue.upsertJobScheduler(
    'reminders',
    { every: REMINDERS.everyMinutes * 60_000 },
    { name: 'reminders' },
  );
  const worker = new Worker(
    QUEUE,
    async (job) => {
      if (job.name === 'reminders') {
        const result = await runReminders(opts.db, (e) => opts.notifications.notify(e));
        await opts.notifications.flush();
        if (result.dueSoon || result.overdue)
          opts.log.info({ job: 'reminders', ...result }, 'reminders sent');
        return result;
      }
      const result = await runMaintenance(opts.db, opts.storage);
      const pruned = await opts.notifications.prune();
      opts.log.info(
        { job: 'maintenance', ...result, prunedNotifications: pruned },
        'maintenance finished',
      );
      return result;
    },
    { connection: opts.redis.duplicate(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => opts.log.error({ job: job?.name, err }, 'job failed'));
  return {
    async close() {
      await worker.close();
      await queue.close();
      connection.disconnect();
    },
  };
}
