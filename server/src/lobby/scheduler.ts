/** Time source and timers. Injected so tests can run a 30-second timeout instantly. */
export interface Scheduler {
  now(): number;
  /** Run `fn` after `ms`. Returns a function that cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export class RealScheduler implements Scheduler {
  now(): number {
    return Date.now();
  }
  after(ms: number, fn: () => void): () => void {
    const handle = setTimeout(fn, ms);
    handle.unref?.();
    return () => clearTimeout(handle);
  }
}

/** Deterministic clock for tests: time only moves when `advance` is called. */
export class ManualScheduler implements Scheduler {
  private time: number;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  constructor(start = 1_700_000_000_000) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  after(ms: number, fn: () => void): () => void {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + Math.max(0, ms), fn });
    return () => {
      this.timers.delete(id);
    };
  }

  get pending(): number {
    return this.timers.size;
  }

  /** Move time forward, firing due timers in order (including ones they schedule). */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let nextId = -1;
      let nextAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.at <= target && (t.at < nextAt || (t.at === nextAt && id < nextId))) {
          nextId = id;
          nextAt = t.at;
        }
      }
      if (nextId === -1) break;
      const timer = this.timers.get(nextId)!;
      this.timers.delete(nextId);
      this.time = Math.max(this.time, timer.at);
      timer.fn();
    }
    this.time = target;
  }
}
