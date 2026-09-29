import { randomInt as cryptoInt } from 'node:crypto';
import type { MatchHistory, MatchSummary } from '../accounts/history.js';
import { DomainError } from '../core/errors.js';
import type { MatchConfig, SeatId } from '../core/types.js';
import { rankedConfig } from '../ranking/rules.js';
import type { RankedMode } from '../ranking/ratings.js';
import type { LiveMatchStore } from '../lobby/persistence.js';
import type { Scheduler } from '../lobby/scheduler.js';
import { MatchSession, type AccountRef, type RematchSeed, type SeatPlan, type SessionHooks, type Timing } from '../lobby/session.js';

/** No 0/O/1/I/L so a code read aloud or typed on a phone is hard to get wrong. */
const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type LogFn = (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void;

export interface RegistryOptions {
  scheduler: Scheduler;
  maxMatches?: number;
  /** How long a finished/abandoned match stays readable (results screen, late reconnects). */
  finishedTtlMs?: number;
  /** A match nobody has touched for this long is dropped. */
  idleTtlMs?: number;
  sweepEveryMs?: number;
  persistence?: LiveMatchStore | null;
  history?: MatchHistory | null;
  timing?: Partial<Timing>;
  log?: LogFn;
  /** Saved live matches older than this are discarded on boot instead of restored. */
  restoreMaxAgeMs?: number;
  /** Where each throw's random seed comes from. Tests pin this to make matches repeatable; production leaves it alone. */
  seedSource?: () => number;
}

export class MatchRegistry {
  private readonly matches = new Map<string, MatchSession>();
  private readonly endedAt = new Map<string, number>();
  private readonly sched: Scheduler;
  private readonly maxMatches: number;
  private readonly finishedTtl: number;
  private readonly idleTtl: number;
  private readonly sweepEvery: number;
  private readonly persistence: LiveMatchStore | null;
  private readonly history: MatchHistory | null;
  private readonly timing: Partial<Timing> | undefined;
  private readonly log: LogFn;
  private readonly restoreMaxAge: number;
  private readonly seedSource: (() => number) | undefined;
  private cancelSweep: (() => void) | null = null;
  private maintenanceOn = false;
  /** Called when someone walks out of a ranked match. Set by the ranked service. */
  onRankedForfeit: ((accountId: string) => void) | null = null;
  /** Called after a ranked result changed ratings (leaderboards should refresh). */
  onRatingsChanged: (() => void) | null = null;

  constructor(opts: RegistryOptions) {
    this.sched = opts.scheduler;
    this.maxMatches = opts.maxMatches ?? 5000;
    this.finishedTtl = opts.finishedTtlMs ?? 10 * 60_000;
    this.idleTtl = opts.idleTtlMs ?? 2 * 60 * 60_000;
    this.sweepEvery = opts.sweepEveryMs ?? 60_000;
    this.persistence = opts.persistence ?? null;
    this.history = opts.history ?? null;
    this.timing = opts.timing;
    this.log = opts.log ?? (() => undefined);
    this.restoreMaxAge = opts.restoreMaxAgeMs ?? 2 * 60 * 60_000;
    this.seedSource = opts.seedSource;
    this.scheduleSweep();
  }

  get size(): number {
    return this.matches.size;
  }

  /** While on, no new matches (or rematches) can start. Matches already running carry on. */
  get maintenance(): boolean {
    return this.maintenanceOn;
  }
  set maintenance(on: boolean) {
    this.maintenanceOn = on;
  }

  private hooks(): SessionHooks {
    return {
      onChange: (s) => this.persistence?.markDirty(s),
      onEnded: (s) => this.handleEnded(s),
      createRematch: (old, seed) => this.createRematch(old, seed),
    };
  }

  private sessionBase() {
    return {
      scheduler: this.sched,
      hooks: this.hooks(),
      ...(this.timing ? { timing: this.timing } : {}),
      ...(this.seedSource ? { seedSource: this.seedSource } : {}),
    };
  }

  /** One account can only be in one running match at a time. Throws 409 with the match id so the app can rejoin it. */
  assertFree(accountId: string, exceptMatchId?: string): void {
    const current = this.activeMatchOf(accountId);
    if (current && current.id !== exceptMatchId) {
      throw new DomainError('already_in_match', 'You are already in a match', 409, { matchId: current.id });
    }
  }

  activeMatchOf(accountId: string): MatchSession | undefined {
    for (const session of this.matches.values()) if (session.hasActivePlayer(accountId)) return session;
    return undefined;
  }

  private assertCanStart(): void {
    if (this.maintenanceOn) throw new DomainError('maintenance', 'iPlay Cornhole is being updated. New matches will be back shortly.', 503);
    if (this.matches.size >= this.maxMatches) {
      throw new DomainError('server_busy', 'The server is at capacity. Try again in a minute.', 503);
    }
  }

  create(input: { config: MatchConfig; seatPlan?: SeatPlan; host: AccountRef }): MatchSession {
    this.assertCanStart();
    this.assertFree(input.host.id);
    const session = new MatchSession({
      id: this.newId(),
      config: input.config,
      ...(input.seatPlan ? { seatPlan: input.seatPlan } : {}),
      ...this.sessionBase(),
    });
    session.createHost(input.host);
    this.matches.set(session.id, session);
    return session;
  }

  /** Starts a ranked match for players the matchmaker found. Seats are fixed, the picks begin at once. */
  createRanked(mode: RankedMode, seats: Array<{ account: AccountRef; seat: SeatId }>): MatchSession {
    this.assertCanStart();
    for (const s of seats) this.assertFree(s.account.id);
    const session = MatchSession.createRanked(
      { id: this.newId(), mode, config: rankedConfig(mode), ...this.sessionBase() },
      seats,
    );
    this.matches.set(session.id, session);
    session.startRanked();
    return session;
  }

  /** Joins an account to a match, enforcing one match at a time and the maintenance switch. */
  join(session: MatchSession, account: AccountRef, seat?: Parameters<MatchSession['join']>[1]): ReturnType<MatchSession['join']> {
    if (this.maintenanceOn && !session.hasActivePlayer(account.id)) {
      throw new DomainError('maintenance', 'iPlay Cornhole is being updated. Try again shortly.', 503);
    }
    this.assertFree(account.id, session.id);
    return session.join(account, seat);
  }

  get(id: string): MatchSession | undefined {
    return this.matches.get(id.toUpperCase());
  }

  /** Takes an account out of whatever match it is in (a ban, a deleted account). */
  leaveAll(accountId: string): boolean {
    const session = this.activeMatchOf(accountId);
    if (!session) return false;
    session.leave(accountId);
    return true;
  }

  private createRematch(old: MatchSession, seed: RematchSeed): string {
    this.assertCanStart();
    for (const p of seed.players) this.assertFree(p.id, old.id);
    const session = MatchSession.fromRematch({ id: this.newId(), ...this.sessionBase() }, seed);
    this.matches.set(session.id, session);
    session.beginRematch();
    return session.id;
  }

  // ------------------------------------------------------ history and persistence

  private handleEnded(session: MatchSession): void {
    void this.persistence?.remove(session.id);
    if (session.ranked && session.forfeitedBy) {
      try {
        this.onRankedForfeit?.(session.forfeitedBy);
      } catch (error) {
        this.log('error', 'could not apply a ranked cooldown', { error: String(error) });
      }
    }
    const summary = session.summary();
    if (summary && this.history) void this.recordWithRetry(summary, 0, session);
  }

  private async recordWithRetry(summary: MatchSummary, attempt: number, session: MatchSession): Promise<void> {
    try {
      const result = await this.history!.recordMatch(summary);
      if (summary.ranked && !result.duplicate) {
        session.applyRatings({ voided: result.voided, updates: result.ratingUpdates });
        this.onRatingsChanged?.();
      }
    } catch (error) {
      if (attempt >= 2) {
        // Out of retries. Log the whole result so it can be replayed by hand.
        this.log('error', 'could not save match history', { code: summary.code, summary, error: String(error) });
        return;
      }
      this.log('warn', 'saving match history failed, will retry', { code: summary.code, attempt, error: String(error) });
      this.sched.after(attempt === 0 ? 2000 : 10_000, () => void this.recordWithRetry(summary, attempt + 1, session));
    }
  }

  /** Brings back matches that were running when the server last stopped. Call once on boot, before serving. */
  async restoreAll(): Promise<{ restored: number; discarded: number }> {
    if (!this.persistence) return { restored: 0, discarded: 0 };
    let restored = 0;
    let discarded = 0;
    for (const { id, snapshot } of await this.persistence.loadAll(this.restoreMaxAge)) {
      try {
        if (this.matches.has(id)) continue;
        const session = MatchSession.restore(snapshot, this.sessionBase());
        if (session.id !== id) throw new Error(`saved match is stored under ${id} but says it is ${session.id}`);
        this.matches.set(session.id, session);
        session.resume();
        restored++;
      } catch (error) {
        discarded++;
        this.log('error', 'could not restore a live match, discarding it', { id, error: String(error) });
        await this.persistence.discard(id).catch(() => undefined);
      }
    }
    if (restored || discarded) this.log('info', 'restored live matches', { restored, discarded });
    return { restored, discarded };
  }

  // ---------------------------------------------------------------- housekeeping

  /** Drop finished and idle matches. Runs on a timer; exposed for tests. */
  sweep(): number {
    const now = this.sched.now();
    let removed = 0;
    for (const [id, session] of this.matches) {
      let drop = false;
      if (session.isOver) {
        const ended = this.endedAt.get(id) ?? now;
        this.endedAt.set(id, ended);
        drop = now - ended >= this.finishedTtl;
      } else if (now - session.lastActivity >= this.idleTtl) {
        drop = true;
      }
      if (drop) {
        if (!session.isOver) void this.persistence?.remove(id);
        session.dispose();
        this.matches.delete(id);
        this.endedAt.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Stop cleanly: freeze every running match so its state can no longer change, save each one a final
   * time, and refuse any later save (the database is about to close). Matches stay in memory so
   * phones that are still connected can be told to reconnect.
   */
  async shutdown(): Promise<void> {
    for (const session of this.matches.values()) {
      if (session.isOver) continue;
      session.dispose(); // no more bot throws, timers or events
      this.persistence?.markDirty(session); // make sure the very latest state is written
    }
    await this.persistence?.flushAll();
    this.persistence?.freeze();
  }

  /** Save everything that is waiting to be saved. Call before the process exits. */
  async flush(): Promise<void> {
    await this.persistence?.flushAll();
  }

  dispose(): void {
    this.cancelSweep?.();
    this.cancelSweep = null;
    for (const session of this.matches.values()) session.dispose();
    this.matches.clear();
    this.endedAt.clear();
  }

  private scheduleSweep(): void {
    this.cancelSweep = this.sched.after(this.sweepEvery, () => {
      this.sweep();
      this.scheduleSweep();
    });
  }

  private newId(): string {
    for (;;) {
      let id = '';
      for (let i = 0; i < 8; i++) id += ID_ALPHABET[cryptoInt(ID_ALPHABET.length)];
      if (!this.matches.has(id)) return id;
    }
  }
}
