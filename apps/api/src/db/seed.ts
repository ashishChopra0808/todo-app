import { eq } from 'drizzle-orm';
import { hashPassword } from '../auth/password-hash';
import { newId } from '../lib/ids';
import { createDb } from './client';
import {
  accounts,
  comments,
  consents,
  groupMembers,
  groups,
  taskActivity,
  tasks,
  users,
} from './schema';

/**
 * Demo data for local development and staging (never production).
 * Sign in with demo@todo.test / mango-river-lamp-91 (Priya, admin of "Sharma family")
 * or demo2@todo.test / mango-river-lamp-91 (Ravi, a member) to try groups with two people.
 */
const EMAIL = 'demo@todo.test';
const EMAIL2 = 'demo2@todo.test';
const PASSWORD = 'mango-river-lamp-91';

type Db = ReturnType<typeof createDb>['db'];

async function ensureUser(db: Db, email: string, name: string): Promise<string> {
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return existing.id;
  const id = newId();
  await db.insert(users).values({
    id,
    name,
    email,
    emailVerified: true,
    locale: 'en',
    timeZone: 'Asia/Kolkata',
  });
  await db.insert(accounts).values({
    id: newId(),
    userId: id,
    providerId: 'credential',
    accountId: id,
    password: await hashPassword(PASSWORD),
  });
  await db.insert(consents).values([
    { id: newId(), userId: id, kind: 'terms', version: 'seed' },
    { id: newId(), userId: id, kind: 'privacy', version: 'seed' },
  ]);
  return id;
}

/** Phase 2: a family group with Priya (admin) and Ravi, shared tasks and a comment. */
async function seedGroup(db: Db, priya: string) {
  const already = await db.query.groupMembers.findFirst({ where: eq(groupMembers.userId, priya) });
  if (already) return false;
  const ravi = await ensureUser(db, EMAIL2, 'Ravi Kumar');
  const groupId = newId();
  await db
    .insert(groups)
    .values({ id: groupId, name: 'Sharma family', icon: '🏠', createdBy: priya });
  await db.insert(groupMembers).values([
    { groupId, userId: priya, role: 'admin' },
    { groupId, userId: ravi, role: 'member' },
  ]);
  const shared = [
    { title: 'Buy diyas and rangoli colours', by: priya, to: ravi, priority: 'high' as const },
    { title: 'Fix the bathroom tap', by: ravi, to: priya, priority: 'medium' as const },
    { title: 'Pick up the dry cleaning', by: priya, to: null, priority: 'low' as const },
  ];
  for (const t of shared) {
    const id = newId();
    await db.insert(tasks).values({
      id,
      title: t.title,
      priority: t.priority,
      createdBy: t.by,
      assigneeId: t.to,
      groupId,
    });
    await db.insert(taskActivity).values([
      { id: newId(), taskId: id, actorId: t.by, type: 'created' },
      ...(t.to
        ? [
            {
              id: newId(),
              taskId: id,
              actorId: t.by,
              type: 'assigned' as const,
              toValue: { id: t.to, name: t.to === ravi ? 'Ravi Kumar' : 'Priya Sharma' },
            },
          ]
        : []),
    ]);
    if (t.to === ravi)
      await db.insert(comments).values({
        id: newId(),
        taskId: id,
        authorId: ravi,
        body: 'Will get them on Saturday from the market.',
      });
  }
  return true;
}

async function main() {
  if (process.env.APP_ENV === 'production') throw new Error('refusing to seed production');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const { db, pool } = createDb(url);
  try {
    const existing = await db.query.users.findFirst({ where: eq(users.email, EMAIL) });
    if (existing) {
      const added = await seedGroup(db, existing.id);
      console.warn(
        added
          ? `demo user exists; added the demo group with ${EMAIL2}`
          : 'demo data already exists',
      );
      return;
    }
    const userId = await ensureUser(db, EMAIL, 'Priya Sharma');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const day = (offset: number) => {
      const d = new Date(`${today}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + offset);
      return d;
    };
    const at = (offset: number, hh: number, mm: number) =>
      new Date(day(offset).getTime() + (hh * 60 + mm - 330) * 60_000);
    const sample = [
      {
        title: 'Pay electricity bill',
        dueAt: day(-1),
        dueHasTime: false,
        priority: 'high' as const,
      },
      {
        title: 'Book plumber for kitchen sink',
        dueAt: at(0, 11, 0),
        dueHasTime: true,
        priority: 'medium' as const,
      },
      {
        title: 'Send Q3 report to Anita',
        dueAt: at(0, 15, 0),
        dueHasTime: true,
        priority: 'high' as const,
        description: 'Include the regional breakdown.',
      },
      {
        title: 'Water the balcony plants',
        dueAt: day(0),
        dueHasTime: false,
        priority: 'low' as const,
        status: 'done' as const,
      },
      {
        title: 'दादी के लिए दवाइयाँ लाना',
        dueAt: at(1, 18, 30),
        dueHasTime: true,
        priority: 'medium' as const,
      },
      {
        title: 'Renew car insurance',
        dueAt: day(6),
        dueHasTime: false,
        priority: 'medium' as const,
      },
      { title: 'Plan Sunday lunch', dueAt: null, dueHasTime: false, priority: 'low' as const },
    ];
    for (const t of sample) {
      const id = newId();
      const status = 'status' in t ? t.status : 'todo';
      await db.insert(tasks).values({
        id,
        title: t.title,
        description: 'description' in t ? t.description : null,
        dueAt: t.dueAt,
        dueHasTime: t.dueHasTime,
        priority: t.priority,
        status,
        completedAt: status === 'done' ? new Date() : null,
        createdBy: userId,
        assigneeId: userId,
      });
      await db
        .insert(taskActivity)
        .values({ id: newId(), taskId: id, actorId: userId, type: 'created' });
    }
    await seedGroup(db, userId);
    console.warn(
      `seeded ${EMAIL} and ${EMAIL2} (password ${PASSWORD}) with ${sample.length} personal tasks and a group`,
    );
  } finally {
    await pool.end();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
