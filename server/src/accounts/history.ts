import { randomUUID } from 'node:crypto';
import type { Db, Queryable } from '../db/types.js';
import type { MatchConfig, TeamId } from '../core/types.js';
import { RatingService, voidReason, type RankedMode, type RatingUpdate } from '../ranking/ratings.js';

export interface PlayerSummary {
  seat: string;
  team: TeamId;
  accountId: string | null;
  displayName: string;
  kind: 'human' | 'bot';
  botLevel: string | null;
  characterId: string | null;
  leftEarly: boolean;
  throws: number;
  holes: number;
  boards: number;
  fouls: number;
}

export interface MatchSummary {
  code: string;
  config: MatchConfig;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date;
  outcome: 'score' | 'skunk' | 'forfeit' | 'abandoned';
  winner: TeamId | null;
  scores: Record<TeamId, number>;
  innings: number;
  rematchOf: string | null;
  /** Set for ranked matches (all seats human, fixed rules). Only these change ratings. */
  ranked?: RankedMode | null;
  players: PlayerSummary[];
}

/** What saving a match did. */
export interface RecordResult {
  id: string;
  /** True if this match was already saved (a retry or a repeat); nothing was changed the second time. */
  duplicate: boolean;
  /** Ranked only: true if the result does not count (nobody threw, or the match was abandoned). */
  voided: boolean;
  ratingUpdates: RatingUpdate[];
}

export interface PlayerStats {
  games: number;
  wins: number;
  losses: number;
  leaves: number;
  throws: number;
  holes: number;
  boards: number;
  fouls: number;
}

const ZERO_STATS: PlayerStats = { games: 0, wins: 0, losses: 0, leaves: 0, throws: 0, holes: 0, boards: 0, fouls: 0 };

export interface MatchRecord extends Omit<MatchSummary, 'players'> {
  id: string;
  players: PlayerSummary[];
}

interface MatchRow {
  id: string;
  code: string;
  config: MatchConfig;
  created_at: Date;
  started_at: Date | null;
  ended_at: Date;
  outcome: MatchSummary['outcome'];
  winner: TeamId | null;
  score_a: number;
  score_b: number;
  innings: number;
  rematch_of: string | null;
}

interface PlayerRow {
  match_id: string;
  seat: string;
  team: TeamId;
  account_id: string | null;
  display_name: string;
  kind: 'human' | 'bot';
  bot_level: string | null;
  character_id: string | null;
  left_early: boolean;
  throws: number;
  holes: number;
  boards: number;
  fouls: number;
}

/** Saves finished matches and keeps each player's running totals. */
export class MatchHistory {
  constructor(
    private readonly db: Db,
    private readonly ratings = new RatingService(),
  ) {}

  /**
   * Stores one finished (or abandoned) match and updates the humans' stats, all or nothing.
   * An abandoned match is kept in history but changes nobody's stats. In a finished match, someone
   * who left early gets a "leave" and no win or loss (a bot finished their game for them).
   */
  async record(summary: MatchSummary): Promise<string> {
    return (await this.recordMatch(summary)).id;
  }

  /**
   * Same as `record`, and for ranked matches also updates ratings in the same transaction. Saving the
   * same match twice (same code and start time) changes nothing the second time.
   */
  async recordMatch(summary: MatchSummary): Promise<RecordResult> {
    const id = randomUUID();
    const ranked = summary.ranked ?? null;
    const voided = ranked !== null && voidReason(summary) !== null;
    return this.db.transaction(async (tx): Promise<RecordResult> => {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO matches (id, code, config, created_at, started_at, ended_at, outcome, winner, score_a, score_b, innings, rematch_of, ranked, voided)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (code, created_at) DO NOTHING RETURNING id`,
        [id, summary.code, JSON.stringify(summary.config), summary.createdAt, summary.startedAt, summary.endedAt, summary.outcome, summary.winner, summary.scores.A, summary.scores.B, summary.innings, summary.rematchOf, ranked, voided],
      );
      if (inserted.rows.length === 0) {
        const existing = await tx.query<{ id: string; voided: boolean }>('SELECT id, voided FROM matches WHERE code = $1 AND created_at = $2', [summary.code, summary.createdAt]);
        return { id: existing.rows[0]!.id, duplicate: true, voided: existing.rows[0]!.voided, ratingUpdates: [] };
      }
      let someoneDeleted = false;
      for (const p of summary.players) {
        // an account that was deleted while the match ran is stored as an anonymous player
        const exists = p.accountId ? (await tx.query('SELECT 1 FROM accounts WHERE id = $1', [p.accountId])).rowCount > 0 : false;
        const accountId = exists ? p.accountId : null;
        if (p.kind === 'human' && !accountId) someoneDeleted = true;
        await tx.query(
          `INSERT INTO match_players (match_id, seat, team, account_id, display_name, kind, bot_level, character_id, left_early, throws, holes, boards, fouls)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [id, p.seat, p.team, accountId, accountId || p.kind === 'bot' ? p.displayName : 'Deleted player', p.kind, p.botLevel, p.characterId, p.leftEarly, p.throws, p.holes, p.boards, p.fouls],
        );
        if (accountId && summary.outcome !== 'abandoned') await this.addStats(tx, accountId, p, summary.winner);
      }
      let ratingUpdates: RatingUpdate[] = [];
      if (ranked && !voided && someoneDeleted) {
        // nobody's rating changes if one of the players erased their account mid-match
        await tx.query('UPDATE matches SET voided = true WHERE id = $1', [id]);
        return { id, duplicate: false, voided: true, ratingUpdates };
      }
      if (ranked && !voided) {
        const result = await this.ratings.apply(tx, summary);
        ratingUpdates = result.updates;
        if (result.voided) {
          await tx.query('UPDATE matches SET voided = true WHERE id = $1', [id]);
        }
        for (const u of ratingUpdates) {
          await tx.query('UPDATE match_players SET rating_before = $3, rating_after = $4 WHERE match_id = $1 AND account_id = $2', [id, u.accountId, u.before, u.after]);
        }
        return { id, duplicate: false, voided: result.voided, ratingUpdates };
      }
      return { id, duplicate: false, voided, ratingUpdates };
    });
  }

  private async addStats(tx: Queryable, accountId: string, p: PlayerSummary, winner: TeamId | null): Promise<void> {
    const played = !p.leftEarly;
    const won = played && winner === p.team;
    const lost = played && winner !== null && winner !== p.team;
    await tx.query(
      `INSERT INTO player_stats (account_id, games, wins, losses, leaves, throws, holes, boards, fouls, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (account_id) DO UPDATE SET
         games = player_stats.games + EXCLUDED.games, wins = player_stats.wins + EXCLUDED.wins,
         losses = player_stats.losses + EXCLUDED.losses, leaves = player_stats.leaves + EXCLUDED.leaves,
         throws = player_stats.throws + EXCLUDED.throws, holes = player_stats.holes + EXCLUDED.holes,
         boards = player_stats.boards + EXCLUDED.boards, fouls = player_stats.fouls + EXCLUDED.fouls, updated_at = now()`,
      [accountId, played ? 1 : 0, won ? 1 : 0, lost ? 1 : 0, p.leftEarly ? 1 : 0, p.throws, p.holes, p.boards, p.fouls],
    );
  }

  async stats(accountId: string): Promise<PlayerStats> {
    const res = await this.db.query<PlayerStats>(
      'SELECT games, wins, losses, leaves, throws, holes, boards, fouls FROM player_stats WHERE account_id = $1',
      [accountId],
    );
    return res.rows[0] ?? { ...ZERO_STATS };
  }

  /** A player's recent matches, newest first. Pass the last one's `endedAt` as `before` for the next page. */
  async recent(accountId: string, limit = 20, before?: Date): Promise<MatchRecord[]> {
    const rows = await this.db.query<MatchRow>(
      `SELECT m.* FROM matches m WHERE m.id IN (SELECT match_id FROM match_players WHERE account_id = $1)
       AND ($2::timestamptz IS NULL OR m.ended_at < $2) ORDER BY m.ended_at DESC LIMIT $3`,
      [accountId, before ?? null, Math.min(50, Math.max(1, limit))],
    );
    if (rows.rows.length === 0) return [];
    const players = await this.db.query<PlayerRow>('SELECT * FROM match_players WHERE match_id = ANY($1::text[]) ORDER BY seat', [rows.rows.map((r) => r.id)]);
    return rows.rows.map((m) => ({
      id: m.id,
      code: m.code,
      config: m.config,
      createdAt: m.created_at,
      startedAt: m.started_at,
      endedAt: m.ended_at,
      outcome: m.outcome,
      winner: m.winner,
      scores: { A: m.score_a, B: m.score_b },
      innings: m.innings,
      rematchOf: m.rematch_of,
      players: players.rows
        .filter((p) => p.match_id === m.id)
        .map((p) => ({
          seat: p.seat,
          team: p.team,
          accountId: p.account_id,
          displayName: p.display_name,
          kind: p.kind,
          botLevel: p.bot_level,
          characterId: p.character_id,
          leftEarly: p.left_early,
          throws: p.throws,
          holes: p.holes,
          boards: p.boards,
          fouls: p.fouls,
        })),
    }));
  }
}
