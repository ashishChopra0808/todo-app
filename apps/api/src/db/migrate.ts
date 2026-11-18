import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './client';

/** Applies SQL migrations from ./drizzle. Runs on deploy before the API starts. */
export async function runMigrations(url: string) {
  const { db, pool } = createDb(url);
  try {
    const folder =
      process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../../drizzle', import.meta.url));
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  runMigrations(url)
    .then(() => console.warn('migrations applied'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
