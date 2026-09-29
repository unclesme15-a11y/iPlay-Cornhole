import { createHash } from 'node:crypto';
import type { Db } from './types.js';
import { MIGRATIONS, type Migration } from './migrations.js';

const checksum = (m: Migration): string => createHash('sha256').update(m.sql).digest('hex');

/** Arbitrary constant: serialises concurrent migrators (for example two instances booting at once). */
const MIGRATION_LOCK_KEY = 727_101_002;

export interface MigrateResult {
  applied: number[];
  current: number;
}

/** Brings the database up to the newest schema. Safe to run on every boot and from several instances at once. */
export async function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): Promise<MigrateResult> {
  const versions = migrations.map((m) => m.version);
  if (new Set(versions).size !== versions.length || versions.some((v, i) => v !== i + 1)) {
    throw new Error('Migrations must be numbered 1, 2, 3, ... with no gaps or repeats');
  }
  const applied: number[] = [];
  await db.transaction(async (tx) => {
    // Take the lock BEFORE creating the table: two servers running CREATE TABLE IF NOT EXISTS at the
    // same moment can still collide inside Postgres, so only the lock holder may touch anything.
    await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
    await tx.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version int PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = await tx.query<{ version: number; checksum: string }>('SELECT version, checksum FROM schema_migrations ORDER BY version');
    const seen = new Map(done.rows.map((r) => [r.version, r.checksum]));

    for (const [version, sum] of seen) {
      const known = migrations.find((m) => m.version === version);
      if (!known) throw new Error(`Database is at migration ${version}, which this server does not know. Deploy a newer server.`);
      if (checksum(known) !== sum) throw new Error(`Migration ${version} ("${known.name}") was edited after it was applied. Add a new migration instead.`);
    }
    for (const m of migrations) {
      if (seen.has(m.version)) continue;
      await tx.exec(m.sql);
      await tx.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [m.version, m.name, checksum(m)]);
      applied.push(m.version);
    }
  });
  return { applied, current: migrations.length };
}
