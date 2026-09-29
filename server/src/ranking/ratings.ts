import type { Queryable } from '../db/types.js';
import type { MatchSummary, PlayerSummary } from '../accounts/history.js';
import type { TeamId } from '../core/types.js';
import { START_RATING, farmingWeight, ratingChange, seedDuoRating } from './elo.js';

export type RankedMode = 'singles' | 'teams';

/** What one player's rating did in one ranked match. For teams, this is their duo's rating. */
export interface RatingUpdate {
  accountId: string;
  mode: RankedMode;
  before: number;
  after: number;
  change: number;
  /** True if points were reduced or withheld because these players met a lot in the last day. */
  farmingLimited: boolean;
  /** Games played at this rating including this one (provisional until 10). */
  games: number;
}

export interface RatingResult {
  voided: boolean;
  voidReason: string | null;
  updates: RatingUpdate[];
}

interface Stat {
  rating: number;
  peak: number;
  games: number;
  wins: number;
  losses: number;
  streak: number;
}

const FARM_WINDOW_MS = 24 * 3600_000;

/** Plain string order, the same everywhere (unlike database collations). */
export const duoKey = (a: string, b: string): [string, string, string] => {
  const [x, y] = a < b ? [a, b] : [b, a];
  return [x, y, `${x}:${y}`];
};

/** Why a ranked match must not change anyone's rating, or null if it counts. */
export function voidReason(s: MatchSummary): string | null {
  if (s.outcome === 'abandoned' || s.winner === null) return 'abandoned';
  if (s.players.some((p) => p.kind !== 'human' || p.accountId === null)) return 'not_all_human';
  if (s.players.reduce((n, p) => n + p.throws, 0) === 0) return 'no_throws';
  return null;
}

/** Works out and stores rating changes. Always called inside the transaction that saves the match. */
export class RatingService {
  /**
   * Reads and updates the ratings for one finished ranked match. Every rating row is locked first, in
   * a fixed order, so two matches ending at once cannot lose each other's changes.
   */
  async apply(tx: Queryable, summary: MatchSummary): Promise<RatingResult> {
    const mode = summary.ranked;
    if (!mode) return { voided: false, voidReason: null, updates: [] };
    const reason = voidReason(summary);
    if (reason) return { voided: true, voidReason: reason, updates: [] };
    return mode === 'singles' ? this.applySingles(tx, summary) : this.applyTeams(tx, summary);
  }

  private teamPlayers(s: MatchSummary, team: TeamId): PlayerSummary[] {
    return s.players.filter((p) => p.team === team);
  }

  private async recentMeetings(tx: Queryable, mode: RankedMode, ids: string[], before: Date, excludeCode: string): Promise<number> {
    const res = await tx.query<{ n: string | number }>(
      `SELECT count(*) AS n FROM matches m
        WHERE m.ranked = $1 AND NOT m.voided AND m.ended_at > $2 AND m.ended_at <= $3 AND m.code <> $4
          AND (SELECT count(DISTINCT mp.account_id) FROM match_players mp WHERE mp.match_id = m.id AND mp.account_id = ANY($5::text[])) = $6`,
      [mode, new Date(before.getTime() - FARM_WINDOW_MS), before, excludeCode, ids, ids.length],
    );
    return Number(res.rows[0]?.n ?? 0);
  }

  private async applySingles(tx: Queryable, s: MatchSummary): Promise<RatingResult> {
    const [a, b] = [this.teamPlayers(s, 'A')[0], this.teamPlayers(s, 'B')[0]];
    if (!a?.accountId || !b?.accountId || a.accountId === b.accountId) return { voided: true, voidReason: 'bad_players', updates: [] };
    const ids = [a.accountId, b.accountId];
    for (const id of [...ids].sort()) {
      await tx.query(
        `INSERT INTO singles_ratings (account_id, rating, peak, last_played_at) VALUES ($1, $2, $2, $3) ON CONFLICT (account_id) DO NOTHING`,
        [id, START_RATING, s.endedAt],
      );
    }
    const rows = await tx.query<{ account_id: string } & Stat>(
      `SELECT account_id, rating, peak, games, wins, losses, streak FROM singles_ratings WHERE account_id = ANY($1::text[]) ORDER BY account_id FOR UPDATE`,
      [ids],
    );
    const stat = new Map(rows.rows.map((r) => [r.account_id, r]));
    const recent = await this.recentMeetings(tx, 'singles', ids, s.endedAt, s.code);
    const weight = farmingWeight(recent);
    const updates: RatingUpdate[] = [];
    for (const [me, opp, team] of [[a, b, 'A'], [b, a, 'B']] as const) {
      const mine = stat.get(me.accountId!)!;
      const theirs = stat.get(opp.accountId!)!;
      const won = s.winner === team;
      const change = ratingChange(mine.rating, theirs.rating, won ? 1 : 0, mine.games, weight);
      updates.push(await this.save(tx, 'singles_ratings', 'account_id', me.accountId!, mine, change, won, s.endedAt, 'singles', weight < 1));
    }
    return { voided: false, voidReason: null, updates };
  }

  private async applyTeams(tx: Queryable, s: MatchSummary): Promise<RatingResult> {
    const pa = this.teamPlayers(s, 'A');
    const pb = this.teamPlayers(s, 'B');
    if (pa.length !== 2 || pb.length !== 2) return { voided: true, voidReason: 'bad_players', updates: [] };
    const all = [...pa, ...pb].map((p) => p.accountId!);
    if (new Set(all).size !== 4) return { voided: true, voidReason: 'bad_players', updates: [] };
    const duos = { A: duoKey(pa[0]!.accountId!, pa[1]!.accountId!), B: duoKey(pb[0]!.accountId!, pb[1]!.accountId!) };

    // a brand new duo starts from its members' singles ratings
    const singles = await tx.query<{ account_id: string; rating: number }>(
      'SELECT account_id, rating FROM singles_ratings WHERE account_id = ANY($1::text[])',
      [all],
    );
    const single = (id: string): number => singles.rows.find((r) => r.account_id === id)?.rating ?? START_RATING;
    const keys = [duos.A, duos.B].sort((x, y) => (x[2] < y[2] ? -1 : 1));
    for (const [x, y, key] of keys) {
      await tx.query(
        `INSERT INTO duo_ratings (duo_key, member_a, member_b, rating, peak, last_played_at) VALUES ($1, $2, $3, $4, $4, $5) ON CONFLICT (duo_key) DO NOTHING`,
        [key, x, y, seedDuoRating(single(x), single(y)), s.endedAt],
      );
    }
    const rows = await tx.query<{ duo_key: string } & Stat>(
      `SELECT duo_key, rating, peak, games, wins, losses, streak FROM duo_ratings WHERE duo_key = ANY($1::text[]) ORDER BY duo_key FOR UPDATE`,
      [[duos.A[2], duos.B[2]]],
    );
    const stat = new Map(rows.rows.map((r) => [r.duo_key, r]));
    const recent = await this.recentMeetings(tx, 'teams', all, s.endedAt, s.code);
    const weight = farmingWeight(recent);
    const updates: RatingUpdate[] = [];
    for (const team of ['A', 'B'] as const) {
      const other = team === 'A' ? 'B' : 'A';
      const mine = stat.get(duos[team][2])!;
      const theirs = stat.get(duos[other][2])!;
      const won = s.winner === team;
      const change = ratingChange(mine.rating, theirs.rating, won ? 1 : 0, mine.games, weight);
      const u = await this.save(tx, 'duo_ratings', 'duo_key', duos[team][2], mine, change, won, s.endedAt, 'teams', weight < 1);
      for (const p of team === 'A' ? pa : pb) updates.push({ ...u, accountId: p.accountId! });
    }
    return { voided: false, voidReason: null, updates };
  }

  private async save(
    tx: Queryable,
    table: 'singles_ratings' | 'duo_ratings',
    keyColumn: 'account_id' | 'duo_key',
    key: string,
    before: Stat,
    change: number,
    won: boolean,
    at: Date,
    mode: RankedMode,
    farmingLimited: boolean,
  ): Promise<RatingUpdate> {
    const after = before.rating + change;
    const streak = won ? (before.streak > 0 ? before.streak + 1 : 1) : before.streak < 0 ? before.streak - 1 : -1;
    await tx.query(
      `UPDATE ${table} SET rating = $2, peak = $3, games = games + 1, wins = wins + $4, losses = losses + $5, streak = $6, last_played_at = $7 WHERE ${keyColumn} = $1`,
      [key, after, Math.max(before.peak, after), won ? 1 : 0, won ? 0 : 1, streak, at],
    );
    return { accountId: keyColumn === 'account_id' ? key : '', mode, before: before.rating, after, change, farmingLimited, games: before.games + 1 };
  }
}
