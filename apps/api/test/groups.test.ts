import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GROUPS, maskPhone } from '@todo/shared';
import { groupInvites, groupMembers, users } from '../src/db/schema';
import {
  client,
  createGroup,
  joinByLink,
  latestMessage,
  meId,
  signUpWithEmail,
  signUpWithPhone,
  useApp,
} from './helpers';

const ctx = useApp();

describe('groups', () => {
  it('creates a group; the creator is its admin and sees it in the list', async () => {
    const asha = await signUpWithEmail(ctx);
    const g = await createGroup(asha, '  Sharma   family ', '👨‍👩‍👧');
    expect(g).toMatchObject({
      name: 'Sharma family',
      icon: '👨‍👩‍👧',
      role: 'admin',
      memberCount: 1,
      membersCanInvite: false,
      permissions: { manage: true, invite: true },
    });
    const list = (await asha.get('/api/v1/groups')).json();
    expect(list.map((x: { id: string }) => x.id)).toEqual([g.id]);
    expect(list[0].preview[0].name).toBe('Asha Verma');
  });

  it('validates name and icon', async () => {
    const asha = await signUpWithEmail(ctx);
    expect((await asha.post('/api/v1/groups', { name: '' })).json().error.fields.name).toBe(
      'required',
    );
    expect((await asha.post('/api/v1/groups', { name: 'x'.repeat(61) })).statusCode).toBe(400);
    const bad = await asha.post('/api/v1/groups', { name: 'Home', icon: '<b>' });
    expect(bad.json().error.fields.icon).toBe('invalid');
    expect((await asha.post('/api/v1/groups', { name: 'Home', icon: 'AB' })).statusCode).toBe(400);
  });

  it('outsiders get 404 on the group, its members and invites', async () => {
    const asha = await signUpWithEmail(ctx);
    const ravi = await signUpWithPhone(ctx);
    const g = await createGroup(asha);
    for (const url of [
      `/api/v1/groups/${g.id}`,
      `/api/v1/groups/${g.id}/members`,
      `/api/v1/groups/${g.id}/invites`,
    ])
      expect((await ravi.get(url)).statusCode, url).toBe(404);
    expect((await ravi.patch(`/api/v1/groups/${g.id}`, { name: 'Mine' })).statusCode).toBe(404);
    expect((await ravi.del(`/api/v1/groups/${g.id}`)).statusCode).toBe(404);
    expect(
      (await ravi.post(`/api/v1/groups/${g.id}/invites`, { channel: 'link' })).statusCode,
    ).toBe(404);
  });

  it('members can view but not manage; admins rename, change settings and delete', async () => {
    const asha = await signUpWithEmail(ctx);
    const ravi = await signUpWithPhone(ctx);
    const g = await createGroup(asha);
    await joinByLink(asha, ravi, g.id);
    const seen = (await ravi.get(`/api/v1/groups/${g.id}`)).json();
    expect(seen).toMatchObject({ role: 'member', memberCount: 2, permissions: { manage: false } });
    expect((await ravi.patch(`/api/v1/groups/${g.id}`, { name: 'Mine' })).statusCode).toBe(403);
    expect((await ravi.del(`/api/v1/groups/${g.id}`)).statusCode).toBe(403);
    const renamed = await asha.patch(`/api/v1/groups/${g.id}`, { name: 'Flat 4B', icon: null });
    expect(renamed.json()).toMatchObject({ name: 'Flat 4B', icon: null });

    expect((await asha.del(`/api/v1/groups/${g.id}`)).statusCode).toBe(204);
    expect((await ravi.get(`/api/v1/groups/${g.id}`)).statusCode).toBe(404);
    expect((await ravi.get('/api/v1/groups')).json()).toEqual([]);
  });

  it('members can invite only when the group allows it', async () => {
    const asha = await signUpWithEmail(ctx);
    const ravi = await signUpWithPhone(ctx);
    const g = await createGroup(asha);
    await joinByLink(asha, ravi, g.id);
    expect(
      (await ravi.post(`/api/v1/groups/${g.id}/invites`, { channel: 'link' })).statusCode,
    ).toBe(403);
    await asha.patch(`/api/v1/groups/${g.id}`, { membersCanInvite: true });
    const inv = await ravi.post(`/api/v1/groups/${g.id}/invites`, { channel: 'link' });
    expect(inv.statusCode).toBe(201);
    // The inviter (a member) may revoke their own invite.
    expect((await ravi.del(`/api/v1/invites/${inv.json().id}`)).statusCode).toBe(204);
  });
});

describe('roles and leaving', () => {
  it('admins change roles; a group always keeps one admin', async () => {
    const asha = await signUpWithEmail(ctx);
    const ravi = await signUpWithPhone(ctx);
    const g = await createGroup(asha);
    await joinByLink(asha, ravi, g.id);
    const ashaId = await meId(asha);
    const raviId = await meId(ravi);

    // Members can't change roles.
    expect(
      (await ravi.patch(`/api/v1/groups/${g.id}/members/${raviId}`, { role: 'admin' })).statusCode,
    ).toBe(403);
    // The only admin can't demote themselves.
    const demote = await asha.patch(`/api/v1/groups/${g.id}/members/${ashaId}`, {
      role: 'member',
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().error.code).toBe('last_admin');

    const promoted = await asha.patch(`/api/v1/groups/${g.id}/members/${raviId}`, {
      role: 'admin',
    });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json().filter((m: { role: string }) => m.role === 'admin')).toHaveLength(2);
    // Now Asha can step down.
    expect(
      (await asha.patch(`/api/v1/groups/${g.id}/members/${ashaId}`, { role: 'member' })).statusCode,
    ).toBe(200);
    const audit = await ctx.deps.db.query.auditLogs.findMany();
    expect(audit.filter((a) => a.action === 'role_change')).toHaveLength(2);
  });

  it('the last admin cannot leave; members can; admins remove members', async () => {
    const asha = await signUpWithEmail(ctx);
    const ravi = await signUpWithPhone(ctx);
    const meera = await signUpWithEmail(ctx, 'meera@example.com', 'Meera Iyer');
    const g = await createGroup(asha);
    await joinByLink(asha, ravi, g.id);
    await joinByLink(asha, meera, g.id);
    const ashaId = await meId(asha);
    const raviId = await meId(ravi);
    const meeraId = await meId(meera);

    const leave = await asha.del(`/api/v1/groups/${g.id}/members/${ashaId}`);
    expect(leave.json().error.code).toBe('last_admin');
    // Members can't remove others.
    expect((await ravi.del(`/api/v1/groups/${g.id}/members/${meeraId}`)).statusCode).toBe(403);
    // Ravi leaves himself.
    expect((await ravi.del(`/api/v1/groups/${g.id}/members/${raviId}`)).statusCode).toBe(200);
    expect((await ravi.get(`/api/v1/groups/${g.id}`)).statusCode).toBe(404);
    // Asha removes Meera.
    expect((await asha.del(`/api/v1/groups/${g.id}/members/${meeraId}`)).statusCode).toBe(200);
    const members = (await asha.get(`/api/v1/groups/${g.id}/members`)).json();
    expect(members.map((m: { id: string }) => m.id)).toEqual([ashaId]);
    // Alone: leaving tells her to delete the group instead.
    const alone = await asha.del(`/api/v1/groups/${g.id}/members/${ashaId}`);
    expect(alone.json().error.details).toEqual({ onlyMember: true });
  });
});

describe('invites', () => {
  it('a link invite: preview works signed out, joining needs a verified account', async () => {
    const asha = await signUpWithEmail(ctx);
    const g = await createGroup(asha);
    const inv = (await asha.post(`/api/v1/groups/${g.id}/invites`, { channel: 'link' })).json();
    expect(inv).toMatchObject({ channel: 'link', maxUses: GROUPS.linkInviteMaxUses, useCount: 0 });
    expect(inv.code).toMatch(/^[23456789A-HJKMNP-Z]{10}$/);

    const anon = client(ctx);
    const preview = await anon.get(`/api/v1/invites/${inv.code.toLowerCase()}`);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual({
      code: inv.code,
      group: { id: g.id, name: 'Sharma family', icon: '🏠' },
      inviterFirstName: 'Asha',
      memberCount: 1,
      restricted: 'link',
      alreadyMember: false,
    });
    expect((await anon.post(`/api/v1/invites/${inv.code}/accept`)).statusCode).toBe(401);

    const ravi = await signUpWithPhone(ctx);
    const joined = await ravi.post(`/api/v1/invites/${inv.code}/accept`);
    expect(joined.statusCode).toBe(201);
    expect(joined.json()).toMatchObject({ id: g.id, role: 'member', memberCount: 2 });
    // Accepting again is harmless and doesn't use up the invite.
    expect((await ravi.post(`/api/v1/invites/${inv.code}/accept`)).statusCode).toBe(200);
    const row = await ctx.deps.db.query.groupInvites.findFirst({
      where: eq(groupInvites.id, inv.id),
    });
    expect(row!.useCount).toBe(1);
  });

  it('expired, revoked and used-up invites are refused', async () => {
    const asha = await signUpWithEmail(ctx);
    const g = await createGroup(asha);
    const mk = async () =>
      (await asha.post(`/api/v1/groups/${g.id}/invites`, { channel: 'link' })).json();

    const expired = await mk();
    await ctx.deps.db
      .update(groupInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(groupInvites.id, expired.id));
    const revoked = await mk();
    expect((await asha.del(`/api/v1/invites/${revoked.id}`)).statusCode).toBe(204);
    const full = await mk();
    await ctx.deps.db
      .update(groupInvites)
      .set({ useCount: GROUPS.linkInviteMaxUses })
      .where(eq(groupInvites.id, full.id));

    const ravi = await signUpWithPhone(ctx);
    for (const [inv, reason] of [
      [expired, 'expired'],
      [revoked, 'revoked'],
      [full, 'used_up'],
    ] as const) {
      const res = await ravi.post(`/api/v1/invites/${inv.code}/accept`);
      expect(res.statusCode, reason).toBe(410);
      expect(res.json().error).toMatchObject({ code: 'invite_invalid', details: { reason } });
      expect((await ravi.get(`/api/v1/invites/${inv.code}`)).json().error.details.reason).toBe(
        reason,
      );
    }
    expect((await ravi.get('/api/v1/invites/ZZZZZZZZZZ')).statusCode).toBe(410);
    expect((await ravi.get('/api/v1/invites/not-a-code')).statusCode).toBe(400);
    // The active list leaves them out.
    expect((await asha.get(`/api/v1/groups/${g.id}/invites`)).json()).toEqual([]);
  });

  it('email invites go by email, work once, and only for that verified email', async () => {
    const asha = await signUpWithEmail(ctx);
    const g = await createGroup(asha);
    const inv = await asha.post(`/api/v1/groups/${g.id}/invites`, {
      channel: 'email',
      email: 'Meera@Example.com',
    });
    expect(inv.statusCode).toBe(201);
    expect(inv.json()).toMatchObject({ channel: 'email', maxUses: 1, target: 'm****@example.com' });
    const mail = await latestMessage(ctx, 'meera@example.com');
    expect(mail.subject).toContain('Sharma family');
    expect(mail.text).toContain(`/join/${inv.json().code}`);
    // The address itself isn't stored, only a keyed hash and a masked copy.
    const row = await ctx.deps.db.query.groupInvites.findFirst({
      where: eq(groupInvites.id, inv.json().id),
    });
    expect(JSON.stringify(row)).not.toContain('meera@');

    const ravi = await signUpWithPhone(ctx);
    const wrong = await ravi.post(`/api/v1/invites/${inv.json().code}/accept`);
    expect(wrong.json().error.details).toEqual({ reason: 'wrong_account', channel: 'email' });

    const meera = await signUpWithEmail(ctx, 'meera@example.com', 'Meera Iyer');
    expect((await meera.post(`/api/v1/invites/${inv.json().code}/accept`)).statusCode).toBe(201);
    expect(
      (await ravi.post(`/api/v1/invites/${inv.json().code}/accept`)).json().error.details.reason,
    ).toBe('used_up');
  });

  it('phone invites go by SMS and match the verified number', async () => {
    const asha = await signUpWithEmail(ctx);
    const g = await createGroup(asha);
    const inv = await asha.post(`/api/v1/groups/${g.id}/invites`, {
      channel: 'phone',
      phone: '98765 43210',
    });
    expect(inv.statusCode).toBe(201);
    expect(inv.json().target).toBe(maskPhone('+919876543210'));
    const sms = await latestMessage(ctx, '+919876543210');
    expect(sms.purpose).toBe('invite');
    expect(sms.text).toContain('/join/');
    const ravi = await signUpWithPhone(ctx, '+919876543210');
    expect((await ravi.post(`/api/v1/invites/${inv.json().code}/accept`)).statusCode).toBe(201);
  });

  it('a full group refuses new members', async () => {
    const asha = await signUpWithEmail(ctx);
    const g = await createGroup(asha);
    const inv = (await asha.post(`/api/v1/groups/${g.id}/invites`, { channel: 'link' })).json();
    // Fill the group up directly in the database.
    const others = Array.from(
      { length: GROUPS.maxMembers - 1 },
      (_, i) => `0193${String(i).padStart(4, '0')}-0000-7000-8000-000000000000`,
    );
    await ctx.deps.db
      .insert(users)
      .values(
        others.map((id, i) => ({ id, name: `U${i}`, email: `u${i}@x.test`, emailVerified: true })),
      );
    await ctx.deps.db
      .insert(groupMembers)
      .values(others.map((userId) => ({ groupId: g.id, userId, role: 'member' as const })));
    const ravi = await signUpWithPhone(ctx);
    const res = await ravi.post(`/api/v1/invites/${inv.code}/accept`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('group_full');
    expect(
      (await asha.post(`/api/v1/groups/${g.id}/invites`, { channel: 'link' })).json().error.code,
    ).toBe('group_full');
  });
});

describe('daily limits', () => {
  it('stops invites after 20 a day', async () => {
    const asha = await signUpWithEmail(ctx);
    const g = await createGroup(asha);
    await ctx.deps.redis.set(
      `daily:invites:${await meId(asha)}:${new Date().toISOString().slice(0, 10)}`,
      20,
    );
    const res = await asha.post(`/api/v1/groups/${g.id}/invites`, { channel: 'link' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('daily_limit');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});
