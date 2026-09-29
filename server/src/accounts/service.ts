import { randomUUID } from 'node:crypto';
import { DomainError } from '../core/errors.js';
import type { Db, Queryable } from '../db/types.js';
import { checkDisplayName, defaultGuestName } from './nameFilter.js';
import type { VerifiedIdentity } from './providers.js';

export interface Account {
  id: string;
  displayName: string;
  isGuest: boolean;
  status: 'active' | 'banned';
  banReason: string | null;
  bannedUntil: Date | null;
  createdAt: Date;
  displayNameChangedAt: Date | null;
  lastSeenAt: Date;
}

export interface AccountRow {
  id: string;
  display_name: string;
  is_guest: boolean;
  status: 'active' | 'banned';
  ban_reason: string | null;
  banned_until: Date | null;
  created_at: Date;
  display_name_changed_at: Date | null;
  last_seen_at: Date;
}

export const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  displayName: r.display_name,
  isGuest: r.is_guest,
  status: r.status,
  banReason: r.ban_reason,
  bannedUntil: r.banned_until,
  createdAt: r.created_at,
  displayNameChangedAt: r.display_name_changed_at,
  lastSeenAt: r.last_seen_at,
});

/** What other players and the client may see about someone. */
export const publicAccount = (a: Account): { id: string; displayName: string; isGuest: boolean } => ({
  id: a.id,
  displayName: a.displayName,
  isGuest: a.isGuest,
});

export const isBanned = (a: Account, nowMs: number): boolean =>
  a.status === 'banned' && (a.bannedUntil === null || a.bannedUntil.getTime() > nowMs);

const UNIQUE_VIOLATION = '23505';
const isUniqueViolation = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: string }).code === UNIQUE_VIOLATION;

export interface AccountServiceOptions {
  /** Time you must wait between name changes (a first custom name is always free). */
  renameCooldownMs?: number;
}

export class AccountService {
  private readonly renameCooldownMs: number;

  constructor(
    private readonly db: Db,
    private readonly now: () => number,
    opts: AccountServiceOptions = {},
  ) {
    this.renameCooldownMs = opts.renameCooldownMs ?? 7 * 24 * 60 * 60_000;
  }

  /** Validates a name the person typed. Throws a 400 with a specific code if it is not allowed. */
  cleanName(raw: unknown): string {
    const check = checkDisplayName(raw);
    if (!check.ok) throw new DomainError(check.code, check.message, 400);
    return check.name;
  }

  async createGuest(displayName?: string): Promise<Account> {
    const name = displayName === undefined ? defaultGuestName() : this.cleanName(displayName);
    return this.insertAccount(this.db, name, true, displayName === undefined ? null : new Date(this.now()));
  }

  private async insertAccount(q: Queryable, name: string, isGuest: boolean, nameChangedAt: Date | null): Promise<Account> {
    const id = randomUUID();
    const res = await q.query<AccountRow>(
      `INSERT INTO accounts (id, display_name, is_guest, display_name_changed_at, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
      [id, name, isGuest, nameChangedAt, new Date(this.now())],
    );
    return toAccount(res.rows[0]!);
  }

  async get(id: string): Promise<Account | null> {
    const res = await this.db.query<AccountRow>('SELECT * FROM accounts WHERE id = $1', [id]);
    return res.rows[0] ? toAccount(res.rows[0]) : null;
  }

  /**
   * Finds or creates the account for a verified Apple/Google identity.
   * - Known identity: that account (even if you arrived holding a different guest account).
   * - New identity + a guest to attach it to: the guest keeps its stats and stops being a guest.
   * - New identity, nobody to attach it to: a brand new account.
   */
  async signInWithIdentity(
    identity: VerifiedIdentity,
    opts: { linkTo?: string; displayName?: string } = {},
  ): Promise<{ account: Account; created: boolean; linked: boolean; switched: boolean }> {
    const name = opts.displayName === undefined ? undefined : this.cleanName(opts.displayName);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.db.transaction(async (tx) => {
          const found = await tx.query<AccountRow>(
            `SELECT a.* FROM identities i JOIN accounts a ON a.id = i.account_id WHERE i.provider = $1 AND i.subject = $2`,
            [identity.provider, identity.subject],
          );
          if (found.rows[0]) {
            const account = toAccount(found.rows[0]);
            return { account, created: false, linked: false, switched: Boolean(opts.linkTo && opts.linkTo !== account.id) };
          }

          if (opts.linkTo) {
            const target = await tx.query<AccountRow>('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [opts.linkTo]);
            if (target.rows[0]) {
              const already = await tx.query('SELECT 1 FROM identities WHERE account_id = $1 AND provider = $2', [opts.linkTo, identity.provider]);
              if (already.rowCount > 0) {
                throw new DomainError('already_linked', `This account is already linked to a different ${identity.provider} sign-in`, 409);
              }
              await tx.query('INSERT INTO identities (provider, subject, account_id, created_at) VALUES ($1, $2, $3, $4)', [
                identity.provider,
                identity.subject,
                opts.linkTo,
                new Date(this.now()),
              ]);
              const updated = await tx.query<AccountRow>('UPDATE accounts SET is_guest = false WHERE id = $1 RETURNING *', [opts.linkTo]);
              return { account: toAccount(updated.rows[0]!), created: false, linked: true, switched: false };
            }
          }

          const account = await this.insertAccount(tx, name ?? defaultGuestName(), false, name ? new Date(this.now()) : null);
          await tx.query('INSERT INTO identities (provider, subject, account_id, created_at) VALUES ($1, $2, $3, $4)', [
            identity.provider,
            identity.subject,
            account.id,
            new Date(this.now()),
          ]);
          return { account, created: true, linked: false, switched: false };
        });
      } catch (e) {
        // Two devices signing in for the first time with the same identity: the second one loses the race and just looks it up.
        if (isUniqueViolation(e) && attempt === 0) continue;
        throw e;
      }
    }
    throw new DomainError('internal', 'Could not sign in', 500);
  }

  /** Which sign-in methods (apple, google) are linked to this account. */
  async providersOf(id: string): Promise<Array<'apple' | 'google'>> {
    const res = await this.db.query<{ provider: 'apple' | 'google' }>('SELECT provider FROM identities WHERE account_id = $1 ORDER BY provider', [id]);
    return res.rows.map((r) => r.provider);
  }

  async rename(id: string, raw: unknown): Promise<Account> {
    const name = this.cleanName(raw);
    const account = await this.get(id);
    if (!account) throw new DomainError('unknown_account', 'Account not found', 404);
    if (account.displayNameChangedAt) {
      const wait = account.displayNameChangedAt.getTime() + this.renameCooldownMs - this.now();
      if (wait > 0) {
        throw new DomainError('rename_cooldown', 'You changed your name recently', 429, { retryAt: new Date(this.now() + wait).toISOString() });
      }
    }
    const res = await this.db.query<AccountRow>(
      'UPDATE accounts SET display_name = $2, display_name_changed_at = $3 WHERE id = $1 RETURNING *',
      [id, name, new Date(this.now())],
    );
    return toAccount(res.rows[0]!);
  }

  async ban(id: string, reason: string, until: Date | null): Promise<Account> {
    const res = await this.db.query<AccountRow>(
      `UPDATE accounts SET status = 'banned', ban_reason = $2, banned_until = $3 WHERE id = $1 RETURNING *`,
      [id, reason.slice(0, 500), until],
    );
    if (!res.rows[0]) throw new DomainError('unknown_account', 'Account not found', 404);
    return toAccount(res.rows[0]);
  }

  async unban(id: string): Promise<Account> {
    const res = await this.db.query<AccountRow>(
      `UPDATE accounts SET status = 'active', ban_reason = NULL, banned_until = NULL WHERE id = $1 RETURNING *`,
      [id],
    );
    if (!res.rows[0]) throw new DomainError('unknown_account', 'Account not found', 404);
    return toAccount(res.rows[0]);
  }

  /**
   * Erases the account: its sign-in links, sessions, stats and blocks go away. Old match history
   * stays (other players are in it) but the person's name is replaced and it no longer points to them.
   */
  async delete(id: string): Promise<void> {
    // A database trigger renames the person in old match history as part of this same delete.
    await this.db.query('DELETE FROM accounts WHERE id = $1', [id]);
  }

  /** Everything we hold about a person, for a data-access request. */
  async exportData(id: string): Promise<Record<string, unknown>> {
    const account = await this.get(id);
    if (!account) throw new DomainError('unknown_account', 'Account not found', 404);
    const q = this.db;
    const [identities, stats, matches, blocks, reports] = await Promise.all([
      q.query('SELECT provider, created_at FROM identities WHERE account_id = $1', [id]),
      q.query('SELECT games, wins, losses, leaves, throws, holes, boards, fouls FROM player_stats WHERE account_id = $1', [id]),
      q.query(
        `SELECT m.code, m.ended_at, m.outcome, m.winner, m.score_a, m.score_b, m.innings, p.seat, p.team, p.left_early, p.throws, p.holes, p.boards, p.fouls
         FROM match_players p JOIN matches m ON m.id = p.match_id WHERE p.account_id = $1 ORDER BY m.ended_at DESC LIMIT 500`,
        [id],
      ),
      q.query('SELECT blocked_id, created_at FROM blocks WHERE blocker_id = $1', [id]),
      q.query('SELECT reported_id, match_id, reason, note, status, created_at FROM reports WHERE reporter_id = $1', [id]),
    ]);
    return {
      exportedAt: new Date(this.now()).toISOString(),
      account: { id: account.id, displayName: account.displayName, isGuest: account.isGuest, createdAt: account.createdAt, lastSeenAt: account.lastSeenAt },
      signInMethods: identities.rows,
      stats: stats.rows[0] ?? null,
      matches: matches.rows,
      blockedPlayers: blocks.rows,
      reportsFiled: reports.rows,
    };
  }
}
