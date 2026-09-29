import type { Db } from '../db/types.js';
import type { Scheduler } from './scheduler.js';
import type { MatchSession, SessionSnapshot } from './session.js';

export interface PersistenceOptions {
  /** Changes within this window are saved together. */
  debounceMs?: number;
  onError?: (message: string, error: unknown) => void;
}

/**
 * Saves live matches to the database so a restart doesn't end them.
 *
 * Every change marks a match "dirty"; a short timer then writes its latest state once. So a burst
 * of events (a throw, its result, the inning score) costs one write, and a crash loses at most the
 * last fraction of a second. Writes for one match never overlap.
 */
export class LiveMatchStore {
  private readonly debounceMs: number;
  private readonly timers = new Map<string, () => void>();
  private readonly sessions = new Map<string, MatchSession>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly removed = new Set<string>();
  private readonly onError: (message: string, error: unknown) => void;

  constructor(
    private readonly db: Db,
    private readonly sched: Scheduler,
    opts: PersistenceOptions = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 250;
    this.onError = opts.onError ?? (() => undefined);
  }

  /** The match changed: save it soon. Cheap to call as often as you like. */
  markDirty(session: MatchSession): void {
    if (session.isOver) return;
    this.removed.delete(session.id);
    this.sessions.set(session.id, session);
    if (this.timers.has(session.id)) return;
    this.timers.set(
      session.id,
      this.sched.after(this.debounceMs, () => {
        this.timers.delete(session.id);
        void this.write(session.id);
      }),
    );
  }

  /** Stop saving a match and delete what was saved (it ended, or was dropped). */
  async remove(id: string): Promise<void> {
    this.timers.get(id)?.();
    this.timers.delete(id);
    this.sessions.delete(id);
    this.removed.add(id);
    await this.chain(id, async () => {
      await this.db.query('DELETE FROM live_matches WHERE id = $1', [id]);
    });
  }

  /** Write everything that is waiting, right now. Used on shutdown. */
  async flushAll(): Promise<void> {
    const ids = [...this.timers.keys()];
    for (const id of ids) {
      this.timers.get(id)?.();
      this.timers.delete(id);
    }
    await Promise.all(ids.map((id) => this.write(id)));
    await Promise.all([...this.chains.values()]);
  }

  /** Waits for writes already started. */
  async idle(): Promise<void> {
    await Promise.all([...this.chains.values()]);
  }

  private write(id: string): Promise<void> {
    return this.chain(id, async () => {
      const session = this.sessions.get(id);
      if (!session || session.isOver || this.removed.has(id)) return;
      const snapshot = session.snapshot();
      await this.db.query(
        `INSERT INTO live_matches (id, phase, state, updated_at) VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (id) DO UPDATE SET phase = EXCLUDED.phase, state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`,
        [id, snapshot.phase, JSON.stringify(snapshot), new Date(this.sched.now())],
      );
    });
  }

  private chain(id: string, job: () => Promise<void>): Promise<void> {
    const previous = this.chains.get(id) ?? Promise.resolve();
    const next = previous
      .then(job)
      .catch((error: unknown) => this.onError(`could not save live match ${id}`, error))
      .finally(() => {
        if (this.chains.get(id) === next) this.chains.delete(id);
      });
    this.chains.set(id, next);
    return next;
  }

  /** Everything saved, for bringing matches back on boot. Old rows are deleted first. */
  async loadAll(maxAgeMs: number): Promise<Array<{ id: string; snapshot: SessionSnapshot; updatedAt: Date }>> {
    await this.db.query('DELETE FROM live_matches WHERE updated_at < $1', [new Date(this.sched.now() - maxAgeMs)]);
    const rows = await this.db.query<{ id: string; state: SessionSnapshot; updated_at: Date }>('SELECT id, state, updated_at FROM live_matches ORDER BY updated_at');
    // The row id is what identifies a saved match: the saved data itself might be damaged.
    return rows.rows.map((r) => ({ id: r.id, snapshot: r.state, updatedAt: r.updated_at }));
  }

  async discard(id: string): Promise<void> {
    await this.db.query('DELETE FROM live_matches WHERE id = $1', [id]);
  }
}
