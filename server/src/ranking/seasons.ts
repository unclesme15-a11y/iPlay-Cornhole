import type { Db, Queryable } from '../db/types.js';
import type { Scheduler } from '../lobby/scheduler.js';
import type { LogFn } from '../store/registry.js';
import { START_RATING } from './elo.js';
import { ACTIVE_WINDOW_MS, MIN_GAMES_FOR_BOARD } from './reader.js';
import type { RankedMode } from './ratings.js';

/**
 * Ranked seasons. A season lasts a fixed number of months (3 by default, starting on SEASON_ONE_START). When a season
 * ends, the final standings are saved for good (season_results) and every rating gets a soft reset: it moves part of
 * the way back to the starting rating, and the season's games, wins, losses and streak start again from zero, so
 * everyone needs their 10 games again to appear on the new board.
 *
 * Example: with the default 0.5, a 1600 player starts the next season at 1400 and a 1000 player at 1100.
 * Live ranked matches are not interrupted: a match that ends after the rollover counts for the new season.
 */

export interface SeasonSettings {
  /** When season 1 starts (UTC). Before this date it is still season 1. */
  firstStart: Date;
  lengthMonths: number;
  /** How much of the distance from the starting rating is kept at a reset (0 = everyone back to 1200, 1 = no reset). */
  keep: number;
}

export interface SeasonInfo {
  number: number;
  name: string;
  startsAt: string;
  endsAt: string;
}

export interface SeasonStanding {
  rank: number;
  members: Array<{ accountId: string | null; displayName: string }>;
  rating: number;
  peak: number;
  games: number;
  wins: number;
  losses: number;
}

export interface MySeasonResult {
  season: number;
  name: string;
  mode: RankedMode;
  /** Null if they played but did not qualify for the board (too few games, hidden, or inactive). */
  rank: number | null;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  partner: { accountId: string | null; displayName: string } | null;
}

const addMonthsUtc = (d: Date, months: number): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));

export function seasonStart(s: SeasonSettings, n: number): Date {
  return addMonthsUtc(s.firstStart, (n - 1) * s.lengthMonths);
}

/** The season a moment falls in (season 1 for anything before the first start). */
export function seasonNumberAt(s: SeasonSettings, t: number): number {
  if (t < s.firstStart.getTime()) return 1;
  const d = new Date(t);
  let n = Math.floor(((d.getUTCFullYear() - s.firstStart.getUTCFullYear()) * 12 + d.getUTCMonth() - s.firstStart.getUTCMonth()) / s.lengthMonths) + 1;
  // the month arithmetic can be one off at the edges (day of month, time of day): settle it exactly
  while (n > 1 && seasonStart(s, n).getTime() > t) n--;
  while (seasonStart(s, n + 1).getTime() <= t) n++;
  return n;
}

export const softReset = (rating: number, keep: number): number => Math.round(START_RATING + (rating - START_RATING) * keep);

const info = (n: number, startsAt: Date, endsAt: Date): SeasonInfo => ({
  number: n,
  name: `Season ${n}`,
  startsAt: new Date(startsAt).toISOString(),
  endsAt: new Date(endsAt).toISOString(),
});

export class SeasonService {
  private cancel: (() => void) | null = null;
  /** Called after a season closes (for alerts, notifications, cache resets). */
  onSeasonClosed: ((season: SeasonInfo) => void) | null = null;

  constructor(
    private readonly db: Db,
    private readonly sched: Scheduler,
    readonly settings: SeasonSettings,
    private readonly log: LogFn = () => undefined,
  ) {}

  /** The season the clock says it is (not necessarily rolled over in the database yet; that happens within the hour). */
  current(): SeasonInfo {
    const n = seasonNumberAt(this.settings, this.sched.now());
    return info(n, seasonStart(this.settings, n), seasonStart(this.settings, n + 1));
  }

  /**
   * Makes the database match the clock: creates the current season on first run, and closes every season that has
   * ended (one at a time, in order). Safe to call any number of times. Returns the seasons it closed.
   */
  async rollOver(): Promise<number[]> {
    const closed: number[] = [];
    const now = this.sched.now();
    const latest = await this.db.query<{ number: number; ends_at: Date; closed_at: Date | null }>(
      'SELECT number, ends_at, closed_at FROM seasons ORDER BY number DESC LIMIT 1',
    );
    if (!latest.rows[0]) {
      // First run: start counting from the season it is now. Nothing before it is closed (there was no data).
      const n = seasonNumberAt(this.settings, now);
      await this.db.query('INSERT INTO seasons (number, starts_at, ends_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
        n,
        seasonStart(this.settings, n),
        seasonStart(this.settings, n + 1),
      ]);
      return closed;
    }
    let open = latest.rows[0];
    for (let guard = 0; guard < 100 && !open.closed_at && new Date(open.ends_at).getTime() <= now; guard++) {
      const n = open.number;
      const done = await this.db.transaction((tx) => this.close(tx, n));
      if (done) {
        closed.push(n);
        this.log('info', 'ranked season closed', { season: n });
        this.onSeasonClosed?.(info(n, seasonStart(this.settings, n), new Date(open.ends_at)));
      }
      const next = await this.db.query<{ number: number; ends_at: Date; closed_at: Date | null }>('SELECT number, ends_at, closed_at FROM seasons WHERE number = $1', [n + 1]);
      if (!next.rows[0]) break;
      open = next.rows[0];
    }
    return closed;
  }

  /** Closes one season inside a transaction: save the standings, soft-reset the ratings, open the next season. */
  private async close(tx: Queryable, n: number): Promise<boolean> {
    // Rating updates from matches ending right now wait for this to finish (it takes milliseconds).
    await tx.query('LOCK TABLE singles_ratings, duo_ratings IN SHARE ROW EXCLUSIVE MODE');
    const row = await tx.query<{ ends_at: Date; closed_at: Date | null }>('SELECT ends_at, closed_at FROM seasons WHERE number = $1 FOR UPDATE', [n]);
    if (!row.rows[0] || row.rows[0].closed_at) return false;
    const endsAt = new Date(row.rows[0].ends_at);
    const params = [n, MIN_GAMES_FOR_BOARD, new Date(endsAt.getTime() - ACTIVE_WINDOW_MS), endsAt];
    const visible = (a: string) => `(${a}.show_on_leaderboards AND NOT (${a}.status = 'banned' AND (${a}.banned_until IS NULL OR ${a}.banned_until > $4)))`;

    // Everyone who played this season gets a row (for their own history); only those who qualified get a rank.
    await tx.query(
      `WITH base AS (
         SELECT sr.account_id AS k, sr.account_id AS ma, a.display_name AS na, sr.rating, sr.peak, sr.games, sr.wins, sr.losses,
                (sr.games >= $2 AND sr.last_played_at >= $3 AND ${visible('a')}) AS ok
           FROM singles_ratings sr JOIN accounts a ON a.id = sr.account_id WHERE sr.games > 0)
       INSERT INTO season_results (season, mode, entry_key, member_a, name_a, member_b, name_b, rank, rating, peak, games, wins, losses)
       SELECT $1, 'singles', k, ma, na, NULL, NULL,
              CASE WHEN ok THEN row_number() OVER (PARTITION BY ok ORDER BY rating DESC, games DESC, k) END,
              rating, peak, games, wins, losses
         FROM base`,
      params,
    );
    await tx.query(
      `WITH base AS (
         SELECT d.duo_key AS k, d.member_a AS ma, a.display_name AS na, d.member_b AS mb, b.display_name AS nb,
                d.rating, d.peak, d.games, d.wins, d.losses,
                (d.games >= $2 AND d.last_played_at >= $3 AND ${visible('a')} AND ${visible('b')}) AS ok
           FROM duo_ratings d JOIN accounts a ON a.id = d.member_a JOIN accounts b ON b.id = d.member_b WHERE d.games > 0)
       INSERT INTO season_results (season, mode, entry_key, member_a, name_a, member_b, name_b, rank, rating, peak, games, wins, losses)
       SELECT $1, 'teams', k, ma, na, mb, nb,
              CASE WHEN ok THEN row_number() OVER (PARTITION BY ok ORDER BY rating DESC, games DESC, k) END,
              rating, peak, games, wins, losses
         FROM base`,
      params,
    );

    const keep = this.settings.keep;
    for (const table of ['singles_ratings', 'duo_ratings']) {
      await tx.query(
        `UPDATE ${table} SET rating = round(${START_RATING} + (rating - ${START_RATING}) * $1::numeric)::int,
                             peak = round(${START_RATING} + (rating - ${START_RATING}) * $1::numeric)::int,
                             games = 0, wins = 0, losses = 0, streak = 0`,
        [keep],
      );
    }
    await tx.query('UPDATE seasons SET closed_at = $2 WHERE number = $1', [n, new Date(this.sched.now())]);
    await tx.query('INSERT INTO seasons (number, starts_at, ends_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
      n + 1,
      seasonStart(this.settings, n + 1),
      seasonStart(this.settings, n + 2),
    ]);
    return true;
  }

  /** Every finished season, newest first. */
  async past(): Promise<SeasonInfo[]> {
    const res = await this.db.query<{ number: number; starts_at: Date; ends_at: Date }>(
      'SELECT number, starts_at, ends_at FROM seasons WHERE closed_at IS NOT NULL ORDER BY number DESC',
    );
    return res.rows.map((r) => info(r.number, r.starts_at, r.ends_at));
  }

  /** The final board of a finished season, best first. Null if that season has not finished. */
  async standings(mode: RankedMode, season: number, limit: number, offset: number): Promise<{ season: SeasonInfo; entries: SeasonStanding[]; total: number } | null> {
    const s = await this.db.query<{ number: number; starts_at: Date; ends_at: Date }>(
      'SELECT number, starts_at, ends_at FROM seasons WHERE number = $1 AND closed_at IS NOT NULL',
      [season],
    );
    if (!s.rows[0]) return null;
    const [rows, total] = await Promise.all([
      this.db.query<{ rank: number; member_a: string | null; name_a: string; member_b: string | null; name_b: string | null; rating: number; peak: number; games: number; wins: number; losses: number }>(
        `SELECT rank, member_a, name_a, member_b, name_b, rating, peak, games, wins, losses FROM season_results
          WHERE season = $1 AND mode = $2 AND rank IS NOT NULL AND rank > $3 ORDER BY rank LIMIT $4`,
        [season, mode, offset, limit],
      ),
      this.db.query<{ n: string | number }>('SELECT count(*) AS n FROM season_results WHERE season = $1 AND mode = $2 AND rank IS NOT NULL', [season, mode]),
    ]);
    return {
      season: info(s.rows[0].number, s.rows[0].starts_at, s.rows[0].ends_at),
      total: Number(total.rows[0]?.n ?? 0),
      entries: rows.rows.map((r) => ({
        rank: r.rank,
        members: [{ accountId: r.member_a, displayName: r.name_a }, ...(r.name_b !== null ? [{ accountId: r.member_b, displayName: r.name_b }] : [])],
        rating: r.rating,
        peak: r.peak,
        games: r.games,
        wins: r.wins,
        losses: r.losses,
      })),
    };
  }

  /** One player's finished seasons (singles, and every duo they played in), newest first. */
  async mine(accountId: string): Promise<MySeasonResult[]> {
    const res = await this.db.query<{
      season: number; starts_at: Date; mode: RankedMode; rank: number | null; rating: number; games: number; wins: number; losses: number;
      member_a: string | null; name_a: string; member_b: string | null; name_b: string | null;
    }>(
      `SELECT r.season, s.starts_at, r.mode, r.rank, r.rating, r.games, r.wins, r.losses, r.member_a, r.name_a, r.member_b, r.name_b
         FROM season_results r JOIN seasons s ON s.number = r.season
        WHERE r.member_a = $1 OR r.member_b = $1 ORDER BY r.season DESC, r.mode, r.rating DESC`,
      [accountId],
    );
    return res.rows.map((r) => ({
      season: r.season,
      name: `Season ${r.season}`,
      mode: r.mode,
      rank: r.rank,
      rating: r.rating,
      games: r.games,
      wins: r.wins,
      losses: r.losses,
      partner: r.mode === 'teams' ? (r.member_a === accountId ? { accountId: r.member_b, displayName: r.name_b ?? '' } : { accountId: r.member_a, displayName: r.name_a }) : null,
    }));
  }

  /** Checks every hour, and exactly when the season ends. */
  start(): void {
    if (this.cancel) return;
    const loop = (): void => {
      const untilEnd = new Date(this.current().endsAt).getTime() - this.sched.now();
      const wait = Math.max(1000, Math.min(60 * 60_000, untilEnd + 1000));
      this.cancel = this.sched.after(wait, () => {
        this.rollOver()
          .catch((error) => this.log('error', 'season rollover failed, will try again', { error: String(error) }))
          .finally(loop);
      });
    };
    void this.rollOver().catch((error) => this.log('error', 'season rollover failed, will try again', { error: String(error) }));
    loop();
  }

  stop(): void {
    this.cancel?.();
    this.cancel = null;
  }
}
