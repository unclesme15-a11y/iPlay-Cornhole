import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MatchHistory, type MatchSummary, type PlayerSummary } from '../src/accounts/history.js';
import { AccountService } from '../src/accounts/service.js';
import { DEFAULT_CONFIG, type TeamId } from '../src/core/types.js';
import type { Db } from '../src/db/types.js';
import { START_RATING, expectedScore, farmingWeight, kFactor, ratingChange, seedDuoRating } from '../src/ranking/elo.js';
import { duoKey } from '../src/ranking/ratings.js';
import { backends, type TestDb } from './helpers/db.js';

const T0 = 1_800_000_000_000;
const HOUR = 3600_000;

describe('rating maths', () => {
  it('expects equal players to split and a 400-point gap to be about 10 to 1', () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5);
    expect(expectedScore(1600, 1200)).toBeCloseTo(0.909, 2);
    expect(expectedScore(1200, 1600)).toBeCloseTo(0.091, 2);
  });
  it('moves new players faster than veterans', () => {
    expect(kFactor(0)).toBe(40);
    expect(kFactor(9)).toBe(40);
    expect(kFactor(10)).toBe(28);
    expect(kFactor(30)).toBe(20);
  });
  it('gives a fresh, equal match +20 for the winner and -20 for the loser', () => {
    expect(ratingChange(1200, 1200, 1, 0)).toBe(20);
    expect(ratingChange(1200, 1200, 0, 0)).toBe(-20);
  });
  it('rewards an upset more than an expected win', () => {
    const upset = ratingChange(1000, 1400, 1, 20);
    const expected = ratingChange(1400, 1000, 1, 20);
    expect(upset).toBeGreaterThan(expected);
    expect(upset).toBeGreaterThan(15);
    expect(expected).toBeLessThanOrEqual(3);
  });
  it('cuts points when the same people keep playing each other', () => {
    expect([0, 2, 3, 5, 6, 20].map(farmingWeight)).toEqual([1, 1, 0.5, 0.5, 0, 0]);
    expect(ratingChange(1200, 1200, 1, 0, 0.5)).toBe(10);
    expect(ratingChange(1200, 1200, 1, 0, 0)).toBe(0);
  });
  it('never drops below the floor', () => {
    expect(ratingChange(110, 110, 0, 0)).toBe(-10); // would be -20, stops at 100
  });
  it('seeds a duo from the average of its members', () => {
    expect(seedDuoRating(1300, 1100)).toBe(1200);
    expect(seedDuoRating(1301, 1100)).toBe(1201);
  });
  it('makes one key for a pair, whichever order they are named in', () => {
    expect(duoKey('b', 'a')).toEqual(['a', 'b', 'a:b']);
    expect(duoKey('a', 'b')).toEqual(['a', 'b', 'a:b']);
  });
});

describe.each(backends)('ratings in the database ($name)', (backend) => {
  let handle: TestDb;
  let db: Db;
  let accounts: AccountService;
  let history: MatchHistory;
  let n = 0;
  const ids: string[] = [];

  beforeAll(async () => {
    handle = await backend.open();
    db = handle.db;
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await db.exec('TRUNCATE accounts, matches, live_matches, reports RESTART IDENTITY CASCADE');
    accounts = new AccountService(db, () => T0, { requireAdult: false });
    history = new MatchHistory(db);
    n = 0;
    ids.length = 0;
    for (const name of ['Player One', 'Player Two', 'Player Three', 'Player Four']) ids.push((await accounts.createGuest(name)).id);
  });

  const player = (seat: string, team: TeamId, accountId: string | null, over: Partial<PlayerSummary> = {}): PlayerSummary => ({
    seat, team, accountId, displayName: 'X', kind: accountId ? 'human' : 'bot', botLevel: null, characterId: 'keisha',
    leftEarly: false, throws: 8, holes: 2, boards: 3, fouls: 0, ...over,
  });
  const match = (players: PlayerSummary[], over: Partial<MatchSummary> = {}): MatchSummary => {
    n++;
    const singles = players.length === 2;
    return {
      code: `CODE${n}`, config: { ...DEFAULT_CONFIG, mode: singles ? '1v1' : '2v2' }, createdAt: new Date(T0 + n * 60_000), startedAt: new Date(T0 + n * 60_000 + 5000),
      endedAt: new Date(T0 + n * 60_000 + 600_000), outcome: 'score', winner: 'A', scores: { A: 21, B: 10 }, innings: 8, rematchOf: null,
      ranked: singles ? 'singles' : 'teams', players, ...over,
    };
  };
  const singles = (over: Partial<MatchSummary> = {}, a = 0, b = 1) =>
    match([player('A1', 'A', ids[a]!), player('B1', 'B', ids[b]!)], over);
  const teams = (over: Partial<MatchSummary> = {}, a: [number, number] = [0, 1], b: [number, number] = [2, 3]) =>
    match([player('A1', 'A', ids[a[0]]!), player('B1', 'B', ids[b[0]]!), player('A2', 'A', ids[a[1]]!), player('B2', 'B', ids[b[1]]!)], over);
  const rating = async (id: string) =>
    (await db.query<{ rating: number; games: number; wins: number; losses: number; streak: number; peak: number }>('SELECT * FROM singles_ratings WHERE account_id = $1', [id])).rows[0];

  it('starts everyone at 1200 and moves the winner up and the loser down', async () => {
    const r = await history.recordMatch(singles());
    expect(r.duplicate).toBe(false);
    expect(r.voided).toBe(false);
    expect(r.ratingUpdates).toHaveLength(2);
    expect(r.ratingUpdates.find((u) => u.accountId === ids[0])).toMatchObject({ mode: 'singles', before: START_RATING, after: 1220, change: 20, games: 1 });
    expect(r.ratingUpdates.find((u) => u.accountId === ids[1])).toMatchObject({ before: START_RATING, after: 1180, change: -20 });
    expect(await rating(ids[0]!)).toMatchObject({ rating: 1220, peak: 1220, games: 1, wins: 1, losses: 0, streak: 1 });
    expect(await rating(ids[1]!)).toMatchObject({ rating: 1180, peak: 1200, games: 1, wins: 0, losses: 1, streak: -1 });
  });

  it('stores before and after on the match, for the results screen and history', async () => {
    const r = await history.recordMatch(singles());
    const rows = (await db.query<{ account_id: string; rating_before: number; rating_after: number }>('SELECT account_id, rating_before, rating_after FROM match_players WHERE match_id = $1 ORDER BY seat', [r.id])).rows;
    expect(rows).toEqual([
      { account_id: ids[0], rating_before: 1200, rating_after: 1220 },
      { account_id: ids[1], rating_before: 1200, rating_after: 1180 },
    ]);
    expect((await db.query<{ ranked: string; voided: boolean }>('SELECT ranked, voided FROM matches WHERE id = $1', [r.id])).rows[0]).toEqual({ ranked: 'singles', voided: false });
  });

  it('keeps a streak going and resets it on a loss', async () => {
    for (let i = 0; i < 3; i++) await history.recordMatch(singles({}, 0, 1 + (i % 3)));
    expect((await rating(ids[0]!))!.streak).toBe(3);
    await history.recordMatch(singles({ winner: 'B', scores: { A: 3, B: 21 } }, 0, 1));
    expect((await rating(ids[0]!))!.streak).toBe(-1);
  });

  it('does not count casual (unranked) matches', async () => {
    const r = await history.recordMatch(singles({ ranked: null }));
    expect(r.ratingUpdates).toEqual([]);
    expect(await rating(ids[0]!)).toBeUndefined();
  });

  it('saving the same match twice changes nothing the second time', async () => {
    const m = singles();
    const first = await history.recordMatch(m);
    const again = await history.recordMatch(m);
    expect(again).toMatchObject({ duplicate: true, id: first.id, ratingUpdates: [] });
    expect(await rating(ids[0]!)).toMatchObject({ rating: 1220, games: 1 });
    expect((await db.query('SELECT 1 FROM matches')).rows).toHaveLength(1);
    expect((await history.stats(ids[0]!)).games).toBe(1);
  });

  it('concurrent saves of the same match still count once', async () => {
    const m = singles();
    const results = await Promise.allSettled([history.recordMatch(m), history.recordMatch(m), history.recordMatch(m)]);
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ duplicate: boolean }>[];
    expect(ok.filter((r) => !r.value.duplicate)).toHaveLength(1);
    expect(await rating(ids[0]!)).toMatchObject({ games: 1 });
  });

  it('voids a match nobody threw in, and one that was abandoned', async () => {
    const quit = singles({ outcome: 'forfeit' });
    quit.players.forEach((p) => (p.throws = 0));
    const a = await history.recordMatch(quit);
    expect(a).toMatchObject({ voided: true, ratingUpdates: [] });
    const b = await history.recordMatch(singles({ outcome: 'abandoned', winner: null }));
    expect(b).toMatchObject({ voided: true, ratingUpdates: [] });
    expect(await rating(ids[0]!)).toBeUndefined();
    expect((await db.query<{ voided: boolean }>('SELECT voided FROM matches WHERE ranked IS NOT NULL')).rows.every((r) => r.voided)).toBe(true);
  });

  it('counts a forfeit after play began as a loss for the one who left', async () => {
    const m = singles({ outcome: 'forfeit', winner: 'A' });
    m.players[1]!.leftEarly = true;
    m.players[1]!.throws = 2;
    const r = await history.recordMatch(m);
    expect(r.ratingUpdates.find((u) => u.accountId === ids[1])!.change).toBeLessThan(0);
    expect(await rating(ids[1]!)).toMatchObject({ losses: 1 });
  });

  it('voids the result if one player erased their account during the match', async () => {
    const m = singles();
    await accounts.delete(ids[1]!);
    const r = await history.recordMatch(m);
    expect(r).toMatchObject({ voided: true, ratingUpdates: [] });
    expect(await rating(ids[0]!)).toBeUndefined();
  });

  it('never rates a match with a bot in it', async () => {
    const m = singles();
    m.players[1] = player('B1', 'B', null);
    expect((await history.recordMatch(m)).ratingUpdates).toEqual([]);
    expect(await rating(ids[0]!)).toBeUndefined();
  });

  it('halves points after 3 matches with the same opponent in a day, then stops them at 6', async () => {
    const changes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const m = singles({}, 0, 1);
      m.endedAt = new Date(T0 + i * 10 * 60_000);
      m.createdAt = new Date(T0 + i * 10 * 60_000 - 1000);
      const r = await history.recordMatch(m);
      changes.push(r.ratingUpdates.find((u) => u.accountId === ids[0])!.change);
      if (i === 3) expect(r.ratingUpdates[0]!.farmingLimited).toBe(true);
    }
    // first three at full weight (a winner keeps gaining a bit less as the gap grows), then half, then nothing
    expect(changes[3]!).toBeLessThan(changes[0]!);
    expect(changes.slice(3, 6).every((c) => c > 0)).toBe(true);
    expect(changes[6]).toBe(0);
  });

  it('forgets old meetings after a day', async () => {
    for (let i = 0; i < 6; i++) {
      const m = singles({}, 0, 1);
      m.endedAt = new Date(T0 + i * 60_000);
      m.createdAt = new Date(T0 + i * 60_000 - 1000);
      await history.recordMatch(m);
    }
    const later = singles({}, 0, 1);
    later.endedAt = new Date(T0 + 25 * HOUR);
    later.createdAt = new Date(T0 + 25 * HOUR - 1000);
    const r = await history.recordMatch(later);
    expect(r.ratingUpdates[0]!.farmingLimited).toBe(false);
    expect(r.ratingUpdates.find((u) => u.accountId === ids[0])!.change).toBeGreaterThan(0);
  });

  it('a different opponent is not counted as farming', async () => {
    for (let i = 0; i < 6; i++) {
      const m = singles({}, 0, 1);
      m.endedAt = new Date(T0 + i * 60_000);
      m.createdAt = new Date(T0 + i * 60_000 - 1000);
      await history.recordMatch(m);
    }
    const other = singles({}, 0, 2);
    other.endedAt = new Date(T0 + 10 * 60_000);
    other.createdAt = new Date(T0 + 10 * 60_000 - 1000);
    const r = await history.recordMatch(other);
    expect(r.ratingUpdates[0]!.farmingLimited).toBe(false);
  });

  describe('teams', () => {
    const duo = async (a: number, b: number) => {
      const [x, y, key] = duoKey(ids[a]!, ids[b]!);
      const row = (await db.query<{ rating: number; games: number; wins: number; member_a: string; member_b: string }>('SELECT * FROM duo_ratings WHERE duo_key = $1', [key])).rows[0];
      return { row, x, y };
    };

    it('rates the pair, gives both partners the same change, and leaves singles alone', async () => {
      const r = await history.recordMatch(teams());
      expect(r.ratingUpdates).toHaveLength(4);
      for (const id of [ids[0], ids[1]]) expect(r.ratingUpdates.find((u) => u.accountId === id)).toMatchObject({ mode: 'teams', before: 1200, after: 1220 });
      for (const id of [ids[2], ids[3]]) expect(r.ratingUpdates.find((u) => u.accountId === id)).toMatchObject({ before: 1200, after: 1180 });
      const win = await duo(0, 1);
      expect(win.row).toMatchObject({ rating: 1220, games: 1, wins: 1, member_a: win.x, member_b: win.y });
      expect((await duo(2, 3)).row).toMatchObject({ rating: 1180 });
      expect(await rating(ids[0]!)).toBeUndefined();
    });

    it('the same two people are one duo whichever seat they sit in', async () => {
      await history.recordMatch(teams());
      await history.recordMatch(teams({}, [1, 0], [3, 2]));
      expect((await duo(0, 1)).row).toMatchObject({ games: 2 });
      expect((await db.query('SELECT 1 FROM duo_ratings')).rows).toHaveLength(2);
    });

    it('a different partner is a different duo with its own rating', async () => {
      await history.recordMatch(teams());
      await history.recordMatch(teams({}, [0, 2], [1, 3]));
      expect((await db.query('SELECT 1 FROM duo_ratings')).rows).toHaveLength(4);
    });

    it('starts a new duo from the average of its members\' singles ratings', async () => {
      await history.recordMatch(singles()); // one: 1220, two: 1180
      await history.recordMatch(singles({}, 0, 2)); // one: ~1239, three: ~1181
      const one = (await rating(ids[0]!))!.rating;
      const two = (await rating(ids[1]!))!.rating;
      const r = await history.recordMatch(teams({}, [0, 1], [2, 3]));
      const seeded = seedDuoRating(one, two);
      expect(r.ratingUpdates.find((u) => u.accountId === ids[0])!.before).toBe(seeded);
    });

    it('needs four different people', async () => {
      const m = teams({}, [0, 0], [2, 3]);
      const r = await history.recordMatch(m).catch(() => null);
      expect(r === null || r.ratingUpdates.length === 0).toBe(true);
    });
  });
});
