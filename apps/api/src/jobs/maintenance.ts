import { and, eq, isNotNull, lt, or, sql } from 'drizzle-orm';
import { UNVERIFIED_ACCOUNT_TTL_HOURS } from '@todo/shared';
import type { Db } from '../db/client';
import {
  comments,
  deletedAccounts,
  files,
  groupInvites,
  groups,
  tasks,
  users,
  verifications,
} from '../db/schema';
import type { Storage } from '../services/storage';

/**
 * Daily housekeeping:
 * - purge hidden content (groups, tasks, comments, files) past its 180-day retention
 * - delete invites that expired or were revoked more than 30 days ago
 * - purge legal-retention records of deleted accounts past 180 days
 * - delete sign-ups that were never verified within 24 hours
 * - delete expired OTP/verification rows
 */
export async function runMaintenance(db: Db, storage: Storage, now = new Date()) {
  // Groups first: their tasks, comments, members and invites go with them (ON DELETE CASCADE).
  const purgedGroups = await db
    .delete(groups)
    .where(and(isNotNull(groups.purgeAfter), lt(groups.purgeAfter, now)))
    .returning({ id: groups.id });

  const purgedComments = await db
    .delete(comments)
    .where(and(isNotNull(comments.purgeAfter), lt(comments.purgeAfter, now)))
    .returning({ id: comments.id });

  const inviteCutoff = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const oldInvites = await db
    .delete(groupInvites)
    .where(or(lt(groupInvites.expiresAt, inviteCutoff), lt(groupInvites.revokedAt, inviteCutoff)))
    .returning({ id: groupInvites.id });

  // Recordings uploaded but never attached to a task or comment (e.g. the person gave up).
  await db.execute(sql`
    UPDATE files SET deleted_at = ${now.toISOString()}::timestamptz, purge_after = ${now.toISOString()}::timestamptz
    WHERE kind IN ('task_audio', 'comment_audio') AND deleted_at IS NULL
      AND created_at < ${new Date(now.getTime() - 864e5).toISOString()}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.audio_file_id = files.id)
      AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.audio_file_id = files.id)`);

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
    purgedGroups: purgedGroups.length,
    purgedComments: purgedComments.length,
    deletedInvites: oldInvites.length,
    purgedTasks: purgedTasks.length,
    purgedFiles: dueFiles.length,
    purgedDeletedAccounts: purgedRecords.length,
    deletedUnverifiedUsers: unverified.length,
    deletedVerifications: expired.length,
  };
}
