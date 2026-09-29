import type { Db, Queryable, QueryResult } from './types.js';

/** Just the parts of PGlite we use, so the package stays an optional (dev) dependency. */
interface PgliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: PgliteLike) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const wrap = (db: PgliteLike): Queryable => ({
  async query<T>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    const res = await db.query<T>(sql, [...params]);
    // Real Postgres counts returned rows for a SELECT; PGlite reports 0 there, so take the larger.
    return { rows: res.rows, rowCount: Math.max(res.affectedRows ?? 0, res.rows.length) };
  },
  async exec(sql: string): Promise<void> {
    await db.exec(sql);
  },
});

/**
 * Postgres running inside this Node process (WASM). Used for tests and for local development with
 * no database installed. It is one connection, so it has no cross-process ownership lock: never
 * use it in production.
 */
export class PgliteDb implements Db {
  readonly kind = 'pglite' as const;
  private readonly api: Queryable;

  private constructor(private readonly db: PgliteLike) {
    this.api = wrap(db);
  }

  static async open(dataDir?: string): Promise<PgliteDb> {
    let mod: { PGlite: new (dir?: string) => PgliteLike };
    try {
      mod = (await import('@electric-sql/pglite')) as unknown as typeof mod;
    } catch {
      throw new Error('pglite:// needs the @electric-sql/pglite package (a dev dependency). Use a postgres:// URL in production.');
    }
    return new PgliteDb(new mod.PGlite(dataDir));
  }

  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
    return this.api.query<T>(sql, params);
  }

  exec(sql: string): Promise<void> {
    return this.api.exec(sql);
  }

  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(wrap(tx)));
  }

  async tryOwnership(): Promise<boolean> {
    return true;
  }
  async releaseOwnership(): Promise<void> {}
  onOwnershipLost(): void {}

  async close(): Promise<void> {
    await this.db.close();
  }
}
