import { randomInt } from 'node:crypto';
import { DomainError } from '../core/errors.js';
import type { Db } from '../db/types.js';
import type { Scheduler } from '../lobby/scheduler.js';
import type { AccountRef } from '../lobby/session.js';
import type { LogFn, MatchRegistry } from '../store/registry.js';
import { RatingsReader } from './reader.js';
import type { RankedMode } from './ratings.js';
import { FORFEIT_COOLDOWN_MS } from './rules.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

interface Entry {
  mode: RankedMode;
  members: AccountRef[];
  rating: number;
  joinedAt: number;
  /** Accounts these players must not be matched with (they blocked them, or were blocked by them). */
  avoid: Set<string>;
}

export interface Party {
  code: string;
  members: AccountRef[];
  createdAt: number;
  touchedAt: number;
}

export type QueueStatus =
  | { status: 'idle' }
  | { status: 'searching'; mode: RankedMode; waitedSec: number; ratingWindow: number; playersSearching: number }
  | { status: 'matched'; matchId: string; mode: RankedMode }
  | { status: 'expired'; mode: RankedMode }
  | { status: 'cooldown'; until: string };

export interface RankedOptions {
  tickMs?: number;
  /** Stop searching after this long. */
  maxWaitMs?: number;
  /** How long a "matched" answer stays available to a phone that polls late. */
  matchedTtlMs?: number;
  partyIdleMs?: number;
  rng?: () => number;
}

/** How far apart two ratings can be and still be matched: starts tight, widens while you wait. */
export const ratingWindow = (waitedMs: number): number => Math.min(800, 100 + 50 * Math.floor(waitedMs / 5000));

/**
 * Finds opponents for ranked play. Singles queue one person. Teams queue as a party of two (a duo),
 * so a duo's partner is always someone they chose. The queue and parties live in memory: a server
 * restart empties them and players just search again.
 */
export class RankedService {
  private readonly queue = new Map<string, Entry>(); // by account id (both members of a duo point at one entry)
  private readonly matched = new Map<string, { matchId: string; mode: RankedMode; at: number }>();
  private readonly expired = new Map<string, { mode: RankedMode; at: number }>();
  private readonly parties = new Map<string, Party>();
  private readonly partyOf = new Map<string, string>();
  /** Cooldowns are noted here the instant a match ends, before the database write finishes, so re-queueing at once is still refused. */
  private readonly cooldowns = new Map<string, number>();
  private cancelTick: (() => void) | null = null;
  private readonly tickMs: number;
  private readonly maxWaitMs: number;
  private readonly matchedTtlMs: number;
  private readonly partyIdleMs: number;
  private readonly rng: () => number;

  constructor(
    private readonly db: Db,
    private readonly registry: MatchRegistry,
    private readonly reader: RatingsReader,
    private readonly sched: Scheduler,
    private readonly log: LogFn = () => undefined,
    opts: RankedOptions = {},
  ) {
    this.tickMs = opts.tickMs ?? 2000;
    this.maxWaitMs = opts.maxWaitMs ?? 5 * 60_000;
    this.matchedTtlMs = opts.matchedTtlMs ?? 2 * 60_000;
    this.partyIdleMs = opts.partyIdleMs ?? 30 * 60_000;
    this.rng = opts.rng ?? Math.random;
    registry.onRankedForfeit = (accountId) => {
      void this.penalize(accountId).catch((e) => this.log('error', 'could not save a ranked cooldown', { error: String(e) }));
    };
  }

  start(): void {
    if (this.cancelTick) return;
    const loop = (): void => {
      this.cancelTick = this.sched.after(this.tickMs, () => {
        try {
          this.tick();
        } catch (error) {
          this.log('error', 'matchmaking tick failed', { error: String(error) });
        }
        loop();
      });
    };
    loop();
  }

  stop(): void {
    this.cancelTick?.();
    this.cancelTick = null;
  }

  // ------------------------------------------------------------------ cooldown

  async penalize(accountId: string): Promise<void> {
    const until = new Date(this.sched.now() + FORFEIT_COOLDOWN_MS);
    this.cooldowns.set(accountId, until.getTime());
    await this.db.query(
      `INSERT INTO ranked_cooldowns (account_id, until, reason) VALUES ($1, $2, 'forfeit')
       ON CONFLICT (account_id) DO UPDATE SET until = GREATEST(ranked_cooldowns.until, EXCLUDED.until), reason = EXCLUDED.reason`,
      [accountId, until],
    );
    // Saved: from now on the database is the authority (so staff can lift a cooldown by deleting the row).
    // If the write failed we never get here and the in-memory note keeps the cooldown in force.
    if (this.cooldowns.get(accountId) === until.getTime()) this.cooldowns.delete(accountId);
  }

  async cooldownUntil(accountId: string): Promise<Date | null> {
    const now = this.sched.now();
    const noted = this.cooldowns.get(accountId) ?? 0;
    const res = await this.db.query<{ until: Date }>('SELECT until FROM ranked_cooldowns WHERE account_id = $1', [accountId]);
    const saved = res.rows[0]?.until.getTime() ?? 0;
    const latest = Math.max(noted, saved);
    if (latest <= now) {
      this.cooldowns.delete(accountId); // over: forget it
      return null;
    }
    return new Date(latest);
  }

  // ------------------------------------------------------------------- parties

  private newPartyCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.parties.has(code)) return code;
    }
  }

  party(accountId: string): Party | null {
    const code = this.partyOf.get(accountId);
    return code ? (this.parties.get(code) ?? null) : null;
  }

  createParty(account: AccountRef): Party {
    const existing = this.party(account.id);
    if (existing) return existing;
    this.assertNotQueued(account.id);
    const now = this.sched.now();
    const party: Party = { code: this.newPartyCode(), members: [account], createdAt: now, touchedAt: now };
    this.parties.set(party.code, party);
    this.partyOf.set(account.id, party.code);
    return party;
  }

  async joinParty(code: string, account: AccountRef): Promise<Party> {
    const party = this.parties.get(code.trim().toUpperCase());
    if (!party) throw new DomainError('party_not_found', 'That party code is not valid (it may have expired)', 404);
    if (party.members.some((m) => m.id === account.id)) return party;
    if (party.members.length >= 2) throw new DomainError('party_full', 'That party is full', 409);
    this.assertNotQueued(account.id);
    const avoid = await this.avoidSet(party.members.map((m) => m.id));
    if (avoid.has(account.id)) throw new DomainError('party_not_available', 'You cannot join that party', 403);
    // The database lookup took a moment: check again, because someone else may have joined, the
    // owner may have left, or this player may have started searching in the meantime.
    if (this.parties.get(party.code) !== party) throw new DomainError('party_not_found', 'That party code is not valid (it may have expired)', 404);
    if (party.members.some((m) => m.id === account.id)) return party;
    if (party.members.length >= 2) throw new DomainError('party_full', 'That party is full', 409);
    this.assertNotQueued(account.id);
    this.leaveParty(account.id);
    party.members.push(account);
    party.touchedAt = this.sched.now();
    this.partyOf.set(account.id, party.code);
    return party;
  }

  /** Leaving a party also pulls the duo out of the queue. */
  leaveParty(accountId: string): void {
    const party = this.party(accountId);
    if (!party) return;
    this.partyOf.delete(accountId);
    party.members = party.members.filter((m) => m.id !== accountId);
    this.leaveQueue(accountId);
    for (const m of party.members) this.leaveQueue(m.id);
    if (party.members.length === 0) this.parties.delete(party.code);
    else party.touchedAt = this.sched.now();
  }

  // --------------------------------------------------------------------- queue

  private assertNotQueued(accountId: string): void {
    if (this.queue.has(accountId)) throw new DomainError('already_queued', 'You are already searching for a ranked match', 409);
  }

  private async avoidSet(ids: string[]): Promise<Set<string>> {
    const res = await this.db.query<{ a: string; b: string }>(
      'SELECT blocker_id AS a, blocked_id AS b FROM blocks WHERE blocker_id = ANY($1::text[]) OR blocked_id = ANY($1::text[])',
      [ids],
    );
    const out = new Set<string>();
    for (const r of res.rows) {
      out.add(r.a);
      out.add(r.b);
    }
    for (const id of ids) out.delete(id);
    return out;
  }

  /**
   * Start searching. Singles search alone. For teams, the person calls this for their party of two and
   * both partners enter the queue together.
   */
  async joinQueue(account: AccountRef, mode: RankedMode): Promise<QueueStatus> {
    if (this.registry.maintenance) throw new DomainError('maintenance', 'iPlay Cornhole is being updated. Ranked play will be back shortly.', 503);
    const members = mode === 'teams' ? this.requireFullParty(account) : [account];
    for (const m of members) {
      this.assertNotQueued(m.id);
      this.registry.assertFree(m.id);
      const until = await this.cooldownUntil(m.id);
      if (until) {
        throw new DomainError('ranked_cooldown', members.length > 1 && m.id !== account.id ? 'Your partner cannot play ranked right now' : 'You left a ranked match. Wait a little before queueing again.', 403, {
          until: until.toISOString(),
          accountId: m.id,
        });
      }
    }
    // the same person may have queued while the checks above were running
    for (const m of members) this.assertNotQueued(m.id);
    const rating = mode === 'teams' ? (await this.reader.duo(members[0]!.id, members[1]!.id)).rating : (await this.reader.singles(account.id)).rating;
    const avoid = await this.avoidSet(members.map((m) => m.id));
    for (const m of members) this.assertNotQueued(m.id);
    const entry: Entry = { mode, members, rating, joinedAt: this.sched.now(), avoid };
    for (const m of members) {
      this.queue.set(m.id, entry);
      this.matched.delete(m.id);
      this.expired.delete(m.id);
    }
    return this.statusOf(account.id) ?? { status: 'idle' };
  }

  private requireFullParty(account: AccountRef): AccountRef[] {
    const party = this.party(account.id);
    if (!party || party.members.length < 2) {
      throw new DomainError('party_required', 'Ranked teams need a partner. Make a party and share the code first.', 409);
    }
    party.touchedAt = this.sched.now();
    return [...party.members];
  }

  leaveQueue(accountId: string): boolean {
    const entry = this.queue.get(accountId);
    if (!entry) return false;
    for (const m of entry.members) this.queue.delete(m.id);
    return true;
  }

  /** Forget everything about this account (a ban, a deleted account). */
  forget(accountId: string): void {
    this.leaveParty(accountId);
    this.leaveQueue(accountId);
    this.matched.delete(accountId);
    this.expired.delete(accountId);
  }

  private statusOf(accountId: string): QueueStatus | null {
    const now = this.sched.now();
    const entry = this.queue.get(accountId);
    if (entry) {
      const waited = now - entry.joinedAt;
      return {
        status: 'searching',
        mode: entry.mode,
        waitedSec: Math.floor(waited / 1000),
        ratingWindow: ratingWindow(waited),
        playersSearching: new Set([...this.queue.values()].filter((e) => e.mode === entry.mode)).size,
      };
    }
    const m = this.matched.get(accountId);
    if (m && now - m.at < this.matchedTtlMs && this.registry.get(m.matchId) && !this.registry.get(m.matchId)!.isOver) return { status: 'matched', matchId: m.matchId, mode: m.mode };
    const x = this.expired.get(accountId);
    if (x && now - x.at < this.matchedTtlMs) return { status: 'expired', mode: x.mode };
    return null;
  }

  async status(accountId: string): Promise<QueueStatus> {
    const current = this.statusOf(accountId);
    if (current) return current;
    const until = await this.cooldownUntil(accountId);
    return until ? { status: 'cooldown', until: until.toISOString() } : { status: 'idle' };
  }

  get searching(): number {
    return new Set(this.queue.values()).size;
  }

  // ---------------------------------------------------------------- matchmaking

  /** One matchmaking pass. Runs on a timer; exposed for tests. */
  tick(): void {
    const now = this.sched.now();
    for (const [id, entry] of [...this.queue]) {
      if (now - entry.joinedAt >= this.maxWaitMs) {
        for (const m of entry.members) this.expired.set(m.id, { mode: entry.mode, at: now });
        this.leaveQueue(id);
      }
    }
    for (const [code, party] of this.parties) {
      if (now - party.touchedAt >= this.partyIdleMs) {
        for (const m of [...party.members]) this.leaveParty(m.id);
        this.parties.delete(code);
      }
    }
    for (const [id, m] of this.matched) if (now - m.at >= this.matchedTtlMs) this.matched.delete(id);
    for (const [id, x] of this.expired) if (now - x.at >= this.matchedTtlMs) this.expired.delete(id);

    for (const mode of ['singles', 'teams'] as const) this.matchMode(mode, now);
  }

  private matchMode(mode: RankedMode, now: number): void {
    const entries = [...new Set(this.queue.values())].filter((e) => e.mode === mode).sort((a, b) => a.joinedAt - b.joinedAt);
    const used = new Set<Entry>();
    for (const a of entries) {
      if (used.has(a) || !this.queue.has(a.members[0]!.id)) continue;
      let best: { b: Entry; diff: number } | null = null;
      for (const b of entries) {
        if (b === a || used.has(b) || !this.queue.has(b.members[0]!.id)) continue;
        if (this.conflict(a, b)) continue;
        const diff = Math.abs(a.rating - b.rating);
        const allowed = Math.max(ratingWindow(now - a.joinedAt), ratingWindow(now - b.joinedAt));
        if (diff > allowed) continue;
        if (!best || diff < best.diff) best = { b, diff };
      }
      if (best && this.makeMatch(a, best.b)) {
        used.add(a);
        used.add(best.b);
      }
    }
  }

  private conflict(a: Entry, b: Entry): boolean {
    for (const m of a.members) {
      if (b.members.some((n) => n.id === m.id)) return true;
      if (b.members.some((n) => a.avoid.has(n.id) || b.avoid.has(m.id))) return true;
    }
    return false;
  }

  private makeMatch(a: Entry, b: Entry): boolean {
    const [first, second] = this.rng() < 0.5 ? [a, b] : [b, a];
    const seats: Array<{ account: AccountRef; seat: 'A1' | 'A2' | 'B1' | 'B2' }> =
      first.mode === 'singles'
        ? [{ account: first.members[0]!, seat: 'A1' }, { account: second.members[0]!, seat: 'B1' }]
        : [
            { account: first.members[0]!, seat: 'A1' },
            { account: first.members[1]!, seat: 'A2' },
            { account: second.members[0]!, seat: 'B1' },
            { account: second.members[1]!, seat: 'B2' },
          ];
    try {
      const session = this.registry.createRanked(a.mode, seats);
      const at = this.sched.now();
      for (const s of seats) {
        this.queue.delete(s.account.id);
        this.matched.set(s.account.id, { matchId: session.id, mode: a.mode, at });
      }
      this.log('info', 'ranked match made', { id: session.id, mode: a.mode });
      return true;
    } catch (error) {
      if (error instanceof DomainError && error.code === 'already_in_match') {
        // someone got into another match while waiting: drop only them
        for (const e of [a, b]) if (e.members.some((m) => this.registry.activeMatchOf(m.id))) this.leaveQueue(e.members[0]!.id);
        return false;
      }
      if (error instanceof DomainError && (error.code === 'maintenance' || error.code === 'server_busy')) return false;
      this.log('error', 'could not start a ranked match', { error: String(error) });
      this.leaveQueue(a.members[0]!.id);
      this.leaveQueue(b.members[0]!.id);
      return false;
    }
  }
}
