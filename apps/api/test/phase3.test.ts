import { eq } from 'drizzle-orm';
import webpush from 'web-push';
import { describe, expect, it } from 'vitest';
import { files, pushSubscriptions, tasks } from '../src/db/schema';
import { runMaintenance } from '../src/jobs/maintenance';
import { runReminders } from '../src/jobs/reminders';
import {
  createGroup,
  joinByLink,
  latestMessage,
  meId,
  signUpWithEmail,
  signUpWithPhone,
  useApp,
  type Client,
} from './helpers';

const vapid = webpush.generateVAPIDKeys();
const ctx = useApp({
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  PUSH_EXTRA_HOSTS: 'push.example.test',
});

/** A tiny "recording": the right first bytes are all the server checks for the type. */
const webm = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 7)]);
const mp4 = () =>
  Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(2000, 1)]);

function form(fields: Record<string, string>, file: Buffer, type = 'audio/webm') {
  const b = '----todotest';
  const parts = Object.entries(fields).map(([k, v]) =>
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
  );
  return {
    body: Buffer.concat([
      ...parts,
      Buffer.from(
        `--${b}\r\nContent-Disposition: form-data; name="file"; filename="rec"\r\nContent-Type: ${type}\r\n\r\n`,
      ),
      file,
      Buffer.from(`\r\n--${b}--\r\n`),
    ]),
    contentType: `multipart/form-data; boundary=${b}`,
  };
}

async function upload(
  c: Client,
  kind: 'task_audio' | 'comment_audio',
  buf = webm(),
  durationMs = '4200',
) {
  const { body, contentType } = form({ kind, durationMs }, buf);
  return c.post('/api/v1/files', body, { 'content-type': contentType });
}

async function pair() {
  const asha = await signUpWithEmail(ctx);
  const ravi = await signUpWithPhone(ctx);
  const g = await createGroup(asha);
  await joinByLink(asha, ravi, g.id);
  return { asha, ravi, g, ids: { asha: await meId(asha), ravi: await meId(ravi) } };
}

describe('voice', () => {
  it('uploads a recording, checks its real type, and makes a voice task with a player URL', async () => {
    const asha = await signUpWithEmail(ctx);
    const up = await upload(asha, 'task_audio');
    expect(up.statusCode, up.body).toBe(201);
    expect(up.json()).toMatchObject({
      kind: 'task_audio',
      mimeType: 'audio/webm',
      durationMs: 4200,
    });
    const t = await asha.post('/api/v1/tasks', { title: 'Voice task', audioFileId: up.json().id });
    expect(t.statusCode).toBe(201);
    expect(t.json()).toMatchObject({
      source: 'voice',
      audio: { id: up.json().id, mimeType: 'audio/webm' },
    });
    const audio = await asha.get(t.json().audio.url.replace(/^https?:\/\/[^/]+/, ''));
    expect(audio.statusCode).toBe(200);

    // Safari/iPhone records MP4.
    expect((await upload(asha, 'task_audio', mp4())).json().mimeType).toBe('audio/mp4');
  });

  it('refuses files that are not recordings, too long, or someone else’s', async () => {
    const asha = await signUpWithEmail(ctx);
    const fake = await upload(asha, 'task_audio', Buffer.from('<html>not audio at all</html>'));
    expect(fake.statusCode).toBe(415);
    expect((await upload(asha, 'task_audio', webm(), '200000')).statusCode).toBe(400);
    const ravi = await signUpWithPhone(ctx);
    const mine = (await upload(ravi, 'task_audio')).json();
    const steal = await asha.post('/api/v1/tasks', { title: 'x', audioFileId: mine.id });
    expect(steal.json().error.fields.audioFileId).toBe('invalid');
    // Comment recordings can't be used as task recordings.
    const c = (await upload(asha, 'comment_audio')).json();
    expect((await asha.post('/api/v1/tasks', { title: 'x', audioFileId: c.id })).statusCode).toBe(
      400,
    );
  });

  it('voice replies: a comment with audio only, playable by group members, hidden with the comment', async () => {
    const { asha, ravi, g } = await pair();
    const task = (
      await asha.post('/api/v1/tasks', { title: 'Call plumber', groupId: g.id })
    ).json();
    const rec = (await upload(ravi, 'comment_audio')).json();
    const c = await ravi.post(`/api/v1/tasks/${task.id}/comments`, { audioFileId: rec.id });
    expect(c.statusCode, c.body).toBe(201);
    expect(c.json()).toMatchObject({ body: null, audio: { id: rec.id } });
    const seen = (await asha.get(`/api/v1/tasks/${task.id}/comments`)).json().items[0];
    expect(seen.audio.url).toBeTruthy();
    expect((await ravi.post(`/api/v1/tasks/${task.id}/comments`, {})).statusCode).toBe(400);
    await ravi.del(`/api/v1/comments/${c.json().id}`);
    const row = await ctx.deps.db.query.files.findFirst({ where: eq(files.id, rec.id) });
    expect(row!.deletedAt).toBeTruthy();
  });

  it('"download my data" includes the person\'s recordings with download links', async () => {
    const { asha, ravi, g } = await pair();
    const a1 = (await upload(asha, 'task_audio')).json();
    const t = (
      await asha.post('/api/v1/tasks', { title: 'Voice task', audioFileId: a1.id, groupId: g.id })
    ).json();
    const a2 = (await upload(ravi, 'comment_audio')).json();
    await ravi.post(`/api/v1/tasks/${t.id}/comments`, {
      id: crypto.randomUUID(),
      audioFileId: a2.id,
    });
    await upload(asha, 'task_audio'); // never attached: not exported
    const mine = (await asha.get('/api/v1/me/export')).json();
    expect(mine.voiceRecordings).toHaveLength(1);
    expect(mine.voiceRecordings[0]).toMatchObject({
      id: a1.id,
      kind: 'voice_task',
      taskId: t.id,
      durationSeconds: 4,
      type: 'audio/webm',
    });
    expect(mine.voiceRecordings[0].downloadUrl).toMatch(/^https?:\/\//);
    const audio = await asha.get(
      new URL(mine.voiceRecordings[0].downloadUrl).pathname +
        new URL(mine.voiceRecordings[0].downloadUrl).search,
    );
    expect(audio.statusCode).toBe(200);
    const theirs = (await ravi.get('/api/v1/me/export')).json();
    expect(theirs.voiceRecordings).toHaveLength(1);
    expect(theirs.voiceRecordings[0]).toMatchObject({
      id: a2.id,
      kind: 'voice_reply',
      taskId: t.id,
    });
  });

  it('unattached recordings are cleaned up after a day', async () => {
    const asha = await signUpWithEmail(ctx);
    const rec = (await upload(asha, 'task_audio')).json();
    const kept = (await upload(asha, 'task_audio')).json();
    await asha.post('/api/v1/tasks', { title: 'Keep', audioFileId: kept.id });
    await runMaintenance(ctx.deps.db, ctx.deps.storage, new Date(Date.now() + 2 * 864e5));
    await runMaintenance(ctx.deps.db, ctx.deps.storage, new Date(Date.now() + 3 * 864e5));
    expect(
      await ctx.deps.db.query.files.findFirst({ where: eq(files.id, rec.id) }),
    ).toBeUndefined();
    expect(await ctx.deps.db.query.files.findFirst({ where: eq(files.id, kept.id) })).toBeTruthy();
  });
});

describe('notifications', () => {
  it('assigning, commenting and status changes notify the other person, never the actor', async () => {
    const { asha, ravi, g, ids } = await pair();
    const t = (
      await asha.post('/api/v1/tasks', { title: 'Buy milk', groupId: g.id, assigneeId: ids.ravi })
    ).json();
    let inbox = (await ravi.get('/api/v1/notifications')).json();
    expect(inbox.unreadCount).toBe(1);
    expect(inbox.items[0]).toMatchObject({
      type: 'task_assigned',
      task: { id: t.id, title: 'Buy milk' },
      actor: { id: ids.asha, name: 'Asha Verma' },
      readAt: null,
    });
    expect((await asha.get('/api/v1/notifications')).json().items).toEqual([]);

    await ravi.post(`/api/v1/tasks/${t.id}/comments`, { body: 'On it' });
    await ravi.patch(`/api/v1/tasks/${t.id}`, { version: 1, status: 'done' });
    const ashaInbox = (await asha.get('/api/v1/notifications')).json();
    expect(ashaInbox.items.map((n: { type: string }) => n.type)).toEqual([
      'status_changed',
      'comment_added',
    ]);
    expect(ashaInbox.items[0].data).toEqual({ status: 'done' });
    expect(ashaInbox.items[1].data).toEqual({ excerpt: 'On it' });

    // Email went to Asha (a real, verified address), in her language.
    await ctx.deps.notifications.flush();
    const mail = await latestMessage(ctx, 'asha@example.com');
    expect(mail.subject).toBe('Ravi Kumar marked a task Done');
    expect(mail.text).toContain(`/tasks/${t.id}`);

    // Opening the task marks its notifications read.
    await ravi.get(`/api/v1/tasks/${t.id}`);
    inbox = (await ravi.get('/api/v1/notifications')).json();
    expect(inbox.unreadCount).toBe(0);
  });

  it('personal tasks never notify anyone', async () => {
    const asha = await signUpWithEmail(ctx);
    const t = (await asha.post('/api/v1/tasks', { title: 'Mine' })).json();
    await asha.patch(`/api/v1/tasks/${t.id}`, { version: 1, status: 'done' });
    expect((await asha.get('/api/v1/notifications')).json().unreadCount).toBe(0);
  });

  it('preferences switch each type and channel off; read and read-all work', async () => {
    const { asha, ravi, g, ids } = await pair();
    const prefs = (await ravi.get('/api/v1/me/notification-preferences')).json();
    expect(prefs.preferences).toHaveLength(15);
    expect(prefs.preferences.every((p: { enabled: boolean }) => p.enabled)).toBe(true);
    expect(prefs).toMatchObject({ pushAvailable: true, emailAvailable: false }); // phone-only
    const off = await ravi.put('/api/v1/me/notification-preferences', {
      preferences: [{ type: 'task_assigned', channel: 'in_app', enabled: false }],
    });
    expect(
      off
        .json()
        .preferences.find(
          (p: { type: string; channel: string }) =>
            p.type === 'task_assigned' && p.channel === 'in_app',
        ).enabled,
    ).toBe(false);
    await asha.post('/api/v1/tasks', { title: 'Quiet', groupId: g.id, assigneeId: ids.ravi });
    expect((await ravi.get('/api/v1/notifications')).json().items).toEqual([]);

    const t = (await ravi.post('/api/v1/tasks', { title: 'Loud', groupId: g.id })).json();
    await asha.post(`/api/v1/tasks/${t.id}/comments`, { body: 'a' });
    await asha.post(`/api/v1/tasks/${t.id}/comments`, { body: 'b' });
    const list = (await ravi.get('/api/v1/notifications')).json();
    expect(list.unreadCount).toBe(2);
    expect((await ravi.post(`/api/v1/notifications/${list.items[0].id}/read`)).statusCode).toBe(
      204,
    );
    expect((await asha.post(`/api/v1/notifications/${list.items[1].id}/read`)).statusCode).toBe(
      404,
    );
    await ravi.post('/api/v1/notifications/read-all');
    expect((await ravi.get('/api/v1/notifications/unread-count')).json()).toEqual({ count: 0 });
  });

  it("only accepts the browsers' own push services as endpoints", async () => {
    const asha = await signUpWithEmail(ctx);
    const keys = { p256dh: 'BPk'.padEnd(80, 'x'), auth: 'auth-secret-1' };
    for (const endpoint of [
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x',
      'https://fcm.googleapis.com.evil.test/x',
      'https://evil.test/fcm.googleapis.com',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://push.apple.com/x',
    ]) {
      const res = await asha.post('/api/v1/push-subscriptions', { endpoint, keys });
      expect(res.statusCode, endpoint).toBe(400);
    }
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://wns2-pn1p.notify.windows.com/w/?token=abc',
    ]) {
      const res = await asha.post('/api/v1/push-subscriptions', { endpoint, keys });
      expect(res.statusCode, endpoint).toBe(204);
    }
  });

  it('stores push subscriptions per browser and moves them on sign-in by someone else', async () => {
    const asha = await signUpWithEmail(ctx);
    expect((await asha.get('/api/v1/push/vapid-key')).json().key).toBe(vapid.publicKey);
    const sub = {
      endpoint: 'https://push.example.test/abc',
      keys: {
        p256dh:
          'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
        auth: 'tBHItJI5svbpez7KI4CCXg',
      },
    };
    expect((await asha.post('/api/v1/push-subscriptions', sub)).statusCode).toBe(204);
    const ravi = await signUpWithPhone(ctx);
    await ravi.post('/api/v1/push-subscriptions', sub);
    const rows = await ctx.deps.db.query.pushSubscriptions.findMany({
      where: eq(pushSubscriptions.endpoint, sub.endpoint),
    });
    expect(rows.map((r) => r.userId)).toEqual([await meId(ravi)]);
    expect(
      (
        await asha.post('/api/v1/push-subscriptions', {
          ...sub,
          endpoint: 'http://insecure.test/x',
        })
      ).statusCode,
    ).toBe(400);
    await ravi.del('/api/v1/push-subscriptions', { endpoint: sub.endpoint });
    expect(await ctx.deps.db.query.pushSubscriptions.findMany()).toEqual([]);
  });

  it('reminders: due soon once, overdue once, reset when the due date moves', async () => {
    const asha = await signUpWithEmail(ctx);
    const inHalfHour = new Date(Date.now() + 30 * 60_000).toISOString();
    const t = (
      await asha.post('/api/v1/tasks', { title: 'Call bank', dueAt: inHalfHour, dueHasTime: true })
    ).json();
    const notify = ctx.deps.notifications.notify.bind(ctx.deps.notifications);
    expect(await runReminders(ctx.deps.db, notify)).toEqual({ dueSoon: 1, overdue: 0 });
    expect(await runReminders(ctx.deps.db, notify)).toEqual({ dueSoon: 0, overdue: 0 });
    const later = new Date(Date.now() + 40 * 60_000);
    expect(await runReminders(ctx.deps.db, notify, later)).toEqual({ dueSoon: 0, overdue: 1 });
    expect(await runReminders(ctx.deps.db, notify, later)).toEqual({ dueSoon: 0, overdue: 0 });
    const types = (await asha.get('/api/v1/notifications'))
      .json()
      .items.map((n: { type: string }) => n.type);
    expect(types).toEqual(['overdue', 'due_soon']);

    // Moving the due date re-arms reminders; done tasks never remind.
    await asha.patch(`/api/v1/tasks/${t.id}`, {
      version: 1,
      dueAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    });
    const row = await ctx.deps.db.query.tasks.findFirst({ where: eq(tasks.id, t.id) });
    expect(row!.remindedDueSoonAt).toBeNull();
    await asha.patch(`/api/v1/tasks/${t.id}`, { version: 2, status: 'done' });
    expect(await runReminders(ctx.deps.db, notify)).toEqual({ dueSoon: 0, overdue: 0 });
  });

  it('date-only tasks become overdue after midnight in the person’s time zone', async () => {
    const asha = await signUpWithEmail(ctx); // Asia/Kolkata
    await asha.post('/api/v1/tasks', {
      title: 'Pay rent',
      dueAt: '2026-03-10T00:00:00.000Z',
      dueHasTime: false,
    });
    const notify = ctx.deps.notifications.notify.bind(ctx.deps.notifications);
    // 23:00 IST on the 10th: not yet late.
    expect(
      (await runReminders(ctx.deps.db, notify, new Date('2026-03-10T17:30:00Z'))).overdue,
    ).toBe(0);
    // 00:30 IST on the 11th: late.
    expect(
      (await runReminders(ctx.deps.db, notify, new Date('2026-03-10T19:00:00Z'))).overdue,
    ).toBe(1);
  });
});

describe('simple mode', () => {
  it('home shows people, the newest message and a task for me; a conversation pairs tasks and replies', async () => {
    const { asha, ravi, g, ids } = await pair();
    const rec = (await upload(asha, 'task_audio')).json();
    const t = (
      await asha.post('/api/v1/tasks', {
        title: 'Voice task',
        groupId: g.id,
        assigneeId: ids.ravi,
        audioFileId: rec.id,
      })
    ).json();
    const home = (await ravi.get('/api/v1/simple/home')).json();
    expect(home.people).toEqual([
      expect.objectContaining({ id: ids.asha, name: 'Asha Verma', groupId: g.id, unread: 1 }),
    ]);
    expect(home.newest).toMatchObject({
      kind: 'task',
      taskId: t.id,
      fromMe: false,
      unread: true,
      audio: { id: rec.id },
    });
    expect(home.taskForMe).toMatchObject({ taskId: t.id, forMe: true });

    const reply = (await upload(ravi, 'comment_audio')).json();
    await ravi.post(`/api/v1/tasks/${t.id}/comments`, { audioFileId: reply.id });
    const conv = (await asha.get(`/api/v1/simple/people/${ids.ravi}`)).json();
    expect(conv.items.map((i: { kind: string; fromMe: boolean }) => [i.kind, i.fromMe])).toEqual([
      ['task', true],
      ['reply', false],
    ]);
    expect(conv.items[1].unread).toBe(true);
    await asha.post(`/api/v1/simple/people/${ids.ravi}/heard`);
    expect((await asha.get(`/api/v1/simple/people/${ids.ravi}`)).json().items[1].unread).toBe(
      false,
    );

    // "Yes, done".
    await ravi.patch(`/api/v1/tasks/${t.id}`, { version: 1, status: 'done' });
    expect((await ravi.get('/api/v1/simple/home')).json().taskForMe).toBeNull();

    // Only people you share a group with.
    const stranger = await signUpWithEmail(ctx, 'stranger@example.com', 'Stranger');
    expect((await asha.get(`/api/v1/simple/people/${await meId(stranger)}`)).statusCode).toBe(404);
  });
});
