import type { GroupRole, ReportTarget } from './enums';

/**
 * Authorisation rules shared by the API (enforced on every request) and the UI
 * (only to hide buttons — the API is always the source of truth).
 */
export interface Actor {
  id: string;
  /** groupId → role, for active groups the actor belongs to. */
  groupRoles?: Record<string, GroupRole>;
}

export interface TaskAccessFacts {
  createdBy: string | null;
  assigneeId: string | null;
  groupId: string | null;
}

export interface GroupFacts {
  id: string;
  membersCanInvite: boolean;
}

export interface CommentFacts {
  authorId: string | null;
}

export function roleIn(actor: Actor, groupId: string | null | undefined): GroupRole | undefined {
  return groupId ? actor.groupRoles?.[groupId] : undefined;
}

export const isMember = (actor: Actor, groupId: string | null | undefined): boolean =>
  roleIn(actor, groupId) !== undefined;

export const isAdmin = (actor: Actor, groupId: string | null | undefined): boolean =>
  roleIn(actor, groupId) === 'admin';

export function canViewTask(actor: Actor, task: TaskAccessFacts): boolean {
  if (task.groupId) return isMember(actor, task.groupId);
  return task.createdBy === actor.id || task.assigneeId === actor.id;
}

/** Edit fields (including the assignee) and delete: the creator, or an admin of the task's group. */
export function canEditTask(actor: Actor, task: TaskAccessFacts): boolean {
  if (!canViewTask(actor, task)) return false;
  if (task.createdBy === actor.id) return true;
  return isAdmin(actor, task.groupId);
}

export const canDeleteTask = canEditTask;

/** Mark done / undo / in progress: anyone who can edit, plus the assignee. */
export function canChangeTaskStatus(actor: Actor, task: TaskAccessFacts): boolean {
  return canEditTask(actor, task) || (canViewTask(actor, task) && task.assigneeId === actor.id);
}

/** Change who a group task is assigned to. Personal tasks always belong to their creator. */
export function canAssign(actor: Actor, task: TaskAccessFacts): boolean {
  return !!task.groupId && canEditTask(actor, task);
}

/**
 * Move a task between Personal and a group, or between groups: only its creator,
 * and only into a group they belong to (`toGroupId` null = Personal).
 */
export function canMoveTask(
  actor: Actor,
  task: TaskAccessFacts,
  toGroupId: string | null,
): boolean {
  if (!canViewTask(actor, task) || task.createdBy !== actor.id) return false;
  return toGroupId === null || isMember(actor, toGroupId);
}

/** Create a task in a group (any member) or Personal (anyone). */
export const canCreateTaskIn = (actor: Actor, groupId: string | null): boolean =>
  groupId === null || isMember(actor, groupId);

/** Rename, change icon and settings, delete the group, change roles, remove members. */
export const canManageGroup = (actor: Actor, groupId: string): boolean => isAdmin(actor, groupId);

export function canInvite(actor: Actor, group: GroupFacts): boolean {
  const role = roleIn(actor, group.id);
  return role === 'admin' || (role === 'member' && group.membersCanInvite);
}

/** Admins remove anyone; everyone can remove themselves (leave). The last-admin rule is checked by the API. */
export function canRemoveMember(actor: Actor, groupId: string, userId: string): boolean {
  if (!isMember(actor, groupId)) return false;
  return userId === actor.id || isAdmin(actor, groupId);
}

export const canComment = canViewTask;

export function canEditComment(actor: Actor, comment: CommentFacts): boolean {
  return !!comment.authorId && comment.authorId === actor.id;
}

export const canDeleteComment = canEditComment;

/** Anyone who can see something can report it, except their own content and themselves. */
export function canReport(
  actor: Actor,
  target: { type: ReportTarget; ownerId: string | null },
): boolean {
  return target.ownerId !== actor.id;
}
