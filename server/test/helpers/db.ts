import { randomBytes } from 'node:crypto';
import { connectDb } from '../../src/db/connect.js';
import { migrate } from '../../src/db/migrate.js';
import type { Db } from '../../src/db/types.js';

/** Set TEST_DATABASE_URL to a real Postgres (any database on it) to also run the DB tests there. */
export const PG_URL = process.env.TEST_DATABASE_URL;

export interface TestDb {
  db: Db;
  /** Connection string, for tests that need to open their own connection to the same database (real Postgres only). */
  url?: string;
  close(): Promise<void>;
}

export type Backend = { name: 'pglite' | 'postgres'; open(opts?: { migrate?: boolean }): Promise<TestDb> };

async function openPglite(opts: { migrate?: boolean } = {}): Promise<TestDb> {
  const db = await connectDb('pglite://memory');
  if (opts.migrate !== false) await migrate(db);
  return { db, close: () => db.close() };
}

/** Each call gets its own fresh database on the real server, so test files can run in parallel. */
async function openPostgres(opts: { migrate?: boolean } = {}): Promise<TestDb> {
  const name = `t_${randomBytes(6).toString('hex')}`;
  const admin = await connectDb(PG_URL!);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.close();
  const url = new URL(PG_URL!);
  url.pathname = `/${name}`;
  const db = await connectDb(url.toString());
  if (opts.migrate !== false) await migrate(db);
  return {
    db,
    url: url.toString(),
    close: async () => {
      await db.close();
      const cleanup = await connectDb(PG_URL!);
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.close();
    },
  };
}

export const backends: Backend[] = [
  { name: 'pglite', open: openPglite },
  ...(PG_URL ? [{ name: 'postgres' as const, open: openPostgres }] : []),
];

/** The default for tests that are not about the database itself. */
export const openTestDb = openPglite;
