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
    await db.exec('TRUNCATE accounts, matches, live_matches, reports, deletion_requests RESTART IDENTITY CASCADE');
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
    expect(await janitor.runOnce()).toEqual({ sessions: 2, cooldowns: 1, deletionRequests: 0, matches: 0 });
    expect((await db.query<{ token_hash: string }>('SELECT token_hash FROM sessions')).rows.map((r) => r.token_hash)).toEqual(['fresh']);
    expect((await db.query<{ account_id: string }>('SELECT account_id FROM ranked_cooldowns')).rows).toEqual([{ account_id: 'b' }]);
    expect(await janitor.runOnce()).toEqual({ sessions: 0, cooldowns: 0, deletionRequests: 0, matches: 0 });
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

  const DAY = 24 * 60 * 60_000;
  const deletionRequest = (id: string, status: string, handledAt: number | null) =>
    db.query("INSERT INTO deletion_requests (id, created_at, display_name, contact, status, handled_at) VALUES ($1, now(), 'P', 'p@example.com', $2, $3)", [
      id,
      status,
      handledAt === null ? null : new Date(handledAt),
    ]);

  it('removes handled website deletion requests after 90 days, and never open ones', async () => {
    await deletionRequest('open-old', 'open', null);
    await deletionRequest('done-old', 'done', T0 - 91 * DAY);
    await deletionRequest('rejected-old', 'rejected', T0 - 90 * DAY);
    await deletionRequest('done-recent', 'done', T0 - 89 * DAY);
    const r = await new Janitor(db, new ManualScheduler(T0)).runOnce();
    expect(r.deletionRequests).toBe(2);
    expect((await db.query<{ id: string }>('SELECT id FROM deletion_requests ORDER BY id')).rows.map((x) => x.id)).toEqual(['done-recent', 'open-old']);
  });

  const match = async (id: string, endedAt: number, player: string) => {
    await db.query(
      "INSERT INTO matches (id, code, config, created_at, ended_at, outcome, winner, score_a, score_b, innings) VALUES ($1, 'CODE1234', '{}', $2, $2, 'score', 'A', 21, 5, 6)",
      [id, new Date(endedAt)],
    );
    await db.query("INSERT INTO match_players (match_id, seat, team, account_id, display_name, kind) VALUES ($1, 'A1', 'A', $2, 'P', 'human')", [id, player]);
  };

  it('keeps match history forever by default', async () => {
    await account('a');
    await match('ancient', T0 - 3000 * DAY, 'a');
    expect((await new Janitor(db, new ManualScheduler(T0)).runOnce()).matches).toBe(0);
    expect((await db.query('SELECT 1 FROM matches')).rows).toHaveLength(1);
  });

  it('with MATCH_HISTORY_DAYS, deletes older matches and their player rows, and leaves ratings alone', async () => {
    await account('a');
    await match('old', T0 - 31 * DAY, 'a');
    await match('new', T0 - 29 * DAY, 'a');
    await db.query("INSERT INTO singles_ratings (account_id, rating, peak, games, wins, losses, streak, last_played_at) VALUES ('a', 1300, 1300, 12, 8, 4, 2, now())");
    const r = await new Janitor(db, new ManualScheduler(T0), undefined, undefined, { matchHistoryDays: 30 }).runOnce();
    expect(r.matches).toBe(1);
    expect((await db.query<{ id: string }>('SELECT id FROM matches')).rows).toEqual([{ id: 'new' }]);
    expect((await db.query<{ match_id: string }>('SELECT match_id FROM match_players')).rows).toEqual([{ match_id: 'new' }]);
    expect((await db.query<{ rating: number }>("SELECT rating FROM singles_ratings WHERE account_id = 'a'")).rows).toEqual([{ rating: 1300 }]);
  });
});
