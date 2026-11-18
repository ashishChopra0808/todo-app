import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { tasks } from '../src/db/schema';
import { client, signUpWithEmail, signUpWithPhone, useApp, type Client } from './helpers';

const ctx = useApp();

async function create(c: Client, body: Record<string, unknown>) {
  const res = await c.post('/api/v1/tasks', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

describe('tasks', () => {
  it('creates a personal task with defaults and records activity', async () => {
    const c = await signUpWithEmail(ctx);
    const t = await create(c, { title: '  Pay  electricity bill ', description: 'Before Friday' });
    expect(t).toMatchObject({
      title: 'Pay electricity bill',
      priority: 'medium',
      status: 'todo',
      groupId: null,
      version: 1,
    });
    expect(t.assignee.id).toBe(t.createdBy.id);
    expect(t.permissions).toEqual({ edit: true, delete: true, changeStatus: true });
    const activity = (await c.get(`/api/v1/tasks/${t.id}/activity`)).json();
    expect(activity.map((a: { type: string }) => a.type)).toEqual(['created']);
  });

  it('client-generated ids make create idempotent', async () => {
    const c = await signUpWithEmail(ctx);
    const id = '01933b6e-6a1c-7c4e-9a3f-1234567890ab';
    expect((await c.post('/api/v1/tasks', { id, title: 'Offline task' })).statusCode).toBe(201);
    const again = await c.post('/api/v1/tasks', { id, title: 'Offline task' });
    expect(again.statusCode).toBe(200);
    expect((await c.get('/api/v1/tasks?view=mine')).json().items).toHaveLength(1);
  });

  it('marks done and undo, bumping the version and logging status changes', async () => {
    const c = await signUpWithEmail(ctx);
    const t = await create(c, { title: 'Water plants' });
    const done = (await c.patch(`/api/v1/tasks/${t.id}`, { version: 1, status: 'done' })).json();
    expect(done).toMatchObject({ status: 'done', version: 2 });
    expect(done.completedAt).toBeTruthy();
    const undone = (await c.patch(`/api/v1/tasks/${t.id}`, { version: 2, status: 'todo' })).json();
    expect(undone).toMatchObject({ status: 'todo', version: 3, completedAt: null });
    const types = (await c.get(`/api/v1/tasks/${t.id}/activity`))
      .json()
      .map((a: { type: string }) => a.type);
    expect(types).toEqual(['created', 'status_changed', 'status_changed']);
  });

  it('returns 409 with the latest task when the version is stale', async () => {
    const c = await signUpWithEmail(ctx);
    const t = await create(c, { title: 'Call plumber' });
    await c.patch(`/api/v1/tasks/${t.id}`, { version: 1, title: 'Call plumber today' });
    const stale = await c.patch(`/api/v1/tasks/${t.id}`, { version: 1, priority: 'high' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.details.title).toBe('Call plumber today');
  });

  it('views: today, overdue, mine and completed follow the user time zone', async () => {
    const c = await signUpWithEmail(ctx);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
      new Date(Date.now() - 86400000),
    );
    await create(c, { title: 'Due today', dueAt: `${today}T00:00:00.000Z`, dueHasTime: false });
    await create(c, {
      title: 'Overdue',
      dueAt: `${yesterday}T00:00:00.000Z`,
      dueHasTime: false,
      priority: 'high',
    });
    await create(c, { title: 'No date' });
    const finished = await create(c, { title: 'Finished', status: 'done' });

    const titles = async (q: string) =>
      (await c.get(`/api/v1/tasks?${q}`)).json().items.map((t: { title: string }) => t.title);
    expect((await titles('view=today')).sort()).toEqual(['Due today', 'Overdue']);
    expect(await titles('view=overdue')).toEqual(['Overdue']);
    expect((await titles('view=mine')).sort()).toEqual(['Due today', 'No date', 'Overdue']);
    expect(await titles('view=completed')).toEqual(['Finished']);
    expect(finished.status).toBe('done');
    expect((await c.get('/api/v1/tasks/counts')).json()).toEqual({ today: 1, overdue: 1, open: 3 });
  });

  it('searches title and description (Hindi too) and filters by status and priority', async () => {
    const c = await signUpWithEmail(ctx);
    await create(c, { title: 'दूध लाना', description: 'Mother dairy' });
    await create(c, { title: 'Book train tickets', priority: 'high' });
    await create(c, { title: '100% done_ish', priority: 'low' });
    const q = async (s: string) =>
      (await c.get(`/api/v1/tasks?view=mine&${s}`))
        .json()
        .items.map((t: { title: string }) => t.title);
    expect(await q(`q=${encodeURIComponent('दूध')}`)).toEqual(['दूध लाना']);
    expect(await q('q=dairy')).toEqual(['दूध लाना']);
    expect(await q('q=%25')).toEqual(['100% done_ish']);
    expect(await q('priority=high')).toEqual(['Book train tickets']);
  });

  it('paginates with a cursor', async () => {
    const c = await signUpWithEmail(ctx);
    for (let i = 0; i < 5; i++) await create(c, { title: `Task ${i}` });
    const page1 = (await c.get('/api/v1/tasks?view=mine&limit=2')).json();
    expect(page1.items).toHaveLength(2);
    const page2 = (
      await c.get(`/api/v1/tasks?view=mine&limit=2&cursor=${page1.nextCursor}`)
    ).json();
    const page3 = (
      await c.get(`/api/v1/tasks?view=mine&limit=2&cursor=${page2.nextCursor}`)
    ).json();
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();
    const all = [...page1.items, ...page2.items, ...page3.items].map((t: { id: string }) => t.id);
    expect(new Set(all).size).toBe(5);
  });

  it('delete hides the task at once but keeps it for 180 days', async () => {
    const c = await signUpWithEmail(ctx);
    const t = await create(c, { title: 'Secret plan' });
    expect((await c.del(`/api/v1/tasks/${t.id}`)).statusCode).toBe(204);
    expect((await c.get(`/api/v1/tasks/${t.id}`)).statusCode).toBe(404);
    expect((await c.get('/api/v1/tasks?view=mine')).json().items).toHaveLength(0);
    const row = await ctx.deps.db.query.tasks.findFirst({ where: eq(tasks.id, t.id) });
    expect(row?.deletedAt).toBeTruthy();
    const days = (row!.purgeAfter!.getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(179);
    expect(days).toBeLessThan(181);
  });

  it('rejects invalid input with field errors and unknown fields', async () => {
    const c = await signUpWithEmail(ctx);
    const bad = await c.post('/api/v1/tasks', { title: '', priority: 'urgent' });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().error.fields).sort()).toEqual(['priority', 'title']);
    expect((await c.post('/api/v1/tasks', { title: 'x', createdBy: 'someone' })).statusCode).toBe(
      400,
    );
    expect((await c.get('/api/v1/tasks/not-a-uuid')).statusCode).toBe(400);
  });
});

describe("authorisation: a user can never see or change another user's tasks", () => {
  it('blocks read, update, delete and activity with 404', async () => {
    const asha = await signUpWithEmail(ctx);
    const ravi = await signUpWithPhone(ctx);
    const t = await create(asha, { title: 'Asha private' });
    expect((await ravi.get(`/api/v1/tasks/${t.id}`)).statusCode).toBe(404);
    expect(
      (await ravi.patch(`/api/v1/tasks/${t.id}`, { version: 1, status: 'done' })).statusCode,
    ).toBe(404);
    expect((await ravi.del(`/api/v1/tasks/${t.id}`)).statusCode).toBe(404);
    expect((await ravi.get(`/api/v1/tasks/${t.id}/activity`)).statusCode).toBe(404);
    expect((await ravi.get('/api/v1/tasks?view=mine')).json().items).toHaveLength(0);
    expect((await ravi.post('/api/v1/tasks', { id: t.id, title: 'hijack' })).statusCode).toBe(409);
    expect((await asha.get(`/api/v1/tasks/${t.id}`)).json().status).toBe('todo');
  });

  it('requires a session', async () => {
    const anon = client(ctx);
    expect((await anon.get('/api/v1/tasks')).statusCode).toBe(401);
    expect((await anon.post('/api/v1/tasks', { title: 'x' })).statusCode).toBe(401);
  });
});
