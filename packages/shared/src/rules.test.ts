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

  it('group tasks nobody is assigned to: any member can tick them, but not edit them', () => {
    const member = { id: 'me', groupRoles: { g1: 'member' as const } };
    const outsider = { id: 'x', groupRoles: {} };
    const unassigned = { createdBy: 'other', assigneeId: null, groupId: 'g1' };
    expect(canChangeTaskStatus(member, unassigned)).toBe(true);
    expect(canEditTask(member, unassigned)).toBe(false);
    expect(canChangeTaskStatus(outsider, unassigned)).toBe(false);
    const someoneElse = { createdBy: 'other', assigneeId: 'third', groupId: 'g1' };
    expect(canChangeTaskStatus(member, someoneElse)).toBe(false);
  });
});

import {
  canAssign,
  canComment,
  canEditComment,
  canInvite,
  canManageGroup,
  canMoveTask,
  canRemoveMember,
  canReport,
} from './rules';

describe('group rules', () => {
  const admin = { id: 'a', groupRoles: { g1: 'admin' as const } };
  const member = { id: 'm', groupRoles: { g1: 'member' as const, g2: 'member' as const } };
  const outsider = { id: 'x', groupRoles: {} };

  it('only admins manage; members invite when allowed', () => {
    expect(canManageGroup(admin, 'g1')).toBe(true);
    expect(canManageGroup(member, 'g1')).toBe(false);
    expect(canInvite(member, { id: 'g1', membersCanInvite: false })).toBe(false);
    expect(canInvite(member, { id: 'g1', membersCanInvite: true })).toBe(true);
    expect(canInvite(outsider, { id: 'g1', membersCanInvite: true })).toBe(false);
  });

  it('leave yourself; admins remove others', () => {
    expect(canRemoveMember(member, 'g1', 'm')).toBe(true);
    expect(canRemoveMember(member, 'g1', 'a')).toBe(false);
    expect(canRemoveMember(admin, 'g1', 'm')).toBe(true);
    expect(canRemoveMember(outsider, 'g1', 'x')).toBe(false);
  });

  it('assign and move', () => {
    const groupTask = { createdBy: 'm', assigneeId: null, groupId: 'g1' };
    expect(canAssign(member, groupTask)).toBe(true);
    expect(canAssign(admin, groupTask)).toBe(true);
    expect(canAssign(admin, { ...groupTask, createdBy: 'z' })).toBe(true);
    expect(canAssign(member, { ...groupTask, createdBy: 'z' })).toBe(false);
    expect(canAssign(member, { createdBy: 'm', assigneeId: 'm', groupId: null })).toBe(false);
    expect(canMoveTask(member, groupTask, 'g2')).toBe(true);
    expect(canMoveTask(member, groupTask, null)).toBe(true);
    expect(canMoveTask(member, groupTask, 'g3')).toBe(false);
    expect(canMoveTask(admin, groupTask, null)).toBe(false); // admins can't move others' tasks
  });

  it('comments and reports', () => {
    const task = { createdBy: 'a', assigneeId: null, groupId: 'g1' };
    expect(canComment(member, task)).toBe(true);
    expect(canComment(outsider, task)).toBe(false);
    expect(canEditComment(member, { authorId: 'm' })).toBe(true);
    expect(canEditComment(admin, { authorId: 'm' })).toBe(false);
    expect(canEditComment(member, { authorId: null })).toBe(false);
    expect(canReport(member, { type: 'comment', ownerId: 'm' })).toBe(false);
    expect(canReport(member, { type: 'comment', ownerId: 'a' })).toBe(true);
  });
});
