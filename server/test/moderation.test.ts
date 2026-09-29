import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MatchHistory, type MatchSummary, type PlayerSummary } from '../src/accounts/history.js';
import { ModerationService } from '../src/accounts/moderation.js';
import { AccountService } from '../src/accounts/service.js';
import { DEFAULT_CONFIG } from '../src/core/types.js';
import type { Db } from '../src/db/types.js';
import { backends, type TestDb } from './helpers/db.js';

const T0 = 1_800_000_000_000;
const HOUR = 60 * 60_000;

describe.each(backends)('moderation and history ($name)', (backend) => {
  let handle: TestDb;
  let db: Db;
  let now = T0;
  let accounts: AccountService;
  let mod: ModerationService;
  let history: MatchHistory;

  beforeAll(async () => {
    handle = await backend.open();
    db = handle.db;
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await db.exec('TRUNCATE accounts, matches, live_matches, reports RESTART IDENTITY CASCADE');
    now = T0;
    accounts = new AccountService(db, () => now);
    mod = new ModerationService(db, () => now);
    history = new MatchHistory(db);
  });

  describe('blocks', () => {
    it('blocks, lists and unblocks, and blocking twice is harmless', async () => {
      const a = await accounts.createGuest('Alice A');
      const b = await accounts.createGuest('Bobby B');
      await mod.block(a.id, b.id);
      await mod.block(a.id, b.id);
      const list = await mod.listBlocks(a.id);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ accountId: b.id, displayName: 'Bobby B' });
      expect(await mod.listBlocks(b.id)).toHaveLength(0); // it is one-way
      await mod.unblock(a.id, b.id);
      expect(await mod.listBlocks(a.id)).toHaveLength(0);
    });

    it('cannot block yourself or someone who does not exist', async () => {
      const a = await accounts.createGuest();
      await expect(mod.block(a.id, a.id)).rejects.toMatchObject({ status: 400 });
      await expect(mod.block(a.id, 'ghost')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('reports', () => {
    it('files a report with a trimmed note', async () => {
      const a = await accounts.createGuest();
      const b = await accounts.createGuest();
      const r = await mod.report({ reporterId: a.id, reportedId: b.id, matchId: 'ABCD2345', reason: 'harassment', note: `  ${'x'.repeat(600)}  ` });
      expect(r).toMatchObject({ reporterId: a.id, reportedId: b.id, matchId: 'ABCD2345', reason: 'harassment', status: 'open' });
      expect(r.note).toHaveLength(500);
    });

    it('rejects self-reports, unknown players and unknown reasons', async () => {
      const a = await accounts.createGuest();
      const b = await accounts.createGuest();
      await expect(mod.report({ reporterId: a.id, reportedId: a.id, reason: 'other' })).rejects.toMatchObject({ status: 400 });
      await expect(mod.report({ reporterId: a.id, reportedId: 'ghost', reason: 'other' })).rejects.toMatchObject({ status: 404 });
      await expect(mod.report({ reporterId: a.id, reportedId: b.id, reason: 'boredom' as never })).rejects.toMatchObject({ status: 400 });
    });

    it('reporting the same player again while the first is open does not pile up duplicates', async () => {
      const a = await accounts.createGuest();
      const b = await accounts.createGuest();
      const first = await mod.report({ reporterId: a.id, reportedId: b.id, reason: 'cheating' });
      const again = await mod.report({ reporterId: a.id, reportedId: b.id, reason: 'harassment' });
      expect(again.id).toBe(first.id);
      expect((await db.query('SELECT 1 FROM reports')).rowCount).toBe(1);
    });

    it('limits how many reports one person can file in an hour', async () => {
      const a = await accounts.createGuest();
      const targets = await Promise.all(Array.from({ length: 11 }, () => accounts.createGuest()));
      for (const t of targets.slice(0, 10)) await mod.report({ reporterId: a.id, reportedId: t.id, reason: 'other' });
      await expect(mod.report({ reporterId: a.id, reportedId: targets[10]!.id, reason: 'other' })).rejects.toMatchObject({ code: 'too_many_reports', status: 429 });
      now += HOUR + 1;
      await expect(mod.report({ reporterId: a.id, reportedId: targets[10]!.id, reason: 'other' })).resolves.toBeTruthy();
    });

    it('lists open reports oldest first, and resolves or dismisses them once', async () => {
      const a = await accounts.createGuest('Reporter One');
      const b = await accounts.createGuest('Reported One');
      const c = await accounts.createGuest('Reported Two');
      const r1 = await mod.report({ reporterId: a.id, reportedId: b.id, reason: 'cheating' });
      now += 1000;
      const r2 = await mod.report({ reporterId: a.id, reportedId: c.id, reason: 'other' });
      const open = await mod.listReports('open');
      expect(open.map((r) => r.id)).toEqual([r1.id, r2.id]);
      expect(open[0]).toMatchObject({ reporterName: 'Reporter One', reportedName: 'Reported One' });
      expect((await mod.resolveReport(r1.id, 'resolved')).status).toBe('resolved');
      await expect(mod.resolveReport(r1.id, 'dismissed')).rejects.toMatchObject({ code: 'report_not_found' });
      await mod.resolveReport(r2.id, 'dismissed');
      expect(await mod.listReports('open')).toHaveLength(0);
      expect(await mod.listReports('all')).toHaveLength(2);
      expect(await mod.listReports('dismissed')).toHaveLength(1);
    });
  });

  describe('match history and stats', () => {
    const player = (over: Partial<PlayerSummary>): PlayerSummary => ({
      seat: 'A1', team: 'A', accountId: null, displayName: 'X', kind: 'human', botLevel: null, characterId: 'keisha',
      leftEarly: false, throws: 8, holes: 2, boards: 3, fouls: 1, ...over,
    });
    const summary = (players: PlayerSummary[], over: Partial<MatchSummary> = {}): MatchSummary => ({
      code: 'ABCD2345', config: { ...DEFAULT_CONFIG, mode: '1v1' }, createdAt: new Date(now - 600_000), startedAt: new Date(now - 590_000),
      endedAt: new Date(now), outcome: 'score', winner: 'A', scores: { A: 21, B: 9 }, innings: 8, rematchOf: null, players, ...over,
    });

    it('records a finished match and updates winner and loser stats', async () => {
      const w = await accounts.createGuest('Winner W');
      const l = await accounts.createGuest('Loser L');
      await history.record(summary([player({ accountId: w.id, displayName: 'Winner W' }), player({ seat: 'B1', team: 'B', accountId: l.id, displayName: 'Loser L', throws: 8, holes: 0, boards: 1, fouls: 4 })]));
      expect(await history.stats(w.id)).toEqual({ games: 1, wins: 1, losses: 0, leaves: 0, throws: 8, holes: 2, boards: 3, fouls: 1 });
      expect(await history.stats(l.id)).toEqual({ games: 1, wins: 0, losses: 1, leaves: 0, throws: 8, holes: 0, boards: 1, fouls: 4 });
    });

    it('adds up over several matches', async () => {
      const w = await accounts.createGuest('Winner W');
      for (let i = 0; i < 3; i++) await history.record(summary([player({ accountId: w.id })], { endedAt: new Date(now + i * 1000) }));
      expect(await history.stats(w.id)).toMatchObject({ games: 3, wins: 3, throws: 24, holes: 6 });
    });

    it('a player who left early gets a leave, and no win or loss even if their team won', async () => {
      const quitter = await accounts.createGuest('Quitter Q');
      await history.record(summary([player({ accountId: quitter.id, leftEarly: true, throws: 3, holes: 1, boards: 0, fouls: 0 })]));
      expect(await history.stats(quitter.id)).toMatchObject({ games: 0, wins: 0, losses: 0, leaves: 1, throws: 3, holes: 1 });
    });

    it('an abandoned match is kept in history but changes nobody\'s stats', async () => {
      const p = await accounts.createGuest('Player P');
      await history.record(summary([player({ accountId: p.id })], { outcome: 'abandoned', winner: null, scores: { A: 3, B: 2 } }));
      expect(await history.stats(p.id)).toMatchObject({ games: 0, throws: 0 });
      expect(await history.recent(p.id)).toHaveLength(1);
    });

    it('bots and deleted accounts do not get stats, and a deleted account is stored as anonymous', async () => {
      const gone = await accounts.createGuest('Ghost G');
      await accounts.delete(gone.id);
      const id = await history.record(summary([player({ accountId: gone.id, displayName: 'Ghost G' }), player({ seat: 'B1', team: 'B', kind: 'bot', botLevel: 'pro', displayName: 'Dre' })]));
      const rows = await db.query<{ seat: string; account_id: string | null; display_name: string }>('SELECT seat, account_id, display_name FROM match_players WHERE match_id = $1 ORDER BY seat', [id]);
      expect(rows.rows[0]).toMatchObject({ account_id: null, display_name: 'Deleted player' });
      expect(rows.rows[1]).toMatchObject({ display_name: 'Dre' });
      expect((await db.query('SELECT 1 FROM player_stats')).rowCount).toBe(0);
    });

    it('is all or nothing: a failure part-way through leaves no half-written match', async () => {
      const w = await accounts.createGuest('Winner W');
      const bad = player({ accountId: w.id });
      (bad as { seat: unknown }).seat = null; // violates NOT NULL
      await expect(history.record(summary([bad]))).rejects.toThrow();
      expect((await db.query('SELECT 1 FROM matches')).rowCount).toBe(0);
      expect(await history.stats(w.id)).toMatchObject({ games: 0 });
    });

    it('lists recent matches newest first with all players, and pages with `before`', async () => {
      const p = await accounts.createGuest('Player P');
      for (let i = 0; i < 5; i++) {
        await history.record(summary([player({ accountId: p.id }), player({ seat: 'B1', team: 'B', kind: 'bot', botLevel: 'regular', displayName: 'Bot' })], { code: `CODE000${i}`, endedAt: new Date(T0 + i * 60_000) }));
      }
      const page1 = await history.recent(p.id, 2);
      expect(page1.map((m) => m.code)).toEqual(['CODE0004', 'CODE0003']);
      expect(page1[0]!.players).toHaveLength(2);
      const page2 = await history.recent(p.id, 2, page1[1]!.endedAt);
      expect(page2.map((m) => m.code)).toEqual(['CODE0002', 'CODE0001']);
      const other = await accounts.createGuest('Other O');
      expect(await history.recent(other.id)).toEqual([]);
    });

    it('has zero stats for a player who has not played', async () => {
      const p = await accounts.createGuest();
      expect(await history.stats(p.id)).toEqual({ games: 0, wins: 0, losses: 0, leaves: 0, throws: 0, holes: 0, boards: 0, fouls: 0 });
    });
  });
});
