import { randomInt as cryptoInt } from 'node:crypto';
import { DomainError } from '../core/errors.js';
import type { MatchConfig } from '../core/types.js';
import { MatchSession, type Credentials, type SeatPlan } from '../lobby/session.js';
import type { Scheduler } from '../lobby/scheduler.js';

/** No 0/O/1/I/L so a code read aloud or typed on a phone is hard to get wrong. */
const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface RegistryOptions {
  scheduler: Scheduler;
  maxMatches?: number;
  /** How long a finished/abandoned match stays readable (results screen, late reconnects). */
  finishedTtlMs?: number;
  /** A match nobody has touched for this long is dropped. */
  idleTtlMs?: number;
  sweepEveryMs?: number;
}

export class MatchRegistry {
  private readonly matches = new Map<string, MatchSession>();
  private readonly endedAt = new Map<string, number>();
  private readonly sched: Scheduler;
  private readonly maxMatches: number;
  private readonly finishedTtl: number;
  private readonly idleTtl: number;
  private readonly sweepEvery: number;
  private cancelSweep: (() => void) | null = null;

  constructor(opts: RegistryOptions) {
    this.sched = opts.scheduler;
    this.maxMatches = opts.maxMatches ?? 5000;
    this.finishedTtl = opts.finishedTtlMs ?? 10 * 60_000;
    this.idleTtl = opts.idleTtlMs ?? 2 * 60 * 60_000;
    this.sweepEvery = opts.sweepEveryMs ?? 60_000;
    this.scheduleSweep();
  }

  get size(): number {
    return this.matches.size;
  }

  create(input: { config: MatchConfig; seatPlan?: SeatPlan; hostName: string }): { session: MatchSession; host: Credentials } {
    if (this.matches.size >= this.maxMatches) {
      throw new DomainError('server_busy', 'The server is at capacity. Try again in a minute.', 503);
    }
    let id = this.newId();
    while (this.matches.has(id)) id = this.newId();
    const session = new MatchSession({
      id,
      config: input.config,
      ...(input.seatPlan ? { seatPlan: input.seatPlan } : {}),
      scheduler: this.sched,
    });
    const host = session.createHost(input.hostName);
    this.matches.set(id, session);
    return { session, host };
  }

  get(id: string): MatchSession | undefined {
    return this.matches.get(id.toUpperCase());
  }

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
        session.dispose();
        this.matches.delete(id);
        this.endedAt.delete(id);
        removed++;
      }
    }
    return removed;
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
    let id = '';
    for (let i = 0; i < 8; i++) id += ID_ALPHABET[cryptoInt(ID_ALPHABET.length)];
    return id;
  }
}
