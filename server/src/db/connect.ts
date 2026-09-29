import { PgDb } from './pg.js';
import { PgliteDb } from './pglite.js';
import type { Db } from './types.js';

/**
 * `postgres://user:pass@host:5432/db` for real Postgres (production),
 * `pglite://memory` or `pglite://./some/dir` for the in-process database (tests, local dev).
 */
export async function connectDb(url: string, opts: { ssl?: boolean; max?: number } = {}): Promise<Db> {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return new PgDb(url, opts);
  if (url.startsWith('pglite://')) {
    const target = url.slice('pglite://'.length);
    return PgliteDb.open(target === 'memory' || target === '' ? undefined : target);
  }
  throw new Error('DATABASE_URL must start with postgres://, postgresql:// or pglite://');
}
