import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** Fresh database schema + empty outbox for each run. The API applies migrations on the clean schema. */
export default async function globalSetup() {
  const outbox = fileURLToPath(new URL('./.outbox', import.meta.url));
  rmSync(outbox, { recursive: true, force: true });
  mkdirSync(outbox, { recursive: true });
  const url =
    process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/todo_e2e';
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(
    'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
  );
  await client.end();
  const { runMigrations } = await import('../../api/src/db/migrate');
  await runMigrations(url);
}
