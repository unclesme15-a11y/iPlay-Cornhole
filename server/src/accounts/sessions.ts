import { createHash, randomBytes } from 'node:crypto';
import { DomainError } from '../core/errors.js';
import type { Db } from '../db/types.js';
import { isBanned, toAccount, type Account, type AccountRow } from './service.js';

export interface SessionOptions {
  /** A session lasts this long after its last use. */
  ttlMs?: number;
  /** How long a verified token is remembered in memory before the database is asked again. */
  cacheMs?: number;
  /** Don't rewrite last-used more often than this. */
  touchEveryMs?: number;
}

export interface SessionMeta {
  platform?: string | undefined;
  clientVersion?: string | undefined;
}

interface Cached {
  account: Account;
  until: number;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Tokens are 32 random bytes as base64url: exactly 43 characters. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Login sessions. The token we hand the app is random; we store only its SHA-256, so a copy of the
 * database cannot be used to log in as anyone. A session lasts 90 days from its last use.
 */
export class SessionService {
  private readonly ttl: number;
  private readonly cacheMs: number;
  private readonly touchEvery: number;
  private readonly cache = new Map<string, Cached>();

  constructor(
    private readonly db: Db,
    private readonly now: () => number,
    opts: SessionOptions = {},
  ) {
    this.ttl = opts.ttlMs ?? 90 * 24 * 60 * 60_000;
    this.cacheMs = opts.cacheMs ?? 30_000;
    this.touchEvery = opts.touchEveryMs ?? 60 * 60_000;
  }

  async issue(accountId: string, meta: SessionMeta = {}): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const expiresAt = new Date(now + this.ttl);
    await this.db.query(
      `INSERT INTO sessions (token_hash, account_id, created_at, last_used_at, expires_at, platform, client_version)
       VALUES ($1, $2, $3, $3, $4, $5, $6)`,
      [hashToken(token), accountId, new Date(now), expiresAt, meta.platform?.slice(0, 20) ?? null, meta.clientVersion?.slice(0, 20) ?? null],
    );
    return { token, expiresAt };
  }

  /** Returns the account for a token, or throws 401 (bad/expired token) or 403 (banned). */
  async verify(token: string): Promise<Account> {
    if (!TOKEN_PATTERN.test(token)) throw unauthorized();
    const hash = hashToken(token);
    const now = this.now();

    const cached = this.cache.get(hash);
    if (cached && cached.until > now) {
      this.assertNotBanned(cached.account, now);
      return cached.account;
    }

    const res = await this.db.query<AccountRow & { expires_at: Date; last_used_at: Date }>(
      `SELECT a.*, s.expires_at, s.last_used_at FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1`,
      [hash],
    );
    const row = res.rows[0];
    if (!row) throw unauthorized();
    if (row.expires_at.getTime() <= now) {
      await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [hash]);
      throw unauthorized();
    }
    let account = toAccount(row);
    this.assertNotBanned(account, now);

    // A ban that has run out: clear it so the account shows as normal everywhere.
    if (account.status === 'banned') {
      await this.db.query("UPDATE accounts SET status = 'active', ban_reason = NULL, banned_until = NULL WHERE id = $1", [account.id]);
      account = { ...account, status: 'active', banReason: null, bannedUntil: null };
    }

    if (now - row.last_used_at.getTime() > this.touchEvery) {
      await this.db.query('UPDATE sessions SET last_used_at = $2, expires_at = $3 WHERE token_hash = $1', [hash, new Date(now), new Date(now + this.ttl)]);
      await this.db.query('UPDATE accounts SET last_seen_at = $2 WHERE id = $1', [account.id, new Date(now)]);
    }
    this.cache.set(hash, { account, until: now + this.cacheMs });
    return account;
  }

  private assertNotBanned(account: Account, now: number): void {
    if (isBanned(account, now)) {
      throw new DomainError('account_banned', 'This account is banned', 403, {
        reason: account.banReason,
        bannedUntil: account.bannedUntil ? account.bannedUntil.toISOString() : null,
      });
    }
  }

  async revoke(token: string): Promise<void> {
    if (!TOKEN_PATTERN.test(token)) return;
    const hash = hashToken(token);
    this.cache.delete(hash);
    await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [hash]);
  }

  async revokeAllFor(accountId: string): Promise<void> {
    this.forget(accountId);
    await this.db.query('DELETE FROM sessions WHERE account_id = $1', [accountId]);
  }

  /** Drops remembered copies of an account (after a ban, unban, rename or delete) so the change shows at once on this server. */
  forget(accountId: string): void {
    for (const [hash, c] of this.cache) if (c.account.id === accountId) this.cache.delete(hash);
  }

  /** Deletes sessions that ran out. Run now and then. */
  async sweepExpired(): Promise<number> {
    const res = await this.db.query('DELETE FROM sessions WHERE expires_at <= $1', [new Date(this.now())]);
    return res.rowCount;
  }
}

const unauthorized = (): DomainError => new DomainError('unauthorized', 'Missing or invalid credentials', 401);
