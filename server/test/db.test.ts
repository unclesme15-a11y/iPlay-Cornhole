import { afterEach, describe, expect, it } from 'vitest';
import { connectDb } from '../src/db/connect.js';
import { migrate } from '../src/db/migrate.js';
import { MIGRATIONS } from '../src/db/migrations.js';
import { PG_URL, backends, type TestDb } from './helpers/db.js';

describe.each(backends)('database ($name)', (backend) => {
  const open: TestDb[] = [];
  const fresh = async (opts?: { migrate?: boolean }) => {
    const t = await backend.open(opts);
    open.push(t);
    return t.db;
  };
  afterEach(async () => {
    while (open.length) await open.pop()!.close();
  });

  it('applies the schema, and applying it again does nothing', async () => {
    const db = await fresh({ migrate: false });
    expect(await migrate(db)).toEqual({ applied: [1, 2, 3, 4, 5], current: 5 });
    expect(await migrate(db)).toEqual({ applied: [], current: 5 });
    const tables = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    for (const name of ['accounts', 'identities', 'sessions', 'matches', 'match_players', 'player_stats', 'live_matches', 'blocks', 'reports', 'deletion_requests', 'seasons', 'season_results', 'schema_migrations']) {
      expect(tables.rows.map((r) => r.table_name)).toContain(name);
    }
  });

  it('refuses to start if an applied migration was edited', async () => {
    const db = await fresh({ migrate: false });
    await migrate(db);
    const edited = [{ ...MIGRATIONS[0]!, sql: MIGRATIONS[0]!.sql + '\n-- sneaky change' }, MIGRATIONS[1]!];
    await expect(migrate(db, edited)).rejects.toThrow(/edited after it was applied/);
  });

  it('refuses to run against a database from a newer server', async () => {
    const db = await fresh({ migrate: false });
    const future = [...MIGRATIONS, { version: MIGRATIONS.length + 1, name: 'future', sql: 'SELECT 1' }];
    await migrate(db, future);
    await expect(migrate(db, MIGRATIONS)).rejects.toThrow(/does not know/);
  });

  it('rejects migrations with gaps or repeats', async () => {
    const db = await fresh({ migrate: false });
    await expect(migrate(db, [{ version: 2, name: 'x', sql: 'SELECT 1' }])).rejects.toThrow(/no gaps/);
  });

  it('commits a transaction that succeeds and rolls back one that throws', async () => {
    const db = await fresh();
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO accounts (id, display_name) VALUES ('a1', 'One')");
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO accounts (id, display_name) VALUES ('a2', 'Two')");
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rows = await db.query<{ id: string }>('SELECT id FROM accounts ORDER BY id');
    expect(rows.rows.map((r) => r.id)).toEqual(['a1']);
  });

  it('round-trips jsonb, timestamps and integers with the types the app expects', async () => {
    const db = await fresh();
    const state = { a: 1, nested: { list: [1, 2, 3], text: 'héllo' } };
    await db.query('INSERT INTO live_matches (id, phase, state) VALUES ($1, $2, $3::jsonb)', ['M1', 'lobby', JSON.stringify(state)]);
    const row = (await db.query<{ state: typeof state; updated_at: Date }>('SELECT state, updated_at FROM live_matches WHERE id = $1', ['M1'])).rows[0]!;
    expect(row.state).toEqual(state);
    expect(row.updated_at).toBeInstanceOf(Date);
    const count = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM live_matches')).rows[0]!;
    expect(count.n).toBe(1);
  });

  it('enforces the constraints the app relies on', async () => {
    const db = await fresh();
    await expect(db.query("INSERT INTO accounts (id, display_name, status) VALUES ('x', 'X', 'weird')")).rejects.toThrow();
    await db.query("INSERT INTO accounts (id, display_name) VALUES ('a', 'A'), ('b', 'B')");
    await expect(db.query("INSERT INTO blocks (blocker_id, blocked_id) VALUES ('a', 'a')")).rejects.toThrow();
    await db.query("INSERT INTO identities (provider, subject, account_id) VALUES ('apple', 's1', 'a')");
    await expect(db.query("INSERT INTO identities (provider, subject, account_id) VALUES ('apple', 's1', 'b')")).rejects.toThrow();
  });

  it('deleting an account removes its sessions and identities but keeps match history', async () => {
    const db = await fresh();
    await db.query("INSERT INTO accounts (id, display_name) VALUES ('a', 'A')");
    await db.query("INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ('h', 'a', now() + interval '1 day')");
    await db.query("INSERT INTO identities (provider, subject, account_id) VALUES ('google', 'g', 'a')");
    await db.query("INSERT INTO matches (id, code, config, created_at, ended_at, outcome, score_a, score_b, innings) VALUES ('m', 'CODE', '{}'::jsonb, now(), now(), 'score', 21, 3, 8)");
    await db.query("INSERT INTO match_players (match_id, seat, team, account_id, display_name, kind) VALUES ('m', 'A1', 'A', 'a', 'A', 'human')");
    await db.query("DELETE FROM accounts WHERE id = 'a'");
    expect((await db.query('SELECT 1 FROM sessions')).rowCount).toBe(0);
    expect((await db.query('SELECT 1 FROM identities')).rowCount).toBe(0);
    const player = (await db.query<{ account_id: string | null }>("SELECT account_id FROM match_players WHERE match_id = 'm'")).rows[0]!;
    expect(player.account_id).toBeNull();
  });

  it('connectDb rejects unknown URL schemes', async () => {
    await expect(connectDb('mysql://nope')).rejects.toThrow(/must start with/);
  });
});

describe.skipIf(!PG_URL)('real Postgres only', () => {
  const backend = backends.find((b) => b.name === 'postgres')!;
  const open: TestDb[] = [];
  afterEach(async () => {
    while (open.length) await open.pop()!.close();
  });

  it('two servers migrating at the same moment do not collide', async () => {
    const t = await backend.open({ migrate: false });
    open.push(t);
    const url = new URL(PG_URL!);
    const dbName = (await t.db.query<{ current_database: string }>('SELECT current_database()')).rows[0]!.current_database;
    url.pathname = `/${dbName}`;
    const second = await connectDb(url.toString());
    const results = await Promise.all([migrate(t.db), migrate(second)]);
    await second.close();
    expect(results.flatMap((r) => r.applied)).toEqual([1, 2, 3, 4, 5]); // exactly one of them applied everything
  });

  it('a name saved into match history at the very moment the account is deleted still gets anonymised', async () => {
    const t = await backend.open();
    open.push(t);
    await t.db.query("INSERT INTO accounts (id, display_name) VALUES ('racer', 'Real Name')");
    await t.db.query("INSERT INTO matches (id, code, config, created_at, ended_at, outcome, score_a, score_b, innings) VALUES ('m1', 'RACE2345', '{}'::jsonb, now(), now(), 'score', 21, 0, 4)");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // Connection 1 is halfway through saving a match result that names the player...
    const saving = t.db.transaction(async (tx) => {
      await tx.query("INSERT INTO match_players (match_id, seat, team, account_id, display_name, kind) VALUES ('m1', 'A1', 'A', 'racer', 'Real Name', 'human')");
      await gate;
    });
    await new Promise((r) => setTimeout(r, 150));
    // ...while connection 2 deletes the account. It has to wait for connection 1.
    const deleting = t.db.query("DELETE FROM accounts WHERE id = 'racer'");
    await new Promise((r) => setTimeout(r, 150));
    release();
    await saving;
    await deleting;
    const row = (await t.db.query<{ display_name: string; account_id: string | null }>("SELECT display_name, account_id FROM match_players WHERE match_id = 'm1'")).rows[0]!;
    expect(row).toEqual({ display_name: 'Deleted player', account_id: null });
  });

  it('only one server can own live matches at a time', async () => {
    const t = await backend.open();
    open.push(t);
    const url = new URL(PG_URL!);
    const dbName = (await t.db.query<{ current_database: string }>('SELECT current_database()')).rows[0]!.current_database;
    url.pathname = `/${dbName}`;
    const other = await connectDb(url.toString());
    expect(await t.db.tryOwnership()).toBe(true);
    expect(await t.db.tryOwnership()).toBe(true); // asking again is fine
    expect(await other.tryOwnership()).toBe(false);
    await t.db.releaseOwnership();
    expect(await other.tryOwnership()).toBe(true);
    await other.close();
  });

  it('tells the app when the owning connection is lost', async () => {
    const t = await backend.open();
    open.push(t);
    const url = new URL(PG_URL!);
    const dbName = (await t.db.query<{ current_database: string }>('SELECT current_database()')).rows[0]!.current_database;
    url.pathname = `/${dbName}`;
    const admin = await connectDb(url.toString());
    let lost = 0;
    t.db.onOwnershipLost(() => lost++);
    expect(await t.db.tryOwnership()).toBe(true);
    // kill the backend that holds the advisory lock, as a network drop or a database restart would
    await admin.query(
      "SELECT pg_terminate_backend(l.pid) FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid <> pg_backend_pid()",
    );
    for (let i = 0; i < 50 && lost === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(lost).toBe(1);
    // and another server can now take over
    expect(await admin.tryOwnership()).toBe(true);
    await admin.close();
  });
});
