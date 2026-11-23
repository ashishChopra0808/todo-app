import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { comments, reports, sessions, tasks } from '../src/db/schema';
import { runMaintenance } from '../src/jobs/maintenance';
import {
  createGroup,
  joinByLink,
  meId,
  signUpWithEmail,
  signUpWithPhone,
  useApp,
  type Client,
} from './helpers';

const OWNER = 'owner@example.com';
const ctx = useApp({ OWNER_EMAILS: `${OWNER}, someone@else.test` });

async function setup() {
  const asha = await signUpWithEmail(ctx);
  const ravi = await signUpWithPhone(ctx);
  const g = await createGroup(asha);
  await joinByLink(asha, ravi, g.id);
  const task = (
    await asha.post('/api/v1/tasks', { title: 'Plan Diwali dinner', groupId: g.id })
  ).json();
  return { asha, ravi, g, task, ids: { asha: await meId(asha), ravi: await meId(ravi) } };
}

const comment = async (c: Client, taskId: string, body: string) => {
  const res = await c.post(`/api/v1/tasks/${taskId}/comments`, { body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
};

describe('comments', () => {
  it('members comment; the thread is oldest first with author and edited label', async () => {
    const { asha, ravi, task, ids } = await setup();
    const first = await comment(asha, task.id, '  I will get sweets  ');
    await comment(ravi, task.id, 'I can cook');
    expect(first).toMatchObject({
      body: 'I will get sweets',
      author: { id: ids.asha, name: 'Asha Verma' },
      editedAt: null,
      removed: false,
      permissions: { edit: true, delete: true, report: false },
    });
    const thread = (await ravi.get(`/api/v1/tasks/${task.id}/comments`)).json();
    expect(thread.items.map((c: { body: string }) => c.body)).toEqual([
      'I will get sweets',
      'I can cook',
    ]);
    expect(thread.items[0].permissions).toEqual({ edit: false, delete: false, report: true });
    expect((await asha.get(`/api/v1/tasks/${task.id}`)).json().commentCount).toBe(2);
    const types = (await asha.get(`/api/v1/tasks/${task.id}/activity`))
      .json()
      .map((a: { type: string }) => a.type);
    expect(types).toEqual(['created', 'commented', 'commented']);
  });

  it('only the author edits or deletes; deleted comments are hidden but kept', async () => {
    const { asha, ravi, task } = await setup();
    const c = await comment(ravi, task.id, 'Typo hree');
    expect((await asha.patch(`/api/v1/comments/${c.id}`, { body: 'Hacked' })).statusCode).toBe(403);
    expect((await asha.del(`/api/v1/comments/${c.id}`)).statusCode).toBe(403);
    const edited = (await ravi.patch(`/api/v1/comments/${c.id}`, { body: 'Typo here' })).json();
    expect(edited.body).toBe('Typo here');
    expect(edited.editedAt).toBeTruthy();
    expect((await ravi.del(`/api/v1/comments/${c.id}`)).statusCode).toBe(204);
    expect((await ravi.get(`/api/v1/tasks/${task.id}/comments`)).json().items).toEqual([]);
    const row = await ctx.deps.db.query.comments.findFirst({ where: eq(comments.id, c.id) });
    expect(row!.deletedAt).toBeTruthy();
    expect(row!.purgeAfter!.getTime()).toBeGreaterThan(Date.now() + 179 * 864e5);
    expect((await ravi.patch(`/api/v1/comments/${c.id}`, { body: 'x' })).statusCode).toBe(404);
  });

  it('validates bodies and pages long threads', async () => {
    const { asha, task } = await setup();
    expect((await asha.post(`/api/v1/tasks/${task.id}/comments`, { body: '   ' })).statusCode).toBe(
      400,
    );
    expect(
      (await asha.post(`/api/v1/tasks/${task.id}/comments`, { body: 'x'.repeat(2001) })).statusCode,
    ).toBe(400);
    for (let i = 0; i < 5; i++) await comment(asha, task.id, `c${i}`);
    const p1 = (await asha.get(`/api/v1/tasks/${task.id}/comments?limit=3`)).json();
    expect(p1.items).toHaveLength(3);
    const p2 = (
      await asha.get(`/api/v1/tasks/${task.id}/comments?limit=3&cursor=${p1.nextCursor}`)
    ).json();
    expect(p2.items.map((c: { body: string }) => c.body)).toEqual(['c3', 'c4']);
    expect(p2.nextCursor).toBeNull();
  });

  it('client ids make comment creation idempotent', async () => {
    const { asha, task } = await setup();
    const id = '01933b6e-6a1c-7c4e-9a3f-aaaaaaaaaaaa';
    expect(
      (await asha.post(`/api/v1/tasks/${task.id}/comments`, { id, body: 'Once' })).statusCode,
    ).toBe(201);
    expect(
      (await asha.post(`/api/v1/tasks/${task.id}/comments`, { id, body: 'Once' })).statusCode,
    ).toBe(200);
    expect((await asha.get(`/api/v1/tasks/${task.id}/comments`)).json().items).toHaveLength(1);
  });

  it('a member who leaves loses access to the thread', async () => {
    const { ravi, g, task, ids } = await setup();
    await comment(ravi, task.id, 'Bye');
    await ravi.del(`/api/v1/groups/${g.id}/members/${ids.ravi}`);
    expect((await ravi.get(`/api/v1/tasks/${task.id}/comments`)).statusCode).toBe(404);
  });
});

describe('reports and owner review', () => {
  async function owner() {
    return signUpWithEmail(ctx, OWNER, 'App Owner');
  }

  it('the review page is invisible to everyone but owners', async () => {
    const { asha } = await setup();
    expect((await asha.get('/api/v1/admin/reports')).statusCode).toBe(404);
    expect((await asha.get('/api/v1/admin/me')).statusCode).toBe(404);
    const o = await owner();
    expect((await o.get('/api/v1/admin/me')).json()).toEqual({ owner: true });
  });

  it('report a comment → owner removes it → hidden as "removed", kept as evidence', async () => {
    const { asha, ravi, task, ids } = await setup();
    const c = await comment(ravi, task.id, 'Something nasty');
    expect(
      (
        await ravi.post('/api/v1/reports', {
          targetType: 'comment',
          targetId: c.id,
          reason: 'spam',
        })
      ).statusCode,
    ).toBe(403); // own content
    const rep = await asha.post('/api/v1/reports', {
      targetType: 'comment',
      targetId: c.id,
      reason: 'harassment',
      details: 'Not ok',
    });
    expect(rep.statusCode).toBe(201);
    // Reporting the same thing again doesn't add a second report.
    const again = await asha.post('/api/v1/reports', {
      targetType: 'comment',
      targetId: c.id,
      reason: 'harassment',
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(rep.json().id);

    // Ravi edits it afterwards; the snapshot keeps what was reported.
    await ravi.patch(`/api/v1/comments/${c.id}`, { body: 'Something nice' });

    const o = await owner();
    const list = (await o.get('/api/v1/admin/reports')).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      targetType: 'comment',
      reason: 'harassment',
      sameTargetOpen: 1,
    });
    const detail = (await o.get(`/api/v1/admin/reports/${rep.json().id}`)).json();
    expect(detail.snapshot.body).toBe('Something nasty');
    expect(detail.current.body).toBe('Something nice');
    expect(detail.owner).toEqual({ id: ids.ravi, name: 'Ravi Kumar', suspended: false });
    expect(detail.context.some((x: { text: string }) => x.text === 'Plan Diwali dinner')).toBe(
      true,
    );

    const resolved = await o.post(`/api/v1/admin/reports/${rep.json().id}/resolve`, {
      action: 'remove',
    });
    expect(resolved.json()).toMatchObject({ status: 'actioned', action: 'remove' });
    const thread = (await asha.get(`/api/v1/tasks/${task.id}/comments`)).json().items;
    expect(thread[0]).toMatchObject({ id: c.id, removed: true, body: null });
    expect(thread[0].permissions).toEqual({ edit: false, delete: false, report: false });
    expect((await ravi.patch(`/api/v1/comments/${c.id}`, { body: 'x' })).statusCode).toBe(403);
    const row = await ctx.deps.db.query.comments.findFirst({ where: eq(comments.id, c.id) });
    expect(row!.body).toBe('Something nice'); // kept for 180 days
    expect(row!.removedAt).toBeTruthy();
    const audit = await ctx.deps.db.query.auditLogs.findMany();
    expect(audit.some((a) => a.action === 'content_remove' && a.targetId === c.id)).toBe(true);
    // Closed reports can't be resolved twice.
    expect(
      (await o.post(`/api/v1/admin/reports/${rep.json().id}/resolve`, { action: 'dismiss' }))
        .statusCode,
    ).toBe(409);
  });

  it('removing a task hides it from the group', async () => {
    const { asha, ravi, task } = await setup();
    const rep = (
      await ravi.post('/api/v1/reports', { targetType: 'task', targetId: task.id, reason: 'spam' })
    ).json();
    const o = await owner();
    await o.post(`/api/v1/admin/reports/${rep.id}/resolve`, { action: 'remove' });
    expect((await ravi.get(`/api/v1/tasks/${task.id}`)).statusCode).toBe(404);
    expect((await asha.get(`/api/v1/tasks/${task.id}`)).statusCode).toBe(404);
    const row = await ctx.deps.db.query.tasks.findFirst({ where: eq(tasks.id, task.id) });
    expect(row!.removedAt).toBeTruthy();
  });

  it('dismissing closes every open report on the item', async () => {
    const { asha, task } = await setup();
    const meera = await signUpWithEmail(ctx, 'meera@example.com', 'Meera Iyer');
    const g2 = task.groupId as string;
    await joinByLink(asha, meera, g2);
    const ravi2Report = (
      await meera.post('/api/v1/reports', { targetType: 'group', targetId: g2, reason: 'other' })
    ).json();
    const ashaReport = (
      await asha.post('/api/v1/reports', { targetType: 'group', targetId: g2, reason: 'spam' })
    ).json();
    const o = await owner();
    expect((await o.get('/api/v1/admin/reports')).json().items[0].sameTargetOpen).toBe(2);
    await o.post(`/api/v1/admin/reports/${ravi2Report.id}/resolve`, { action: 'dismiss' });
    const rows = await ctx.deps.db.query.reports.findMany();
    expect(rows.map((r) => r.status).sort()).toEqual(['dismissed', 'dismissed']);
    expect(rows.find((r) => r.id === ashaReport.id)!.status).toBe('dismissed');
    expect((await o.get('/api/v1/admin/reports?status=dismissed')).json().items).toHaveLength(2);
  });

  it('you can only report people you share a group with, and things you can see', async () => {
    const { asha, task, ids } = await setup();
    const stranger = await signUpWithEmail(ctx, 'stranger@example.com', 'Stranger');
    for (const body of [
      { targetType: 'user', targetId: ids.asha, reason: 'spam' },
      { targetType: 'task', targetId: task.id, reason: 'spam' },
      { targetType: 'group', targetId: task.groupId, reason: 'spam' },
    ])
      expect((await stranger.post('/api/v1/reports', body)).statusCode, body.targetType).toBe(404);
    expect(
      (
        await asha.post('/api/v1/reports', {
          targetType: 'user',
          targetId: ids.asha,
          reason: 'spam',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await asha.post('/api/v1/reports', {
          targetType: 'user',
          targetId: ids.ravi,
          reason: 'nope',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('suspending a member: signed out everywhere, their content hidden; unsuspend restores', async () => {
    const { asha, ravi, task, ids } = await setup();
    const t2 = (
      await ravi.post('/api/v1/tasks', { title: 'Ravi task', groupId: task.groupId })
    ).json();
    await comment(ravi, task.id, 'Ravi comment');
    const rep = (
      await asha.post('/api/v1/reports', {
        targetType: 'user',
        targetId: ids.ravi,
        reason: 'impersonation',
        groupId: task.groupId,
      })
    ).json();
    const o = await owner();
    const detail = (await o.get(`/api/v1/admin/reports/${rep.id}`)).json();
    expect(detail.context[0].text).toBe('Ravi comment');
    await o.post(`/api/v1/admin/reports/${rep.id}/resolve`, {
      action: 'remove',
      note: 'Fake account',
    });

    expect(
      await ctx.deps.db.query.sessions.findMany({ where: eq(sessions.userId, ids.ravi) }),
    ).toEqual([]);
    expect((await ravi.get('/api/v1/tasks')).statusCode).toBe(401);
    expect((await asha.get(`/api/v1/tasks/${t2.id}`)).statusCode).toBe(404);
    expect((await asha.get(`/api/v1/tasks/${task.id}/comments`)).json().items).toEqual([]);
    const members = (await asha.get(`/api/v1/groups/${task.groupId}/members`)).json();
    expect(members.map((m: { id: string }) => m.id)).toEqual([ids.asha]);
    // Can't assign to a suspended user.
    expect(
      (
        await asha.post('/api/v1/tasks', {
          title: 'x',
          groupId: task.groupId,
          assigneeId: ids.ravi,
        })
      ).json().error.code,
    ).toBe('not_a_member');

    expect((await o.post(`/api/v1/admin/users/${ids.ravi}/unsuspend`)).statusCode).toBe(204);
    expect((await asha.get(`/api/v1/tasks/${t2.id}`)).statusCode).toBe(200);
    const audit = (await ctx.deps.db.query.auditLogs.findMany()).map((a) => a.action);
    expect(audit).toEqual(
      expect.arrayContaining(['user_suspend', 'user_unsuspend', 'report_create']),
    );
  });

  it('owners cannot suspend themselves', async () => {
    const o = await owner();
    const res = await o.post(`/api/v1/admin/users/${await meId(o)}/suspend`, { reason: 'test' });
    expect(res.statusCode).toBe(403);
  });

  it('daily report limit', async () => {
    const { asha, task } = await setup();
    await ctx.deps.redis.set(
      `daily:reports:${await meId(asha)}:${new Date().toISOString().slice(0, 10)}`,
      20,
    );
    const res = await asha.post('/api/v1/reports', {
      targetType: 'group',
      targetId: task.groupId,
      reason: 'spam',
    });
    expect(res.json().error.code).toBe('daily_limit');
  });
});

describe('retention and account deletion', () => {
  it('deleting an account hands the group to another member and hides their comments', async () => {
    const { asha, ravi, g, task, ids } = await setup();
    await comment(asha, task.id, 'From Asha');
    const solo = await createGroup(asha, 'Just me');
    const del = await asha.del('/api/v1/me', {
      password: 'mango-river-lamp-91',
      confirm: 'DELETE',
    });
    expect(del.statusCode, del.body).toBe(204);
    const group = (await ravi.get(`/api/v1/groups/${g.id}`)).json();
    expect(group).toMatchObject({ role: 'admin', memberCount: 1 });
    expect((await ravi.get(`/api/v1/tasks/${task.id}`)).json().createdBy).toBeNull();
    expect((await ravi.get(`/api/v1/tasks/${task.id}/comments`)).json().items).toEqual([]);
    const soloRow = await ctx.deps.db.query.groups.findFirst({
      where: (t, { eq: e }) => e(t.id, solo.id),
    });
    expect(soloRow!.deletedAt).toBeTruthy();
    expect(ids.asha).toBeTruthy();
  });

  it('the daily job purges groups and comments past 180 days', async () => {
    const { asha, g, task } = await setup();
    const c = await comment(asha, task.id, 'Old');
    await asha.del(`/api/v1/comments/${c.id}`);
    await asha.del(`/api/v1/groups/${g.id}`);
    const later = new Date(Date.now() + 181 * 864e5);
    const result = await runMaintenance(ctx.deps.db, ctx.deps.storage, later);
    expect(result.purgedGroups).toBe(1);
    expect(
      await ctx.deps.db.query.comments.findFirst({ where: eq(comments.id, c.id) }),
    ).toBeUndefined();
    expect(
      await ctx.deps.db.query.tasks.findFirst({ where: eq(tasks.id, task.id) }),
    ).toBeUndefined();
    expect(await ctx.deps.db.query.reports.findMany({ where: eq(reports.groupId, g.id) })).toEqual(
      [],
    );
  });
});
