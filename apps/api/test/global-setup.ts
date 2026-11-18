import pg from 'pg';
import { runMigrations } from '../src/db/migrate';
import { TEST_DB } from './env';

/** Fresh schema for every test run. */
export default async function setup() {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  await client.query(
    'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
  );
  await client.end();
  await runMigrations(TEST_DB);
}
