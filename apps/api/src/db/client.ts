import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { schema } from './schema';

export type Db = NodePgDatabase<typeof schema>;

export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}
