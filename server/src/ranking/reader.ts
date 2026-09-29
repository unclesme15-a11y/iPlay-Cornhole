import type { Db } from '../db/types.js';
import { START_RATING, seedDuoRating } from './elo.js';
import { duoKey, type RankedMode } from './ratings.js';

/** A player needs this many rated games before they appear on a leaderboard. */
export const MIN_GAMES_FOR_BOARD = 10;
/** Players who have not played a ranked game for this long drop off the board (their rating is kept). */
export const ACTIVE_WINDOW_MS = 90 * 24 * 3600_000;

export interface Standing {
  rating: number;
  peak: number;
  games: number;
  wins: number;
  losses: number;
  streak: number;
}

export interface BoardEntry extends Standing {
  rank: number;
  /** Singles: the player. Teams: both partners. */
  members: Array<{ accountId: string; displayName: string }>;
}

export interface BoardPage {
  mode: RankedMode;
  entries: BoardEntry[];
  /** How many players (or duos) are on the board in total. */
  total: number;
  minGames: number;
  activeDays: number;
}

export interface MyBoardPosition {
  /** Singles: one item. Teams: one per duo they belong to and are ranked in. */
  standings: Array<{
    members: Array<{ accountId: string; displayName: string }>;
    rating: number;
    games: number;
    rank: number | null;
    /** Games still needed before a rank shows (0 if enough). */
    gamesNeeded: number;
    /** True if they do not show because of "hide me" or being inactive. */
    hiddenReason: 'opted_out' | 'inactive' | null;
    neighbours: BoardEntry[];
  }>;
}

interface Row {
  key: string;
  member_a: string;
  name_a: string;
  member_b: string | null;
  name_b: string | null;
  rating: number;
  peak: number;
  games: number;
  wins: number;
  losses: number;
  streak: number;
  pos: string | number;
}

/** Reads ratings and leaderboards. Everything here is read-only. */
export class RatingsReader {
  private cache = new Map<string, { at: number; page: BoardPage }>();

  constructor(
    private readonly db: Db,
    private readonly now: () => number,
    private readonly cacheMs = 10_000,
  ) {}

  /** Forget cached leaderboard pages (call after ratings change). */
  invalidate(): void {
    this.cache.clear();
  }

  async singles(accountId: string): Promise<Standing> {
    const res = await this.db.query<Standing>('SELECT rating, peak, games, wins, losses, streak FROM singles_ratings WHERE account_id = $1', [accountId]);
    return res.rows[0] ?? { rating: START_RATING, peak: START_RATING, games: 0, wins: 0, losses: 0, streak: 0 };
  }

  /** A pair's rating. A pair that has never played starts from its members' singles ratings. */
  async duo(a: string, b: string): Promise<Standing> {
    const [x, y, key] = duoKey(a, b);
    const res = await this.db.query<Standing>('SELECT rating, peak, games, wins, losses, streak FROM duo_ratings WHERE duo_key = $1', [key]);
    if (res.rows[0]) return res.rows[0];
    const [sx, sy] = await Promise.all([this.singles(x), this.singles(y)]);
    const seed = seedDuoRating(sx.rating, sy.rating);
    return { rating: seed, peak: seed, games: 0, wins: 0, losses: 0, streak: 0 };
  }

  /** Every duo this player belongs to, best first. */
  async duosOf(accountId: string): Promise<Array<Standing & { partner: { accountId: string; displayName: string } }>> {
    const res = await this.db.query<Standing & { partner_id: string; partner_name: string }>(
      `SELECT d.rating, d.peak, d.games, d.wins, d.losses, d.streak, p.id AS partner_id, p.display_name AS partner_name
         FROM duo_ratings d JOIN accounts p ON p.id = CASE WHEN d.member_a = $1 THEN d.member_b ELSE d.member_a END
        WHERE d.member_a = $1 OR d.member_b = $1 ORDER BY d.rating DESC, d.games DESC`,
      [accountId],
    );
    return res.rows.map(({ partner_id, partner_name, ...s }) => ({ ...s, partner: { accountId: partner_id, displayName: partner_name } }));
  }

  private eligibleSql(mode: RankedMode): string {
    // Who counts: enough games, played recently, has not opted out, and is not banned right now.
    const visible = (alias: string) =>
      `${alias}.show_on_leaderboards AND NOT (${alias}.status = 'banned' AND (${alias}.banned_until IS NULL OR ${alias}.banned_until > $3))`;
    if (mode === 'singles') {
      return `SELECT sr.account_id AS key, sr.account_id AS member_a, a.display_name AS name_a, NULL::text AS member_b, NULL::text AS name_b,
                     sr.rating, sr.peak, sr.games, sr.wins, sr.losses, sr.streak,
                     row_number() OVER (ORDER BY sr.rating DESC, sr.games DESC, sr.account_id) AS pos
                FROM singles_ratings sr JOIN accounts a ON a.id = sr.account_id
               WHERE sr.games >= $1 AND sr.last_played_at >= $2 AND ${visible('a')}`;
    }
    return `SELECT d.duo_key AS key, d.member_a, a.display_name AS name_a, d.member_b, b.display_name AS name_b,
                   d.rating, d.peak, d.games, d.wins, d.losses, d.streak,
                   row_number() OVER (ORDER BY d.rating DESC, d.games DESC, d.duo_key) AS pos
              FROM duo_ratings d JOIN accounts a ON a.id = d.member_a JOIN accounts b ON b.id = d.member_b
             WHERE d.games >= $1 AND d.last_played_at >= $2 AND ${visible('a')} AND ${visible('b')}`;
  }

  private params(): [number, Date, Date] {
    const now = this.now();
    return [MIN_GAMES_FOR_BOARD, new Date(now - ACTIVE_WINDOW_MS), new Date(now)];
  }

  private toEntry(r: Row): BoardEntry {
    const members = [{ accountId: r.member_a, displayName: r.name_a }];
    if (r.member_b && r.name_b) members.push({ accountId: r.member_b, displayName: r.name_b });
    return { rank: Number(r.pos), members, rating: r.rating, peak: r.peak, games: r.games, wins: r.wins, losses: r.losses, streak: r.streak };
  }

  /** One page of the leaderboard, best first. Cached for a few seconds. */
  async top(mode: RankedMode, limit = 50, offset = 0): Promise<BoardPage> {
    const cacheKey = `${mode}:${limit}:${offset}`;
    const hit = this.cache.get(cacheKey);
    if (hit && this.now() - hit.at < this.cacheMs) return hit.page;
    const eligible = this.eligibleSql(mode);
    const [rows, total] = await Promise.all([
      this.db.query<Row>(`WITH e AS (${eligible}) SELECT * FROM e WHERE pos > $4 AND pos <= $5 ORDER BY pos`, [...this.params(), offset, offset + limit]),
      this.db.query<{ n: string | number }>(`WITH e AS (${eligible}) SELECT count(*) AS n FROM e`, this.params()),
    ]);
    const page: BoardPage = {
      mode,
      entries: rows.rows.map((r) => this.toEntry(r)),
      total: Number(total.rows[0]?.n ?? 0),
      minGames: MIN_GAMES_FOR_BOARD,
      activeDays: ACTIVE_WINDOW_MS / (24 * 3600_000),
    };
    this.cache.set(cacheKey, { at: this.now(), page });
    if (this.cache.size > 200) this.cache.clear();
    return page;
  }

  /** Where one player stands: their rank and the players just above and below them. */
  async mine(mode: RankedMode, accountId: string, around = 2): Promise<MyBoardPosition> {
    const eligible = this.eligibleSql(mode);
    const acct = await this.db.query<{ show_on_leaderboards: boolean }>('SELECT show_on_leaderboards FROM accounts WHERE id = $1', [accountId]);
    const optedOut = acct.rows[0] ? !acct.rows[0].show_on_leaderboards : false;
    const cutoff = new Date(this.now() - ACTIVE_WINDOW_MS);

    type Mine = { key: string; members: Array<{ accountId: string; displayName: string }>; standing: Standing; lastPlayed: Date };
    const mine: Mine[] = [];
    if (mode === 'singles') {
      const r = await this.db.query<Standing & { last_played_at: Date; display_name: string }>(
        `SELECT sr.rating, sr.peak, sr.games, sr.wins, sr.losses, sr.streak, sr.last_played_at, a.display_name
           FROM singles_ratings sr JOIN accounts a ON a.id = sr.account_id WHERE sr.account_id = $1`,
        [accountId],
      );
      if (r.rows[0]) mine.push({ key: accountId, members: [{ accountId, displayName: r.rows[0].display_name }], standing: r.rows[0], lastPlayed: r.rows[0].last_played_at });
    } else {
      const r = await this.db.query<Standing & { duo_key: string; last_played_at: Date; ida: string; na: string; idb: string; nb: string }>(
        `SELECT d.duo_key, d.rating, d.peak, d.games, d.wins, d.losses, d.streak, d.last_played_at,
                a.id AS ida, a.display_name AS na, b.id AS idb, b.display_name AS nb
           FROM duo_ratings d JOIN accounts a ON a.id = d.member_a JOIN accounts b ON b.id = d.member_b
          WHERE d.member_a = $1 OR d.member_b = $1 ORDER BY d.rating DESC, d.games DESC`,
        [accountId],
      );
      for (const x of r.rows) mine.push({ key: x.duo_key, members: [{ accountId: x.ida, displayName: x.na }, { accountId: x.idb, displayName: x.nb }], standing: x, lastPlayed: x.last_played_at });
    }

    const standings: MyBoardPosition['standings'] = [];
    for (const m of mine) {
      const pos = await this.db.query<Row>(`WITH e AS (${eligible}) SELECT * FROM e WHERE key = $4`, [...this.params(), m.key]);
      const row = pos.rows[0];
      const inactive = m.lastPlayed < cutoff;
      const base = { members: m.members, rating: m.standing.rating, games: m.standing.games };
      if (!row) {
        standings.push({
          ...base,
          rank: null,
          gamesNeeded: Math.max(0, MIN_GAMES_FOR_BOARD - m.standing.games),
          hiddenReason: m.standing.games >= MIN_GAMES_FOR_BOARD ? (optedOut ? 'opted_out' : inactive ? 'inactive' : null) : null,
          neighbours: [],
        });
        continue;
      }
      const rank = Number(row.pos);
      const near = await this.db.query<Row>(`WITH e AS (${eligible}) SELECT * FROM e WHERE pos >= $4 AND pos <= $5 ORDER BY pos`, [...this.params(), Math.max(1, rank - around), rank + around]);
      standings.push({ ...base, rank, gamesNeeded: 0, hiddenReason: null, neighbours: near.rows.map((r) => this.toEntry(r)) });
    }
    return { standings };
  }
}
