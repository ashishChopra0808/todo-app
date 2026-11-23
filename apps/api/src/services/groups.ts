import { randomInt } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  GROUPS,
  INVITE_ALPHABET,
  RETENTION_DAYS,
  canInvite,
  canManageGroup,
  canRemoveMember,
  isPlaceholderEmail,
  maskEmail,
  maskPhone,
  type GroupDto,
  type GroupMemberDto,
  type GroupRole,
  type InviteDto,
  type InvitePreviewDto,
  type groupCreateSchema,
  type groupUpdateSchema,
  type inviteCreateSchema,
} from '@todo/shared';
import { isLocale, translate } from '@todo/i18n';
import type { z } from 'zod';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { files, groupInvites, groupMembers, groups, tasks, users } from '../db/schema';
import type { CryptoKit } from '../lib/crypto';
import { AppError, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import type { Audit, AuditContext } from './audit';
import type { AvatarUrl } from './avatars';
import type { DailyLimits } from './daily-limits';
import type { EmailSender } from './email';
import type { Viewer } from './membership';
import type { SmsSender } from './sms';
import { creatorNotSuspended, type TaskService } from './tasks';

type UserRow = typeof users.$inferSelect;
type GroupRow = typeof groups.$inferSelect;
type InviteRow = typeof groupInvites.$inferSelect;

const days = (n: number) => new Date(Date.now() + n * 24 * 3600 * 1000);
const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || null;

function newCode(): string {
  let out = '';
  for (let i = 0; i < GROUPS.codeLength; i++) out += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return out;
}

interface Deps {
  db: Db;
  config: Config;
  crypto: CryptoKit;
  audit: Audit;
  avatarUrl: AvatarUrl;
  limits: DailyLimits;
  email: EmailSender;
  sms: SmsSender;
  tasks: TaskService;
}

export function createGroupService(d: Deps) {
  const { db } = d;
  const hashTarget = (channel: 'email' | 'phone', value: string) =>
    d.crypto.keyedHash(`invite-${channel}`, value.trim().toLowerCase());

  /** Members of a group with their photos. Suspended users are left out. */
  async function memberRows(groupId: string, limit?: number) {
    const q = db
      .select({
        id: users.id,
        name: users.name,
        image: users.image,
        avatarKey: files.storageKey,
        role: groupMembers.role,
        joinedAt: groupMembers.joinedAt,
      })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .leftJoin(files, and(eq(files.id, users.avatarFileId), isNull(files.deletedAt)))
      .where(and(eq(groupMembers.groupId, groupId), isNull(users.suspendedAt)))
      .orderBy(sql`${groupMembers.role} = 'admin' DESC`, asc(groupMembers.joinedAt));
    return limit ? q.limit(limit) : q;
  }

  async function toMember(r: Awaited<ReturnType<typeof memberRows>>[number]): Promise<GroupMemberDto> {
    return {
      id: r.id,
      name: r.name,
      avatarUrl: await d.avatarUrl({ avatarKey: r.avatarKey, image: r.image }),
      role: r.role,
      joinedAt: r.joinedAt.toISOString(),
    };
  }

  async function activeGroup(id: string): Promise<GroupRow | undefined> {
    return db.query.groups.findFirst({
      where: and(eq(groups.id, id), isNull(groups.deletedAt), isNull(groups.removedAt)),
    });
  }

  /** The group, if the viewer is a member. Anything else is a 404 (never reveal other groups). */
  async function memberGroup(viewer: Viewer, id: string): Promise<GroupRow> {
    if (!viewer.groupRoles[id]) throw notFound();
    const g = await activeGroup(id);
    if (!g) throw notFound();
    return g;
  }

  const countMembers = async (groupId: string) =>
    (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, groupId))
    )[0]?.n ?? 0;

  const countAdmins = async (groupId: string, tx: Pick<Db, 'select'> = db) =>
    (
      await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, 'admin')))
    )[0]?.n ?? 0;

  async function toDto(g: GroupRow, role: GroupRole, viewer: Viewer): Promise<GroupDto> {
    const [preview, memberCount, open] = await Promise.all([
      memberRows(g.id, 5),
      countMembers(g.id),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(
          and(
            eq(tasks.groupId, g.id),
            ne(tasks.status, 'done'),
            isNull(tasks.deletedAt),
            isNull(tasks.removedAt),
            creatorNotSuspended,
          ),
        ),
    ]);
    return {
      id: g.id,
      name: g.name,
      icon: g.icon,
      role,
      memberCount,
      membersCanInvite: g.membersCanInvite,
      preview: await Promise.all(preview.map(toMember)),
      openTaskCount: open[0]?.n ?? 0,
      createdAt: g.createdAt.toISOString(),
      permissions: {
        manage: canManageGroup(viewer, g.id),
        invite: canInvite(viewer, { id: g.id, membersCanInvite: g.membersCanInvite }),
      },
    };
  }

  function inviteDto(i: InviteRow, inviterName: string | null): InviteDto {
    return {
      id: i.id,
      code: i.code,
      channel: i.channel,
      target: i.targetMasked,
      invitedBy: i.invitedBy ? { id: i.invitedBy, name: inviterName ?? '' } : null,
      maxUses: i.maxUses,
      useCount: i.useCount,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    };
  }

  /** Why an invite can't be used, or null if it can. */
  function inviteProblem(i: InviteRow, now = new Date()): string | null {
    if (i.revokedAt) return 'revoked';
    if (i.expiresAt <= now) return 'expired';
    if (i.useCount >= i.maxUses) return 'used_up';
    return null;
  }

  async function findInvite(code: string) {
    const [row] = await db
      .select({ invite: groupInvites, group: groups, inviterName: users.name })
      .from(groupInvites)
      .innerJoin(groups, eq(groups.id, groupInvites.groupId))
      .leftJoin(users, eq(users.id, groupInvites.invitedBy))
      .where(eq(groupInvites.code, code))
      .limit(1);
    if (!row || row.group.deletedAt || row.group.removedAt)
      throw new AppError('invite_invalid', 'This invite is not valid', {
        details: { reason: 'not_found' },
      });
    return row;
  }

  return {
    activeGroup,

    async list(viewer: Viewer): Promise<GroupDto[]> {
      const ids = Object.keys(viewer.groupRoles);
      if (!ids.length) return [];
      const rows = await db.query.groups.findMany({
        where: and(
          inArray(groups.id, ids),
          isNull(groups.deletedAt),
          isNull(groups.removedAt),
        ),
        orderBy: [asc(groups.name), asc(groups.id)],
      });
      return Promise.all(rows.map((g) => toDto(g, viewer.groupRoles[g.id]!, viewer)));
    },

    async get(viewer: Viewer, id: string): Promise<GroupDto> {
      const g = await memberGroup(viewer, id);
      return toDto(g, viewer.groupRoles[id]!, viewer);
    },

    async create(viewer: Viewer, input: z.output<typeof groupCreateSchema>, meta: AuditContext) {
      if (Object.keys(viewer.groupRoles).length >= GROUPS.maxGroupsPerUser)
        throw new AppError('too_many_groups', `You can be in up to ${GROUPS.maxGroupsPerUser} groups`);
      const id = newId();
      await db.transaction(async (tx) => {
        await tx.insert(groups).values({
          id,
          name: input.name,
          icon: input.icon ?? null,
          createdBy: viewer.id,
        });
        await tx.insert(groupMembers).values({ groupId: id, userId: viewer.id, role: 'admin' });
      });
      await d.audit('group_create', {
        actorUserId: viewer.id,
        targetType: 'group',
        targetId: id,
        ...meta,
      });
      const next = { ...viewer, groupRoles: { ...viewer.groupRoles, [id]: 'admin' as const } };
      return this.get(next, id);
    },

    async update(viewer: Viewer, id: string, input: z.output<typeof groupUpdateSchema>) {
      await memberGroup(viewer, id);
      if (!canManageGroup(viewer, id))
        throw new AppError('forbidden', 'Only admins can change the group');
      if (Object.keys(input).length) await db.update(groups).set(input).where(eq(groups.id, id));
      return this.get(viewer, id);
    },

    /** Hidden at once for everyone; kept for 180 days, then purged with its tasks. */
    async remove(viewer: Viewer, id: string, meta: AuditContext) {
      const g = await memberGroup(viewer, id);
      if (!canManageGroup(viewer, id))
        throw new AppError('forbidden', 'Only admins can delete the group');
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(groups)
          .set({ deletedAt: now, deletedBy: viewer.id, purgeAfter: days(RETENTION_DAYS) })
          .where(eq(groups.id, id));
        await tx
          .update(groupInvites)
          .set({ revokedAt: now })
          .where(and(eq(groupInvites.groupId, id), isNull(groupInvites.revokedAt)));
      });
      await d.audit('group_delete', {
        actorUserId: viewer.id,
        targetType: 'group',
        targetId: id,
        metadata: { members: await countMembers(id), name: g.name.slice(0, 60) },
        ...meta,
      });
    },

    async members(viewer: Viewer, id: string): Promise<GroupMemberDto[]> {
      await memberGroup(viewer, id);
      return Promise.all((await memberRows(id)).map(toMember));
    },

    async changeRole(
      viewer: Viewer,
      id: string,
      userId: string,
      role: GroupRole,
      meta: AuditContext,
    ) {
      await memberGroup(viewer, id);
      if (!canManageGroup(viewer, id))
        throw new AppError('forbidden', 'Only admins can change roles');
      await db.transaction(async (tx) => {
        // Lock the group's member rows so two admins can't demote each other at the same time.
        const rows = await tx
          .select()
          .from(groupMembers)
          .where(eq(groupMembers.groupId, id))
          .for('update');
        const target = rows.find((r) => r.userId === userId);
        if (!target) throw notFound();
        if (target.role === role) return;
        if (target.role === 'admin' && rows.filter((r) => r.role === 'admin').length <= 1)
          throw new AppError('last_admin', 'A group needs at least one admin');
        await tx
          .update(groupMembers)
          .set({ role })
          .where(and(eq(groupMembers.groupId, id), eq(groupMembers.userId, userId)));
      });
      await d.audit('role_change', {
        actorUserId: viewer.id,
        targetType: 'user',
        targetId: userId,
        metadata: { groupId: id, role },
        ...meta,
      });
      return this.members(viewer, id);
    },

    /** Leave (self) or remove (admin). Their open tasks in the group become unassigned. */
    async removeMember(viewer: Viewer, id: string, userId: string, meta: AuditContext) {
      await memberGroup(viewer, id);
      if (!canRemoveMember(viewer, id, userId))
        throw new AppError('forbidden', 'Only admins can remove members');
      const ipHash = d.crypto.hashIp(meta.ip);
      const unassigned = await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(groupMembers)
          .where(eq(groupMembers.groupId, id))
          .for('update');
        const target = rows.find((r) => r.userId === userId);
        if (!target) throw notFound();
        if (target.role === 'admin' && rows.filter((r) => r.role === 'admin').length <= 1)
          throw new AppError(
            'last_admin',
            rows.length <= 1
              ? 'You are the only member. Delete the group instead.'
              : 'Make someone else an admin first',
            { details: { onlyMember: rows.length <= 1 } },
          );
        await tx
          .delete(groupMembers)
          .where(and(eq(groupMembers.groupId, id), eq(groupMembers.userId, userId)));
        return d.tasks.unassignMember(tx, id, userId, viewer.id, ipHash);
      });
      await d.audit(userId === viewer.id ? 'member_leave' : 'member_remove', {
        actorUserId: viewer.id,
        targetType: 'user',
        targetId: userId,
        metadata: { groupId: id, unassignedTasks: unassigned },
        ...meta,
      });
      return { unassignedTasks: unassigned };
    },

    async createInvite(
      viewer: Viewer,
      inviter: UserRow,
      id: string,
      input: z.output<typeof inviteCreateSchema>,
      meta: AuditContext,
    ): Promise<InviteDto> {
      const g = await memberGroup(viewer, id);
      if (!canInvite(viewer, { id, membersCanInvite: g.membersCanInvite }))
        throw new AppError('forbidden', 'Only admins can invite people to this group');
      if ((await countMembers(id)) >= GROUPS.maxMembers)
        throw new AppError('group_full', `A group can have up to ${GROUPS.maxMembers} members`);
      if (input.channel === 'phone' && !d.sms.canSendInvites)
        throw new AppError('sms_unavailable', 'Invites by SMS are not available yet');

      await d.limits.consume('invites', viewer.id);
      if (input.channel === 'phone') {
        try {
          await d.limits.consume('smsInvites', viewer.id);
        } catch (err) {
          await d.limits.refund('invites', viewer.id);
          throw err;
        }
      }

      const target =
        input.channel === 'email'
          ? { hash: hashTarget('email', input.email), masked: maskEmail(input.email) }
          : input.channel === 'phone'
            ? { hash: hashTarget('phone', input.phone), masked: maskPhone(input.phone) }
            : null;
      const row: typeof groupInvites.$inferInsert = {
        id: newId(),
        groupId: id,
        code: newCode(),
        invitedBy: viewer.id,
        channel: input.channel,
        targetHash: target?.hash ?? null,
        targetMasked: target?.masked ?? null,
        maxUses: input.channel === 'link' ? GROUPS.linkInviteMaxUses : 1,
        expiresAt: days(input.channel === 'link' ? GROUPS.linkInviteDays : GROUPS.targetInviteDays),
      };
      const [saved] = await db.insert(groupInvites).values(row).returning();

      const locale = isLocale(inviter.locale) ? inviter.locale : 'en';
      const link = `${d.config.APP_ORIGIN}/join/${saved!.code}`;
      const vars = { inviter: firstName(inviter.name) ?? '', group: g.name, link };
      try {
        if (input.channel === 'email') {
          await d.email.send({
            to: input.email,
            subject: translate(locale, 'email.invite.subject', vars),
            text: translate(locale, 'email.invite.body', { ...vars, days: GROUPS.targetInviteDays }),
            purpose: 'group-invite',
          });
        } else if (input.channel === 'phone') {
          await d.sms.sendInvite({
            to: input.phone,
            ...vars,
            text: translate(locale, 'sms.invite', vars),
          });
        }
      } catch (err) {
        // Don't leave a usable invite behind if it never reached anyone.
        await db.update(groupInvites).set({ revokedAt: new Date() }).where(eq(groupInvites.id, saved!.id));
        throw err;
      }
      await d.audit('invite_create', {
        actorUserId: viewer.id,
        targetType: 'group',
        targetId: id,
        metadata: { channel: input.channel },
        ...meta,
      });
      return inviteDto(saved!, inviter.name);
    },

    async listInvites(viewer: Viewer, id: string): Promise<InviteDto[]> {
      const g = await memberGroup(viewer, id);
      if (!canInvite(viewer, { id, membersCanInvite: g.membersCanInvite }))
        throw new AppError('forbidden', 'Only admins can see invites');
      const rows = await db
        .select({ invite: groupInvites, inviterName: users.name })
        .from(groupInvites)
        .leftJoin(users, eq(users.id, groupInvites.invitedBy))
        .where(
          and(
            eq(groupInvites.groupId, id),
            isNull(groupInvites.revokedAt),
            gt(groupInvites.expiresAt, new Date()),
            lt(groupInvites.useCount, groupInvites.maxUses),
          ),
        )
        .orderBy(desc(groupInvites.createdAt));
      return rows.map((r) => inviteDto(r.invite, r.inviterName));
    },

    async revokeInvite(viewer: Viewer, inviteId: string, meta: AuditContext) {
      const invite = await db.query.groupInvites.findFirst({ where: eq(groupInvites.id, inviteId) });
      if (!invite) throw notFound();
      const g = await memberGroup(viewer, invite.groupId);
      const allowed =
        canManageGroup(viewer, g.id) ||
        (invite.invitedBy === viewer.id &&
          canInvite(viewer, { id: g.id, membersCanInvite: g.membersCanInvite }));
      if (!allowed) throw new AppError('forbidden', 'Only admins can revoke invites');
      if (!invite.revokedAt)
        await db.update(groupInvites).set({ revokedAt: new Date() }).where(eq(groupInvites.id, inviteId));
      await d.audit('invite_revoke', {
        actorUserId: viewer.id,
        targetType: 'group',
        targetId: g.id,
        ...meta,
      });
    },

    /** Join page preview. Works signed out; never lists members. */
    async preview(code: string, viewer: Viewer | null): Promise<InvitePreviewDto> {
      const { invite, group, inviterName } = await findInvite(code);
      const problem = inviteProblem(invite);
      const alreadyMember = !!viewer?.groupRoles[group.id];
      if (problem && !alreadyMember)
        throw new AppError('invite_invalid', 'This invite is not valid', {
          details: { reason: problem },
        });
      return {
        code: invite.code,
        group: { id: group.id, name: group.name, icon: group.icon },
        inviterFirstName: firstName(inviterName),
        memberCount: await countMembers(group.id),
        restricted: invite.channel,
        alreadyMember,
      };
    },

    async accept(viewer: Viewer, user: UserRow, code: string, meta: AuditContext) {
      const { invite, group } = await findInvite(code);
      if (viewer.groupRoles[group.id])
        return { group: await this.get(viewer, group.id), joined: false };
      const problem = inviteProblem(invite);
      if (problem)
        throw new AppError('invite_invalid', 'This invite is not valid', {
          details: { reason: problem },
        });
      if (invite.channel !== 'link') {
        const value =
          invite.channel === 'email'
            ? user.emailVerified && !user.emailIsPlaceholder && !isPlaceholderEmail(user.email)
              ? user.email
              : null
            : user.phoneNumberVerified
              ? user.phoneNumber
              : null;
        if (!value || hashTarget(invite.channel, value) !== invite.targetHash)
          throw new AppError('invite_invalid', 'This invite is for a different account', {
            details: { reason: 'wrong_account', channel: invite.channel },
          });
      }
      if (Object.keys(viewer.groupRoles).length >= GROUPS.maxGroupsPerUser)
        throw new AppError('too_many_groups', `You can be in up to ${GROUPS.maxGroupsPerUser} groups`);

      await db.transaction(async (tx) => {
        // Lock the group row: member-count check and insert happen one join at a time.
        await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, group.id)).for('update');
        const [{ n } = { n: 0 }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(groupMembers)
          .where(eq(groupMembers.groupId, group.id));
        if (n >= GROUPS.maxMembers)
          throw new AppError('group_full', `A group can have up to ${GROUPS.maxMembers} members`);
        const used = await tx
          .update(groupInvites)
          .set({ useCount: sql`${groupInvites.useCount} + 1` })
          .where(
            and(
              eq(groupInvites.id, invite.id),
              isNull(groupInvites.revokedAt),
              gt(groupInvites.expiresAt, new Date()),
              lt(groupInvites.useCount, groupInvites.maxUses),
            ),
          )
          .returning({ id: groupInvites.id });
        if (!used.length)
          throw new AppError('invite_invalid', 'This invite is not valid', {
            details: { reason: 'used_up' },
          });
        await tx
          .insert(groupMembers)
          .values({ groupId: group.id, userId: user.id, role: 'member' })
          .onConflictDoNothing();
      });
      await d.audit('member_join', {
        actorUserId: user.id,
        targetType: 'group',
        targetId: group.id,
        metadata: { channel: invite.channel },
        ...meta,
      });
      const next = { ...viewer, groupRoles: { ...viewer.groupRoles, [group.id]: 'member' as const } };
      return { group: await this.get(next, group.id), joined: true };
    },

    /**
     * Account deletion: groups where this user is the only admin get a new admin (the longest
     * standing member); groups where they are the only member are deleted.
     */
    async handOverOnAccountDelete(tx: Parameters<Parameters<Db['transaction']>[0]>[0], userId: string) {
      const mine = await tx
        .select({ groupId: groupMembers.groupId, role: groupMembers.role })
        .from(groupMembers)
        .where(eq(groupMembers.userId, userId));
      for (const m of mine) {
        if (m.role !== 'admin') continue;
        const others = await tx
          .select({ userId: groupMembers.userId, role: groupMembers.role })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, m.groupId), ne(groupMembers.userId, userId)))
          .orderBy(asc(groupMembers.joinedAt));
        if (!others.length) {
          await tx
            .update(groups)
            .set({ deletedAt: new Date(), purgeAfter: days(RETENTION_DAYS) })
            .where(and(eq(groups.id, m.groupId), isNull(groups.deletedAt)));
        } else if (!others.some((o) => o.role === 'admin')) {
          await tx
            .update(groupMembers)
            .set({ role: 'admin' })
            .where(and(eq(groupMembers.groupId, m.groupId), eq(groupMembers.userId, others[0]!.userId)));
        }
      }
    },
  };
}
export type GroupService = ReturnType<typeof createGroupService>;
