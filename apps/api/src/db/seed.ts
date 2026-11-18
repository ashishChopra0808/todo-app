import { eq } from 'drizzle-orm';
import { hashPassword } from '../auth/password-hash';
import { newId } from '../lib/ids';
import { createDb } from './client';
import { accounts, consents, taskActivity, tasks, users } from './schema';

/**
 * Demo data for local development and staging (never production).
 * Sign in with demo@todo.test / mango-river-lamp-91
 */
const EMAIL = 'demo@todo.test';
const PASSWORD = 'mango-river-lamp-91';

async function main() {
  if (process.env.APP_ENV === 'production') throw new Error('refusing to seed production');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const { db, pool } = createDb(url);
  try {
    const existing = await db.query.users.findFirst({ where: eq(users.email, EMAIL) });
    if (existing) {
      console.warn('demo user already exists');
      return;
    }
    const userId = newId();
    await db.insert(users).values({
      id: userId,
      name: 'Priya Sharma',
      email: EMAIL,
      emailVerified: true,
      locale: 'en',
      timeZone: 'Asia/Kolkata',
    });
    await db.insert(accounts).values({
      id: newId(),
      userId,
      providerId: 'credential',
      accountId: userId,
      password: await hashPassword(PASSWORD),
    });
    await db.insert(consents).values([
      { id: newId(), userId, kind: 'terms', version: 'seed' },
      { id: newId(), userId, kind: 'privacy', version: 'seed' },
    ]);
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
    console.warn(`seeded ${EMAIL} / ${PASSWORD} with ${sample.length} tasks`);
  } finally {
    await pool.end();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
