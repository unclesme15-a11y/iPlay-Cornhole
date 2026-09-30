import type { Db } from './db/types.js';
import type { Scheduler } from './lobby/scheduler.js';
import type { LogFn } from './store/registry.js';

export interface CleanupResult {
  sessions: number;
  cooldowns: number;
  deletionRequests: number;
  matches: number;
}

export interface JanitorOptions {
  /** Delete finished matches older than this many days (0 = keep forever). */
  matchHistoryDays?: number;
}

/** Handled website deletion requests are kept this long (proof we did it), then removed. */
export const HANDLED_DELETION_REQUEST_DAYS = 90;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Housekeeping that keeps the promises in the privacy policy: login sessions are gone 90 days after last use
 * even if that phone never comes back, finished cooldowns do not pile up, handled deletion requests are removed after
 * 90 days, and (if MATCH_HISTORY_DAYS is set) old match history is deleted. Runs at start-up and then hourly.
 */
export class Janitor {
  private cancel: (() => void) | null = null;

  constructor(
    private readonly db: Db,
    private readonly sched: Scheduler,
    private readonly log: LogFn = () => undefined,
    private readonly everyMs = 60 * 60_000,
    private readonly options: JanitorOptions = {},
  ) {}

  async runOnce(): Promise<CleanupResult> {
    const now = new Date(this.sched.now());
    const sessions = await this.db.query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
    const cooldowns = await this.db.query('DELETE FROM ranked_cooldowns WHERE until <= $1', [now]);
    const deletionRequests = await this.db.query("DELETE FROM deletion_requests WHERE status <> 'open' AND handled_at <= $1", [
      new Date(now.getTime() - HANDLED_DELETION_REQUEST_DAYS * DAY_MS),
    ]);
    let matches = 0;
    const days = this.options.matchHistoryDays ?? 0;
    if (days > 0) {
      // match_players rows go with their match (ON DELETE CASCADE). Ratings are stored separately and are not touched.
      const res = await this.db.query('DELETE FROM matches WHERE ended_at <= $1', [new Date(now.getTime() - days * DAY_MS)]);
      matches = res.rowCount;
    }
    return { sessions: sessions.rowCount, cooldowns: cooldowns.rowCount, deletionRequests: deletionRequests.rowCount, matches };
  }

  start(): void {
    if (this.cancel) return;
    const loop = (): void => {
      this.cancel = this.sched.after(this.everyMs, () => {
        this.runOnce()
          .then((r) => {
            if (r.sessions || r.cooldowns || r.deletionRequests || r.matches) this.log('info', 'cleaned up expired data', { ...r });
          })
          .catch((error) => this.log('warn', 'clean-up failed, will try again', { error: String(error) }))
          .finally(loop);
      });
    };
    void this.runOnce().catch((error) => this.log('warn', 'clean-up failed, will try again', { error: String(error) }));
    loop();
  }

  stop(): void {
    this.cancel?.();
    this.cancel = null;
  }
}
