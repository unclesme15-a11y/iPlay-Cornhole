import type { Db } from './db/types.js';
import type { Scheduler } from './lobby/scheduler.js';
import type { LogFn } from './store/registry.js';

export interface CleanupResult {
  sessions: number;
  cooldowns: number;
}

/**
 * Housekeeping that keeps the promises in the privacy policy: login sessions are gone 90 days after last use
 * even if that phone never comes back, and finished cooldowns do not pile up. Runs at start-up and then hourly.
 */
export class Janitor {
  private cancel: (() => void) | null = null;

  constructor(
    private readonly db: Db,
    private readonly sched: Scheduler,
    private readonly log: LogFn = () => undefined,
    private readonly everyMs = 60 * 60_000,
  ) {}

  async runOnce(): Promise<CleanupResult> {
    const now = new Date(this.sched.now());
    const sessions = await this.db.query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
    const cooldowns = await this.db.query('DELETE FROM ranked_cooldowns WHERE until <= $1', [now]);
    return { sessions: sessions.rowCount, cooldowns: cooldowns.rowCount };
  }

  start(): void {
    if (this.cancel) return;
    const loop = (): void => {
      this.cancel = this.sched.after(this.everyMs, () => {
        this.runOnce()
          .then((r) => {
            if (r.sessions || r.cooldowns) this.log('info', 'cleaned up expired data', { ...r });
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
