import type { GroupRole } from './enums';

/**
 * Authorisation rules shared by the API (enforced on every request) and the UI
 * (only to hide buttons — the API is always the source of truth).
 */
export interface Actor {
  id: string;
  /** groupId → role, for groups the actor belongs to (Phase 2). */
  groupRoles?: Record<string, GroupRole>;
}

export interface TaskAccessFacts {
  createdBy: string | null;
  assigneeId: string | null;
  groupId: string | null;
}

function roleIn(actor: Actor, groupId: string): GroupRole | undefined {
  return actor.groupRoles?.[groupId];
}

export function canViewTask(actor: Actor, task: TaskAccessFacts): boolean {
  if (task.groupId) return roleIn(actor, task.groupId) !== undefined;
  return task.createdBy === actor.id || task.assigneeId === actor.id;
}

/** Edit fields and delete: the creator, or an admin of the task's group. */
export function canEditTask(actor: Actor, task: TaskAccessFacts): boolean {
  if (!canViewTask(actor, task)) return false;
  if (task.createdBy === actor.id) return true;
  return !!task.groupId && roleIn(actor, task.groupId) === 'admin';
}

export const canDeleteTask = canEditTask;

/** Mark done / undo / in progress: anyone who can edit, plus the assignee. */
export function canChangeTaskStatus(actor: Actor, task: TaskAccessFacts): boolean {
  return canEditTask(actor, task) || (canViewTask(actor, task) && task.assigneeId === actor.id);
}
