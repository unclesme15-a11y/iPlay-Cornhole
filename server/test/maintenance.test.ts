import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/types.js';
import { ManualScheduler } from '../src/lobby/scheduler.js';
import { Janitor } from '../src/maintenance.js';
import { backends, type TestDb } from './helpers/db.js';

describe.each(backends)('clean-up job ($name)', (backend) => {
  let handle: TestDb;
  let db: Db;
  beforeAll(async () => {
    handle = await backend.open();
    db = handle.db;
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await db.exec('TRUNCATE accounts, matches, live_matches, reports RESTART IDENTITY CASCADE');
  });

  const T0 = 1_800_000_000_000;
  const account = async (id: string) => {
    await db.query("INSERT INTO accounts (id, display_name, is_guest, created_at, last_seen_at) VALUES ($1, $2, true, now(), now())", [id, `Name ${id}`]);
  };
  const session = (hash: string, account: string, expires: number) =>
    db.query("INSERT INTO sessions (token_hash, account_id, created_at, last_used_at, expires_at) VALUES ($1, $2, now(), now(), $3)", [hash, account, new Date(expires)]);

  it('deletes sessions that expired (even if that phone never came back) and cooldowns that ended, and only those', async () => {
    await account('a');
    await account('b');
    await session('old', 'a', T0 - 1000);
    await session('exact', 'a', T0);
    await session('fresh', 'b', T0 + 60_000);
    await db.query("INSERT INTO ranked_cooldowns (account_id, until, reason) VALUES ('a', $1, 'forfeit')", [new Date(T0 - 5)]);
    await db.query("INSERT INTO ranked_cooldowns (account_id, until, reason) VALUES ('b', $1, 'forfeit')", [new Date(T0 + 5000)]);
    const janitor = new Janitor(db, new ManualScheduler(T0));
    expect(await janitor.runOnce()).toEqual({ sessions: 2, cooldowns: 1 });
    expect((await db.query<{ token_hash: string }>('SELECT token_hash FROM sessions')).rows.map((r) => r.token_hash)).toEqual(['fresh']);
    expect((await db.query<{ account_id: string }>('SELECT account_id FROM ranked_cooldowns')).rows).toEqual([{ account_id: 'b' }]);
    expect(await janitor.runOnce()).toEqual({ sessions: 0, cooldowns: 0 });
  });

  it('runs at start-up and then every hour, and stops when told to', async () => {
    await account('a');
    await session('gone', 'a', T0 - 1);
    const sched = new ManualScheduler(T0);
    const logs: string[] = [];
    const janitor = new Janitor(db, sched, (_l, m) => logs.push(m));
    janitor.start();
    await new Promise((r) => setTimeout(r, 100));
    expect((await db.query('SELECT 1 FROM sessions')).rows).toHaveLength(0); // start-up run
    await session('later', 'a', T0 + 30 * 60_000);
    sched.advance(60 * 60_000); // an hour: the 30-minute session has expired by now
    await new Promise((r) => setTimeout(r, 100));
    expect((await db.query('SELECT 1 FROM sessions')).rows).toHaveLength(0);
    expect(logs).toContain('cleaned up expired data');
    janitor.stop();
    await session('after-stop', 'a', T0 - 1);
    sched.advance(2 * 60 * 60_000);
    await new Promise((r) => setTimeout(r, 100));
    expect((await db.query('SELECT 1 FROM sessions')).rows).toHaveLength(1); // no longer running
  });
});
