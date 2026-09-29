import pg from 'pg';
import type { Db, Queryable, QueryResult } from './types.js';

/** One fixed number identifies "the instance that owns live matches" in Postgres advisory locks. */
const OWNERSHIP_LOCK_KEY = 727_101_001;

const wrap = (client: pg.PoolClient | pg.Pool): Queryable => ({
  async query<T>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    const res = await client.query(sql, params as unknown[]);
    return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
  },
  async exec(sql: string): Promise<void> {
    await client.query(sql);
  },
});

export class PgDb implements Db {
  readonly kind = 'pg' as const;
  private readonly pool: pg.Pool;
  private readonly api: Queryable;
  private owner: pg.PoolClient | null = null;
  private lostHandlers: Array<() => void> = [];

  constructor(connectionString: string, opts: { max?: number; ssl?: boolean } = {}) {
    this.pool = new pg.Pool({
      connectionString,
      max: opts.max ?? 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ...(opts.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    // An idle client erroring (server restart) must not crash the process; the next query reconnects.
    this.pool.on('error', () => undefined);
    this.api = wrap(this.pool);
  }

  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
    return this.api.query<T>(sql, params);
  }

  exec(sql: string): Promise<void> {
    return this.api.exec(sql);
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(wrap(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async tryOwnership(): Promise<boolean> {
    if (this.owner) return true;
    const client = await this.pool.connect();
    const res = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [OWNERSHIP_LOCK_KEY]);
    if (!res.rows[0]?.ok) {
      client.release();
      return false;
    }
    // Session-level locks vanish if this connection dies, so watch it and tell the app.
    const lost = (): void => {
      if (this.owner !== client) return;
      this.owner = null;
      // Destroy the dead connection so the pool can shut down cleanly later.
      try {
        client.release(true);
      } catch {
        // already released
      }
      for (const handler of this.lostHandlers) handler();
    };
    client.on('error', lost);
    client.on('end', lost);
    this.owner = client;
    return true;
  }

  async releaseOwnership(): Promise<void> {
    const client = this.owner;
    if (!client) return;
    this.owner = null;
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [OWNERSHIP_LOCK_KEY]);
    } catch {
      // the connection is gone, which releases the lock anyway
    } finally {
      client.release();
    }
  }

  onOwnershipLost(handler: () => void): void {
    this.lostHandlers.push(handler);
  }

  async close(): Promise<void> {
    await this.releaseOwnership();
    await this.pool.end();
  }
}
