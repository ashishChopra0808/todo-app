import { and, eq, isNull } from 'drizzle-orm';
import type { Actor, GroupRole } from '@todo/shared';
import type { Db } from '../db/client';
import { groupMembers, groups } from '../db/schema';

/** The signed-in user as the services see them: id, time zone and roles in active groups. */
export interface Viewer extends Actor {
  id: string;
  timeZone: string;
  groupRoles: Record<string, GroupRole>;
}

/** Roles in groups that are not deleted or removed. Loaded once per request. */
export async function loadGroupRoles(db: Db, userId: string): Promise<Record<string, GroupRole>> {
  const rows = await db
    .select({ groupId: groupMembers.groupId, role: groupMembers.role })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(eq(groupMembers.userId, userId), isNull(groups.deletedAt), isNull(groups.removedAt)),
    );
  return Object.fromEntries(rows.map((r) => [r.groupId, r.role]));
}

export const groupIdsOf = (viewer: Viewer): string[] => Object.keys(viewer.groupRoles);
