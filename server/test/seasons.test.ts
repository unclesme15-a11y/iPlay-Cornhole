import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/types.js';
import { ManualScheduler } from '../src/lobby/scheduler.js';
import { SeasonService, seasonNumberAt, seasonStart, softReset, type SeasonSettings } from '../src/ranking/seasons.js';
import { TestEnv } from './helpers/app.js';
import { backends, type TestDb } from './helpers/db.js';

const QUARTERS: SeasonSettings = { firstStart: new Date('2026-10-01T00:00:00Z'), lengthMonths: 3, keep: 0.5 };
const t = (iso: string) => Date.parse(iso);

describe('season calendar', () => {
  it('numbers seasons by quarters from the first start, and counts anything before it as season 1', () => {
    expect(seasonNumberAt(QUARTERS, t('2026-01-01T00:00:00Z'))).toBe(1);
    expect(seasonNumberAt(QUARTERS, t('2026-10-01T00:00:00Z'))).toBe(1);
    expect(seasonNumberAt(QUARTERS, t('2026-12-31T23:59:59Z'))).toBe(1);
    expect(seasonNumberAt(QUARTERS, t('2027-01-01T00:00:00Z'))).toBe(2);
    expect(seasonNumberAt(QUARTERS, t('2027-09-30T12:00:00Z'))).toBe(4);
    expect(seasonNumberAt(QUARTERS, t('2031-10-01T00:00:00Z'))).toBe(21);
    expect(seasonStart(QUARTERS, 2).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(seasonStart(QUARTERS, 5).toISOString()).toBe('2027-10-01T00:00:00.000Z');
  });

  it('works for monthly and yearly seasons and odd start days', () => {
    const monthly: SeasonSettings = { firstStart: new Date('2026-10-15T00:00:00Z'), lengthMonths: 1, keep: 0.5 };
    expect(seasonNumberAt(monthly, t('2026-11-14T23:59:59Z'))).toBe(1);
    expect(seasonNumberAt(monthly, t('2026-11-15T00:00:00Z'))).toBe(2);
    expect(seasonNumberAt(monthly, t('2027-10-15T00:00:00Z'))).toBe(13);
    const yearly: SeasonSettings = { ...QUARTERS, lengthMonths: 12 };
    expect(seasonNumberAt(yearly, t('2028-09-30T00:00:00Z'))).toBe(2);
  });

  it('soft reset pulls every rating halfway back to 1200 by default', () => {
    expect(softReset(1600, 0.5)).toBe(1400);
    expect(softReset(1000, 0.5)).toBe(1100);
    expect(softReset(1200, 0.5)).toBe(1200);
    expect(softReset(1601, 0)).toBe(1200);
    expect(softReset(1601, 1)).toBe(1601);
  });
});

describe.each(backends)('season rollover ($name)', (backend) => {
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
    await db.exec('TRUNCATE accounts, matches, live_matches, reports, season_results, seasons RESTART IDENTITY CASCADE');
  });

  const account = async (id: string, extra = '') => {
    await db.query(`INSERT INTO accounts (id, display_name, is_guest, created_at, last_seen_at) VALUES ($1, $2, true, now(), now())`, [id, `Name ${id}`]);
    if (extra) await db.query(`UPDATE accounts SET ${extra} WHERE id = $1`, [id]);
  };
  const singles = (id: string, rating: number, games: number, lastPlayed: number) =>
    db.query('INSERT INTO singles_ratings (account_id, rating, peak, games, wins, losses, streak, last_played_at) VALUES ($1, $2, $2, $3, $4, $5, 2, $6)', [
      id, rating, games, Math.ceil(games / 2), Math.floor(games / 2), new Date(lastPlayed),
    ]);

  it('first run only records the current season; nothing is closed', async () => {
    const svc = new SeasonService(db, new ManualScheduler(t('2027-02-10T00:00:00Z')), QUARTERS);
    expect(await svc.rollOver()).toEqual([]);
    expect((await db.query<{ number: number }>('SELECT number FROM seasons')).rows).toEqual([{ number: 2 }]);
    expect(await svc.rollOver()).toEqual([]);
  });

  it('at the end of a season: saves who qualified, keeps everyone who played, soft-resets, opens the next season, once', async () => {
    const sched = new ManualScheduler(t('2026-12-20T00:00:00Z'));
    const svc = new SeasonService(db, sched, QUARTERS);
    await svc.rollOver(); // season 1 recorded
    const recent = t('2026-12-15T00:00:00Z');
    await account('top');
    await account('second');
    await account('few');
    await account('hidden', 'show_on_leaderboards = false');
    await account('banned', "status = 'banned', banned_until = NULL");
    await account('idle');
    await account('none');
    await singles('top', 1600, 30, recent);
    await singles('second', 1300, 12, recent);
    await singles('few', 1500, 4, recent);
    await singles('hidden', 1700, 20, recent);
    await singles('banned', 1800, 20, recent);
    await singles('idle', 1550, 20, t('2026-06-01T00:00:00Z'));
    await singles('none', 1250, 0, recent); // did not play this season
    await db.query("INSERT INTO duo_ratings (duo_key, member_a, member_b, rating, peak, games, wins, losses, streak, last_played_at) VALUES ('second:top', 'second', 'top', 1440, 1440, 11, 7, 4, 1, $1)", [new Date(recent)]);

    sched.advance(t('2027-01-01T00:00:00Z') - sched.now() - 1);
    expect(await svc.rollOver()).toEqual([]); // one millisecond before the end
    sched.advance(1);
    const closedEvents: number[] = [];
    svc.onSeasonClosed = (s) => closedEvents.push(s.number);
    expect(await svc.rollOver()).toEqual([1]);
    expect(closedEvents).toEqual([1]);
    expect(await svc.rollOver()).toEqual([]); // safe to repeat

    const rows = (await db.query<{ entry_key: string; rank: number | null; rating: number }>(
      "SELECT entry_key, rank, rating FROM season_results WHERE season = 1 AND mode = 'singles' ORDER BY entry_key",
    )).rows;
    expect(rows).toEqual([
      { entry_key: 'banned', rank: null, rating: 1800 },
      { entry_key: 'few', rank: null, rating: 1500 },
      { entry_key: 'hidden', rank: null, rating: 1700 },
      { entry_key: 'idle', rank: null, rating: 1550 },
      { entry_key: 'second', rank: 2, rating: 1300 },
      { entry_key: 'top', rank: 1, rating: 1600 },
    ]);
    expect((await db.query("SELECT rank, name_a, name_b FROM season_results WHERE mode = 'teams'")).rows).toEqual([{ rank: 1, name_a: 'Name second', name_b: 'Name top' }]);

    const after = (await db.query<{ account_id: string; rating: number; peak: number; games: number; wins: number; streak: number }>(
      "SELECT account_id, rating, peak, games, wins, streak FROM singles_ratings WHERE account_id IN ('top', 'few', 'none') ORDER BY account_id",
    )).rows;
    expect(after).toEqual([
      { account_id: 'few', rating: 1350, peak: 1350, games: 0, wins: 0, streak: 0 },
      { account_id: 'none', rating: 1225, peak: 1225, games: 0, wins: 0, streak: 0 },
      { account_id: 'top', rating: 1400, peak: 1400, games: 0, wins: 0, streak: 0 },
    ]);
    expect((await db.query<{ rating: number; games: number }>('SELECT rating, games FROM duo_ratings')).rows).toEqual([{ rating: 1320, games: 0 }]);
    expect((await db.query<{ number: number; closed: boolean }>('SELECT number, closed_at IS NOT NULL AS closed FROM seasons ORDER BY number')).rows).toEqual([
      { number: 1, closed: true },
      { number: 2, closed: false },
    ]);

    const board = await svc.standings('singles', 1, 50, 0);
    expect(board!.entries.map((e) => [e.rank, e.members[0]!.displayName, e.rating])).toEqual([[1, 'Name top', 1600], [2, 'Name second', 1300]]);
    expect(board!.total).toBe(2);
    expect(await svc.standings('singles', 2, 50, 0)).toBeNull(); // still running
    const mine = await svc.mine('second');
    expect(mine.map((m) => [m.season, m.mode, m.rank, m.partner?.displayName ?? null])).toEqual([[1, 'singles', 2, null], [1, 'teams', 1, 'Name top']]);
  });

  it('catches up on seasons missed while the server was off, in order', async () => {
    const sched = new ManualScheduler(t('2026-11-01T00:00:00Z'));
    const svc = new SeasonService(db, sched, QUARTERS);
    await svc.rollOver();
    await account('p');
    await singles('p', 1800, 15, t('2026-11-01T00:00:00Z'));
    sched.advance(t('2027-08-01T00:00:00Z') - sched.now()); // in season 4
    expect(await svc.rollOver()).toEqual([1, 2, 3]);
    expect((await db.query<{ rating: number }>("SELECT rating FROM singles_ratings WHERE account_id = 'p'")).rows[0]!.rating).toBe(1275); // three resets, exactly as if the server had been on: 1800, 1500, 1350, 1275
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM season_results')).rows[0]!.n).toBe(1); // played only in season 1
    expect((await svc.past()).map((s) => s.number)).toEqual([3, 2, 1]);
  });

  it('deleting an account turns its name into "Deleted player" on past boards', async () => {
    const sched = new ManualScheduler(t('2026-12-01T00:00:00Z'));
    const svc = new SeasonService(db, sched, QUARTERS);
    await svc.rollOver();
    await account('gone');
    await singles('gone', 1500, 12, t('2026-11-30T00:00:00Z'));
    sched.advance(t('2027-01-02T00:00:00Z') - sched.now());
    await svc.rollOver();
    await db.query("DELETE FROM accounts WHERE id = 'gone'");
    expect((await db.query('SELECT member_a, name_a, rank FROM season_results')).rows).toEqual([{ member_a: null, name_a: 'Deleted player', rank: 1 }]);
  });

  it('checks on its own: at start-up and right when the season ends', async () => {
    const sched = new ManualScheduler(t('2026-12-31T23:00:00Z'));
    const svc = new SeasonService(db, sched, QUARTERS);
    svc.start();
    await new Promise((r) => setTimeout(r, 50));
    expect((await db.query('SELECT 1 FROM seasons')).rows).toHaveLength(1);
    sched.advance(60 * 60_000 + 1000);
    await new Promise((r) => setTimeout(r, 100));
    expect((await db.query<{ number: number }>('SELECT number FROM seasons WHERE closed_at IS NOT NULL')).rows).toEqual([{ number: 1 }]);
    svc.stop();
  });
});

describe('season API', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await TestEnv.create();
  });
  afterAll(async () => {
    await env.destroy();
  });
  afterEach(async () => {
    await env.closeAll();
  });

  it('serves the current season, past boards, my history, and the export', async () => {
    const sched = new ManualScheduler(t('2026-12-20T00:00:00Z'));
    const tt = await env.boot({ scheduler: sched });
    await tt.services.db.exec('TRUNCATE seasons, season_results CASCADE');
    const g = await tt.guest('Season Champ');
    await tt.services.seasons.rollOver();
    await tt.services.db.query('INSERT INTO singles_ratings (account_id, rating, peak, games, wins, losses, streak, last_played_at) VALUES ($1, 1500, 1500, 12, 9, 3, 2, $2)', [g.id, new Date(sched.now())]);

    let res = (await tt.call(g.token, 'GET', '/api/leaderboards/singles')).json();
    expect(res.season).toMatchObject({ number: 1, name: 'Season 1', current: true, endsAt: '2027-01-01T00:00:00.000Z' });
    expect((await tt.call(null, 'GET', '/api/meta')).json().ranked.season.number).toBe(1);
    expect((await tt.call(g.token, 'GET', '/api/leaderboards/singles?season=1')).json().season.current).toBe(true); // asking for the current one = live board

    sched.advance(t('2027-01-01T00:00:01Z') - sched.now());
    await tt.services.seasons.rollOver();
    const seasons = (await tt.call(null, 'GET', '/api/seasons')).json();
    expect(seasons.current.number).toBe(2);
    expect(seasons.past.map((s: { number: number }) => s.number)).toEqual([1]);
    res = (await tt.call(g.token, 'GET', '/api/leaderboards/singles?season=1')).json();
    expect(res.season).toMatchObject({ number: 1, current: false });
    expect(res.entries).toEqual([expect.objectContaining({ rank: 1, rating: 1500, members: [{ accountId: g.id, displayName: 'Season Champ' }] })]);
    expect((await tt.call(g.token, 'GET', '/api/leaderboards/singles')).json().entries).toEqual([]); // new season: 0 games
    expect((await tt.call(g.token, 'GET', '/api/leaderboards/singles?season=7')).json().error.code).toBe('unknown_season');
    expect((await tt.call(g.token, 'GET', '/api/me/seasons')).json().results).toEqual([expect.objectContaining({ season: 1, mode: 'singles', rank: 1, rating: 1500 })]);
    expect((await tt.call(g.token, 'GET', '/api/me/export')).json().seasonResults).toEqual([expect.objectContaining({ season: 1, rank: 1 })]);
    expect((await tt.call(g.token, 'GET', '/api/me')).json().ratings.singles).toMatchObject({ rating: 1350, games: 0 });
  });
});
