import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { UNVERIFIED_ACCOUNT_TTL_HOURS } from '@todo/shared';
import type { Db } from '../db/client';
import { deletedAccounts, files, tasks, users, verifications } from '../db/schema';
import type { Storage } from '../services/storage';

/**
 * Daily housekeeping:
 * - purge hidden content (tasks, files) past its 180-day retention
 * - purge legal-retention records of deleted accounts past 180 days
 * - delete sign-ups that were never verified within 24 hours
 * - delete expired OTP/verification rows
 */
export async function runMaintenance(db: Db, storage: Storage, now = new Date()) {
  const purgedTasks = await db
    .delete(tasks)
    .where(and(isNotNull(tasks.purgeAfter), lt(tasks.purgeAfter, now)))
    .returning({ id: tasks.id });

  const dueFiles = await db.query.files.findMany({
    where: and(isNotNull(files.purgeAfter), lt(files.purgeAfter, now)),
  });
  for (const f of dueFiles) {
    await storage.remove(f.storageKey).catch(() => undefined);
    await db.delete(files).where(eq(files.id, f.id));
  }

  const purgedRecords = await db
    .delete(deletedAccounts)
    .where(lt(deletedAccounts.purgeAfter, now))
    .returning({ id: deletedAccounts.id });

  const cutoff = new Date(now.getTime() - UNVERIFIED_ACCOUNT_TTL_HOURS * 3600 * 1000);
  const unverified = await db
    .delete(users)
    .where(
      and(
        eq(users.emailVerified, false),
        eq(users.phoneNumberVerified, false),
        lt(users.createdAt, cutoff),
      ),
    )
    .returning({ id: users.id });

  const expired = await db
    .delete(verifications)
    .where(lt(verifications.expiresAt, sql`now() - interval '1 day'`))
    .returning({ id: verifications.id });

  return {
    purgedTasks: purgedTasks.length,
    purgedFiles: dueFiles.length,
    purgedDeletedAccounts: purgedRecords.length,
    deletedUnverifiedUsers: unverified.length,
    deletedVerifications: expired.length,
  };
}
