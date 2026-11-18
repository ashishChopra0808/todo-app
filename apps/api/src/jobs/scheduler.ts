import { Queue, Worker } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client';
import type { RedisClient } from '../lib/redis';
import type { Storage } from '../services/storage';
import { runMaintenance } from './maintenance';

const QUEUE = 'maintenance';

/** Registers the daily maintenance job (03:15 IST) and starts a worker for it. */
export async function startScheduler(opts: {
  redis: RedisClient;
  db: Db;
  storage: Storage;
  log: FastifyBaseLogger;
}) {
  const connection = opts.redis.duplicate();
  const queue = new Queue(QUEUE, { connection });
  await queue.upsertJobScheduler(
    'daily-maintenance',
    { pattern: '15 3 * * *', tz: 'Asia/Kolkata' },
    { name: 'maintenance' },
  );
  const worker = new Worker(
    QUEUE,
    async () => {
      const result = await runMaintenance(opts.db, opts.storage);
      opts.log.info({ job: 'maintenance', ...result }, 'maintenance finished');
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
