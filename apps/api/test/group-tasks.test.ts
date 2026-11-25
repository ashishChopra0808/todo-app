import { describe, expect, it } from 'vitest';
import {
  createGroup,
  joinByLink,
  meId,
  signUpWithEmail,
  signUpWithPhone,
  useApp,
  type Client,
} from './helpers';

const ctx = useApp();

async function family() {
  const asha = await signUpWithEmail(ctx);
  const ravi = await signUpWithPhone(ctx);
  const meera = await signUpWithEmail(ctx, 'meera@example.com', 'Meera Iyer');
  const g = await createGroup(asha);
  await joinByLink(asha, ravi, g.id);
  await joinByLink(asha, meera, g.id);
  return {
    asha,
    ravi,
    meera,
    g,
    ids: { asha: await meId(asha), ravi: await meId(ravi), meera: await meId(meera) },
  };
}

async function create(c: Client, body: Record<string, unknown>) {
  const res = await c.post('/api/v1/tasks', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

const titles = async (c: Client, q: string) =>
  (await c.get(`/api/v1/tasks?${q}`))
    .json()
    .items.map((t: { title: string }) => t.title)
    .sort();

describe('group tasks', () => {
  it('any member creates and assigns to a member; everyone in the group sees it', async () => {
    const { asha, ravi, meera, g, ids } = await family();
    const t = await create(ravi, { title: 'Buy milk', groupId: g.id, assigneeId: ids.meera });
    expect(t).toMatchObject({
      groupId: g.id,
      group: { id: g.id, name: 'Sharma family', icon: '🏠' },
      assignee: { id: ids.meera, name: 'Meera Iyer', avatarUrl: null },
      commentCount: 0,
    });
    expect(t.permissions).toMatchObject({ edit: true, assign: true, move: true });
    for (const c of [asha, meera])
      expect((await c.get(`/api/v1/tasks/${t.id}`)).statusCode).toBe(200);

    const activity = (await asha.get(`/api/v1/tasks/${t.id}/activity`)).json();
    expect(activity.map((a: { type: string }) => a.type)).toEqual(['created', 'assigned']);
    expect(activity[1].to).toEqual({ id: ids.meera, name: 'Meera Iyer' });
  });

  it('outsiders get 404 on group tasks, their activity and comments', async () => {
    const { ravi, g } = await family();
    const t = await create(ravi, { title: 'Pay rent', groupId: g.id });
    const stranger = await signUpWithEmail(ctx, 'stranger@example.com', 'Stranger');
    for (const url of [
      `/api/v1/tasks/${t.id}`,
      `/api/v1/tasks/${t.id}/activity`,
      `/api/v1/tasks/${t.id}/comments`,
    ])
      expect((await stranger.get(url)).statusCode, url).toBe(404);
    expect(
      (await stranger.patch(`/api/v1/tasks/${t.id}`, { version: 1, status: 'done' })).statusCode,
    ).toBe(404);
    expect((await stranger.post(`/api/v1/tasks/${t.id}/comments`, { body: 'hi' })).statusCode).toBe(
      404,
    );
    expect(await titles(stranger, 'view=all')).toEqual([]);
    // Can't create in, or assign into, a group they're not in.
    expect((await stranger.post('/api/v1/tasks', { title: 'x', groupId: g.id })).statusCode).toBe(
      404,
    );
  });

  it('the assignee must be a member; personal tasks stay with their creator', async () => {
    const { asha, g } = await family();
    const stranger = await signUpWithEmail(ctx, 'stranger@example.com', 'Stranger');
    const strangerId = await meId(stranger);
    const bad = await asha.post('/api/v1/tasks', {
      title: 'x',
      groupId: g.id,
      assigneeId: strangerId,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('not_a_member');
    const personal = await asha.post('/api/v1/tasks', { title: 'x', assigneeId: strangerId });
    expect(personal.json().error.fields.assigneeId).toBe('invalid');
  });

  it('creator and admins edit; the assignee only changes status; others only comment', async () => {
    const { asha, ravi, meera, g, ids } = await family();
    const t = await create(ravi, { title: 'Fix tap', groupId: g.id, assigneeId: ids.meera });
    // Meera (assignee) can mark it done but not rename or reassign it.
    const asMeera = (await meera.get(`/api/v1/tasks/${t.id}`)).json();
    expect(asMeera.permissions).toMatchObject({
      edit: false,
      changeStatus: true,
      assign: false,
      comment: true,
    });
    expect(
      (await meera.patch(`/api/v1/tasks/${t.id}`, { version: 1, title: 'No' })).statusCode,
    ).toBe(403);
    expect(
      (await meera.patch(`/api/v1/tasks/${t.id}`, { version: 1, assigneeId: null })).statusCode,
    ).toBe(403);
    const done = await meera.patch(`/api/v1/tasks/${t.id}`, { version: 1, status: 'done' });
    expect(done.json()).toMatchObject({ status: 'done', version: 2 });
    // Asha (admin, not creator) can edit and delete.
    expect(
      (await asha.patch(`/api/v1/tasks/${t.id}`, { version: 2, title: 'Fix kitchen tap' }))
        .statusCode,
    ).toBe(200);
    // Ravi re-assigns to Asha.
    const re = await ravi.patch(`/api/v1/tasks/${t.id}`, { version: 3, assigneeId: ids.asha });
    expect(re.json().assignee.id).toBe(ids.asha);
    const types = (await ravi.get(`/api/v1/tasks/${t.id}/activity`))
      .json()
      .map((a: { type: string }) => a.type);
    expect(types).toEqual(['created', 'assigned', 'status_changed', 'title_changed', 'assigned']);
    // Meera can't delete; Asha (admin) can.
    expect((await meera.del(`/api/v1/tasks/${t.id}`)).statusCode).toBe(403);
    expect((await asha.del(`/api/v1/tasks/${t.id}`)).statusCode).toBe(204);
    expect((await meera.get(`/api/v1/tasks/${t.id}`)).statusCode).toBe(404);
  });

  it('a group task nobody is assigned to can be ticked off by any member', async () => {
    const { ravi, meera, g } = await family();
    const t = await create(ravi, { title: 'Buy milk', groupId: g.id });
    const asMeera = (await meera.get(`/api/v1/tasks/${t.id}`)).json();
    expect(asMeera.permissions).toMatchObject({ edit: false, changeStatus: true });
    expect(
      (await meera.patch(`/api/v1/tasks/${t.id}`, { version: 1, title: 'Buy bread' })).statusCode,
    ).toBe(403);
    const done = await meera.patch(`/api/v1/tasks/${t.id}`, { version: 1, status: 'done' });
    expect(done.json()).toMatchObject({ status: 'done', version: 2 });
    const activity = (await ravi.get(`/api/v1/tasks/${t.id}/activity`)).json();
    expect(activity.at(-1)).toMatchObject({ type: 'status_changed' });
    expect(JSON.stringify(activity.at(-1))).toContain('Meera');
  });

  it('views and filters: mine, all, assigned by me, per group, assignee', async () => {
    const { asha, ravi, g, ids } = await family();
    await create(asha, { title: 'Personal' });
    await create(asha, { title: 'For Ravi', groupId: g.id, assigneeId: ids.ravi });
    await create(asha, { title: 'For me', groupId: g.id, assigneeId: ids.asha });
    await create(asha, { title: 'Unassigned', groupId: g.id });
    await create(ravi, { title: 'Ravi for Asha', groupId: g.id, assigneeId: ids.asha });

    expect(await titles(asha, 'view=mine')).toEqual(['For me', 'Personal', 'Ravi for Asha']);
    expect(await titles(asha, 'view=assigned_by_me')).toEqual(['For Ravi']);
    expect(await titles(asha, 'view=all')).toEqual([
      'For Ravi',
      'For me',
      'Personal',
      'Ravi for Asha',
      'Unassigned',
    ]);
    expect(await titles(asha, `view=all&group=${g.id}`)).toHaveLength(4);
    expect(await titles(asha, 'view=all&group=personal')).toEqual(['Personal']);
    expect(await titles(asha, `view=all&group=${g.id}&assignee=none`)).toEqual(['Unassigned']);
    expect(await titles(asha, `view=all&group=${g.id}&assignee=me`)).toEqual([
      'For me',
      'Ravi for Asha',
    ]);
    expect(await titles(asha, `view=all&assignee=${ids.ravi}`)).toEqual(['For Ravi']);
    // Ravi doesn't see Asha's personal task.
    expect(await titles(ravi, 'view=all')).not.toContain('Personal');
    // Counts are about my own tasks.
    expect((await asha.get('/api/v1/tasks/counts')).json().open).toBe(3);
    expect((await asha.get('/api/v1/tasks?assignee=nobody')).statusCode).toBe(400);
  });

  it('moving tasks: personal → group → personal, creator only', async () => {
    const { asha, ravi, g, ids } = await family();
    const other = await createGroup(asha, 'Office', '💼');
    const t = await create(ravi, { title: 'Book tickets' });
    // Ravi isn't in "Office": looks like it doesn't exist.
    expect(
      (await ravi.patch(`/api/v1/tasks/${t.id}`, { version: 1, groupId: other.id })).statusCode,
    ).toBe(404);
    const moved = await ravi.patch(`/api/v1/tasks/${t.id}`, { version: 1, groupId: g.id });
    expect(moved.json()).toMatchObject({ groupId: g.id, assignee: { id: ids.ravi } });
    // Now Asha sees it, but only the creator can move it.
    expect(
      (await asha.patch(`/api/v1/tasks/${t.id}`, { version: 2, groupId: null })).statusCode,
    ).toBe(403);
    // Assign to Asha, then move back to Personal: it returns to Ravi and Asha loses access.
    await ravi.patch(`/api/v1/tasks/${t.id}`, { version: 2, assigneeId: ids.asha });
    const back = await ravi.patch(`/api/v1/tasks/${t.id}`, { version: 3, groupId: null });
    expect(back.json()).toMatchObject({ groupId: null, group: null, assignee: { id: ids.ravi } });
    expect((await asha.get(`/api/v1/tasks/${t.id}`)).statusCode).toBe(404);
    const moves = (await ravi.get(`/api/v1/tasks/${t.id}/activity`))
      .json()
      .filter((a: { type: string }) => a.type === 'moved');
    expect(moves.map((m: { from: unknown; to: unknown }) => [m.from, m.to])).toEqual([
      [null, { id: g.id, name: 'Sharma family', icon: '🏠' }],
      [{ id: g.id, name: 'Sharma family', icon: '🏠' }, null],
    ]);
  });

  it('moving between groups unassigns someone who is not in the new group', async () => {
    const { asha, ravi, g, ids } = await family();
    const office = await createGroup(asha, 'Office');
    const t = await create(asha, { title: 'Plan', groupId: g.id, assigneeId: ids.ravi });
    const moved = await asha.patch(`/api/v1/tasks/${t.id}`, { version: 1, groupId: office.id });
    expect(moved.json()).toMatchObject({ groupId: office.id, assignee: null });
    expect((await ravi.get(`/api/v1/tasks/${t.id}`)).statusCode).toBe(404);
  });

  it('removing a member unassigns their open tasks (done ones keep the name)', async () => {
    const { asha, ravi, g, ids } = await family();
    const open = await create(asha, { title: 'Open one', groupId: g.id, assigneeId: ids.ravi });
    const done = await create(asha, {
      title: 'Done one',
      groupId: g.id,
      assigneeId: ids.ravi,
      status: 'done',
    });
    const personal = await create(ravi, { title: 'Ravi personal' });
    const res = await asha.del(`/api/v1/groups/${g.id}/members/${ids.ravi}`);
    expect(res.json()).toEqual({ unassignedTasks: 1 });
    expect((await asha.get(`/api/v1/tasks/${open.id}`)).json().assignee).toBeNull();
    expect((await asha.get(`/api/v1/tasks/${done.id}`)).json().assignee.id).toBe(ids.ravi);
    expect((await ravi.get(`/api/v1/tasks/${personal.id}`)).statusCode).toBe(200);
    expect((await ravi.get(`/api/v1/tasks/${open.id}`)).statusCode).toBe(404);
    const last = (await asha.get(`/api/v1/tasks/${open.id}/activity`)).json().at(-1);
    expect(last).toMatchObject({ type: 'unassigned', from: { id: ids.ravi } });
  });

  it('deleting a group hides its tasks from everyone', async () => {
    const { asha, ravi, g } = await family();
    const t = await create(ravi, { title: 'Group job', groupId: g.id });
    await asha.del(`/api/v1/groups/${g.id}`);
    expect((await ravi.get(`/api/v1/tasks/${t.id}`)).statusCode).toBe(404);
    expect(await titles(ravi, 'view=all')).toEqual([]);
  });

  it('assigning to someone who later left is refused', async () => {
    const { asha, ravi, g, ids } = await family();
    await ravi.del(`/api/v1/groups/${g.id}/members/${ids.ravi}`);
    const res = await asha.post('/api/v1/tasks', {
      title: 'x',
      groupId: g.id,
      assigneeId: ids.ravi,
    });
    expect(res.json().error.code).toBe('not_a_member');
  });

  it('daily task limit', async () => {
    const asha = await signUpWithEmail(ctx);
    await ctx.deps.redis.set(
      `daily:tasks:${await meId(asha)}:${new Date().toISOString().slice(0, 10)}`,
      200,
    );
    const res = await asha.post('/api/v1/tasks', { title: 'One too many' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('daily_limit');
  });
});
