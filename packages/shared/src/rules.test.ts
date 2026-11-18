import { describe, expect, it } from 'vitest';
import { canChangeTaskStatus, canDeleteTask, canEditTask, canViewTask } from './rules';

const me = { id: 'me' };
const personal = { createdBy: 'me', assigneeId: 'me', groupId: null };
const someoneElses = { createdBy: 'other', assigneeId: 'other', groupId: null };

describe('task rules', () => {
  it('personal tasks are visible and editable only by their owner', () => {
    expect(canViewTask(me, personal)).toBe(true);
    expect(canEditTask(me, personal)).toBe(true);
    expect(canViewTask(me, someoneElses)).toBe(false);
    expect(canEditTask(me, someoneElses)).toBe(false);
    expect(canDeleteTask(me, someoneElses)).toBe(false);
    expect(canChangeTaskStatus(me, someoneElses)).toBe(false);
  });

  it('group tasks: members view, creator/admin edit, assignee changes status', () => {
    const task = { createdBy: 'other', assigneeId: 'me', groupId: 'g1' };
    const member = { id: 'me', groupRoles: { g1: 'member' as const } };
    const admin = { id: 'boss', groupRoles: { g1: 'admin' as const } };
    const outsider = { id: 'x', groupRoles: { g2: 'admin' as const } };
    expect(canViewTask(member, task)).toBe(true);
    expect(canEditTask(member, task)).toBe(false);
    expect(canChangeTaskStatus(member, task)).toBe(true);
    expect(canEditTask(admin, task)).toBe(true);
    expect(canViewTask(outsider, task)).toBe(false);
  });
});
