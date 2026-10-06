import type { Db } from '../db/types.js';
import type { Scheduler } from '../lobby/scheduler.js';
import type { LogFn } from '../store/registry.js';
import type { PushMessage, PushSender } from './senders.js';

/**
 * Push notifications, kept few and useful (players turn noisy apps off). Three kinds, each one a setting the player
 * can switch off:
 *   match   "Your match is still on": you left the app mid-match; come back within 30 s or a bot takes your seat
 *   ranked  "Ranked match found": the search found your opponents while the app was in the background
 *   season  "Season 2 is over: you finished #12": once per season, only to people who played it
 * The same kind is never sent to the same player twice within its minimum gap, and phones that have deleted the app
 * are forgotten automatically.
 */

export type PushCategory = 'match' | 'ranked' | 'season';
export const PUSH_CATEGORIES: readonly PushCategory[] = ['match', 'ranked', 'season'];
export type PushSettings = Record<PushCategory, boolean>;
export type PushPlatform = 'ios' | 'android';

/** Phones remembered per account (a person with an old and a new phone, say). Older ones are dropped. */
export const MAX_DEVICES_PER_ACCOUNT = 5;
/** Wait this long after a disconnect before nagging: a network blip reconnects by itself. */
export const AWAY_DELAY_MS = 5000;

export interface AwaySession {
  readonly id: string;
  readonly isOver: boolean;
  readonly isRanked: boolean;
  isConnected(playerId: string): boolean;
}

export class PushService {
  private readonly lastSent = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly sched: Scheduler,
    private readonly senders: Partial<Record<PushPlatform, PushSender>>,
    private readonly log: LogFn = () => undefined,
  ) {}

  /** Which platforms the server can send to (the keys are set). */
  get enabled(): Record<PushPlatform, boolean> {
    return { ios: Boolean(this.senders.ios), android: Boolean(this.senders.android) };
  }

  async register(accountId: string, token: string, platform: PushPlatform, appVersion: string | null): Promise<void> {
    const now = new Date(this.sched.now());
    // A token belongs to one phone; if someone else signs in on that phone it moves to them.
    await this.db.query(
      `INSERT INTO push_devices (token, account_id, platform, app_version, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (token) DO UPDATE SET account_id = EXCLUDED.account_id, platform = EXCLUDED.platform, app_version = EXCLUDED.app_version, updated_at = EXCLUDED.updated_at`,
      [token, accountId, platform, appVersion, now],
    );
    await this.db.query(
      `DELETE FROM push_devices WHERE account_id = $1 AND token NOT IN (
         SELECT token FROM push_devices WHERE account_id = $1 ORDER BY updated_at DESC LIMIT ${MAX_DEVICES_PER_ACCOUNT})`,
      [accountId],
    );
  }

  async unregister(accountId: string, token: string): Promise<void> {
    await this.db.query('DELETE FROM push_devices WHERE account_id = $1 AND token = $2', [accountId, token]);
  }

  async settings(accountId: string): Promise<PushSettings> {
    const r = await this.db.query<{ push_settings: Partial<PushSettings> | string | null }>('SELECT push_settings FROM accounts WHERE id = $1', [accountId]);
    const raw = r.rows[0]?.push_settings;
    const stored = (typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}) as Partial<PushSettings>;
    return { match: stored.match !== false, ranked: stored.ranked !== false, season: stored.season !== false };
  }

  async setSettings(accountId: string, change: Partial<PushSettings>): Promise<PushSettings> {
    const next = { ...(await this.settings(accountId)), ...change };
    await this.db.query('UPDATE accounts SET push_settings = $2 WHERE id = $1', [accountId, JSON.stringify(next)]);
    return next;
  }

  /**
   * Sends one kind of message to some accounts, to every phone they have registered, if they allow that kind and
   * were not sent the same kind within `minGapMs`. Returns how many phones it reached.
   */
  async notify(accountIds: string[], category: PushCategory, msg: PushMessage, minGapMs: number): Promise<number> {
    if (!this.senders.ios && !this.senders.android) return 0;
    let reached = 0;
    const now = this.sched.now();
    for (const accountId of new Set(accountIds)) {
      const key = `${accountId}:${category}`;
      const last = this.lastSent.get(key);
      if (last !== undefined && now - last < minGapMs) continue;
      if (!(await this.settings(accountId))[category]) continue;
      const devices = await this.db.query<{ token: string; platform: PushPlatform }>('SELECT token, platform FROM push_devices WHERE account_id = $1', [accountId]);
      if (devices.rows.length === 0) continue;
      this.lastSent.set(key, now);
      for (const d of devices.rows) {
        const sender = this.senders[d.platform];
        if (!sender) continue;
        const outcome = await sender.send(d.token, msg);
        if (outcome === 'sent') reached++;
        else if (outcome === 'gone') await this.db.query('DELETE FROM push_devices WHERE token = $1', [d.token]);
        else this.log('warn', 'push notification failed', { platform: d.platform, category });
      }
    }
    if (this.lastSent.size > 50_000) this.lastSent.clear();
    return reached;
  }

  // ------------------------------------------------------------------ the three moments

  /** A player's connection dropped mid-match. If they are still away a few seconds later, remind them. */
  playerAway(session: AwaySession, accountId: string): void {
    this.sched.after(AWAY_DELAY_MS, () => {
      if (session.isOver || session.isConnected(accountId)) return;
      void this.notify(
        [accountId],
        'match',
        {
          title: 'Your cornhole match is still on',
          body: session.isRanked
            ? 'Come back within 30 seconds or it counts as a loss.'
            : 'Come back within 30 seconds or a bot takes your seat.',
          data: { type: 'match', matchId: session.id },
          collapseId: `match-${session.id}`,
          ttlSec: 30,
        },
        60_000,
      ).catch((error) => this.log('warn', 'push notification failed', { error: String(error) }));
    });
  }

  /** The ranked search found a match. */
  rankedMatched(accountIds: string[], matchId: string, mode: 'singles' | 'teams'): void {
    void this.notify(
      accountIds,
      'ranked',
      {
        title: 'Ranked match found',
        body: mode === 'singles' ? 'Your opponent is ready. Tap to play.' : 'Your opponents are ready. Tap to play with your partner.',
        data: { type: 'ranked', matchId },
        collapseId: 'ranked-found',
        ttlSec: 60,
      },
      0,
    ).catch((error) => this.log('warn', 'push notification failed', { error: String(error) }));
  }

  /** A season closed: tell everyone who played it how they finished (best result first). */
  async seasonClosed(season: number, nextSeasonName: string): Promise<number> {
    const rows = await this.db.query<{ account_id: string; mode: string; rank: number | null }>(
      `SELECT member AS account_id, mode, rank FROM (
         SELECT member_a AS member, mode, rank FROM season_results WHERE season = $1 AND member_a IS NOT NULL
         UNION ALL SELECT member_b, mode, rank FROM season_results WHERE season = $1 AND member_b IS NOT NULL) x
        ORDER BY account_id, rank IS NULL, rank`,
      [season],
    );
    const best = new Map<string, { mode: string; rank: number | null }>();
    for (const r of rows.rows) if (!best.has(r.account_id)) best.set(r.account_id, { mode: r.mode, rank: r.rank });
    let reached = 0;
    for (const [accountId, b] of best) {
      const how = b.rank !== null ? `You finished #${b.rank} in ${b.mode === 'singles' ? 'singles' : 'teams'}.` : 'Thanks for playing ranked.';
      reached += await this.notify(
        [accountId],
        'season',
        { title: `Season ${season} is over`, body: `${how} ${nextSeasonName} starts now: everyone gets a fresh climb.`, data: { type: 'season', season: String(season) }, collapseId: `season-${season}`, ttlSec: 3 * 86_400 },
        0,
      );
    }
    return reached;
  }

  close(): void {
    this.senders.ios?.close();
    this.senders.android?.close();
  }
}
