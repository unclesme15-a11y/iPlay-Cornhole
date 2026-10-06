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
  /** When they confirmed they are 18 or older (every iPlay game is for adults). */
  adultConfirmedAt: Date | null;
  /** The version of the terms they last accepted. */
  termsVersion: number | null;
  /** Whether their name appears on the public leaderboards. */
  showOnLeaderboards: boolean;
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
  adult_confirmed_at: Date | null;
  terms_version: string | null;
  show_on_leaderboards: boolean;
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
  adultConfirmedAt: r.adult_confirmed_at,
  termsVersion: r.terms_version === null ? null : Number(r.terms_version),
  showOnLeaderboards: r.show_on_leaderboards,
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
  /** New accounts must confirm they are 18 or older. */
  requireAdult?: boolean;
  /** The current terms version, stamped on new accounts. */
  termsVersion?: number;
}

export class AccountService {
  private readonly renameCooldownMs: number;
  private readonly requireAdult: boolean;
  readonly termsVersion: number;

  constructor(
    private readonly db: Db,
    private readonly now: () => number,
    opts: AccountServiceOptions = {},
  ) {
    this.renameCooldownMs = opts.renameCooldownMs ?? 7 * 24 * 60 * 60_000;
    this.requireAdult = opts.requireAdult ?? true;
    this.termsVersion = opts.termsVersion ?? 1;
  }

  /** True if this person has confirmed they are an adult (or the server does not ask for it). */
  meetsAgeRequirement(account: Account): boolean {
    return !this.requireAdult || account.adultConfirmedAt !== null;
  }

  /** Throws unless the person has confirmed they are 18 or older. Used before ranked play and voice. */
  requireAdultAccount(account: Account): void {
    if (!this.meetsAgeRequirement(account)) {
      throw new DomainError('adult_confirmation_required', 'Confirm that you are 18 or older to use this', 403);
    }
  }

  /** Throws unless the person has accepted the current terms. Used before ranked play and voice. */
  requireCurrentTerms(account: Account): void {
    if (this.needsTermsAccept(account)) {
      throw new DomainError('terms_update_required', 'Please accept the updated terms to continue', 403, { currentTermsVersion: this.termsVersion });
    }
  }

  /** Adult and up to date on the terms: the bar for anything social (ranked, voice). */
  requireEligibleForSocial(account: Account): void {
    this.requireAdultAccount(account);
    this.requireCurrentTerms(account);
  }

  private assertAdultConfirmed(confirmed: boolean | undefined): void {
    if (this.requireAdult && !confirmed) {
      throw new DomainError('adult_confirmation_required', 'You must confirm that you are 18 or older to play', 400);
    }
  }

  /** Validates a name the person typed. Throws a 400 with a specific code if it is not allowed. */
  cleanName(raw: unknown): string {
    const check = checkDisplayName(raw);
    if (!check.ok) throw new DomainError(check.code, check.message, 400);
    return check.name;
  }

  async createGuest(displayName?: string, opts: { adultConfirmed?: boolean } = {}): Promise<Account> {
    this.assertAdultConfirmed(opts.adultConfirmed);
    const name = displayName === undefined ? defaultGuestName() : this.cleanName(displayName);
    return this.insertAccount(this.db, name, true, displayName === undefined ? null : new Date(this.now()), Boolean(opts.adultConfirmed));
  }

  private async insertAccount(q: Queryable, name: string, isGuest: boolean, nameChangedAt: Date | null, adultConfirmed: boolean): Promise<Account> {
    const id = randomUUID();
    const now = new Date(this.now());
    const res = await q.query<AccountRow>(
      `INSERT INTO accounts (id, display_name, is_guest, display_name_changed_at, created_at, last_seen_at, adult_confirmed_at, terms_version)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7) RETURNING *`,
      [id, name, isGuest, nameChangedAt, now, adultConfirmed ? now : null, adultConfirmed ? String(this.termsVersion) : null],
    );
    return toAccount(res.rows[0]!);
  }

  /** For accounts made before adults-only was switched on: they confirm now. */
  async confirmAdult(id: string): Promise<Account> {
    const res = await this.db.query<AccountRow>(
      `UPDATE accounts SET adult_confirmed_at = COALESCE(adult_confirmed_at, $2), terms_version = COALESCE(terms_version, $3) WHERE id = $1 RETURNING *`,
      [id, new Date(this.now()), String(this.termsVersion)],
    );
    if (!res.rows[0]) throw new DomainError('unknown_account', 'Account not found', 404);
    return toAccount(res.rows[0]);
  }

  /** The person accepts the current terms. */
  async acceptTerms(id: string, version: number): Promise<Account> {
    if (version !== this.termsVersion) throw new DomainError('bad_terms_version', `The current terms are version ${this.termsVersion}`, 409);
    const res = await this.db.query<AccountRow>('UPDATE accounts SET terms_version = $2 WHERE id = $1 RETURNING *', [id, String(version)]);
    if (!res.rows[0]) throw new DomainError('unknown_account', 'Account not found', 404);
    return toAccount(res.rows[0]);
  }

  /** True when the terms have changed since they last accepted. */
  needsTermsAccept(account: Account): boolean {
    return (account.termsVersion ?? 0) < this.termsVersion;
  }

  async setLeaderboardVisibility(id: string, visible: boolean): Promise<Account> {
    const res = await this.db.query<AccountRow>('UPDATE accounts SET show_on_leaderboards = $2 WHERE id = $1 RETURNING *', [id, visible]);
    if (!res.rows[0]) throw new DomainError('unknown_account', 'Account not found', 404);
    return toAccount(res.rows[0]);
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
    opts: { linkTo?: string; displayName?: string; adultConfirmed?: boolean } = {},
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
              const updated = await tx.query<AccountRow>(
                `UPDATE accounts SET is_guest = false,
                   adult_confirmed_at = CASE WHEN $2::boolean THEN COALESCE(adult_confirmed_at, $3) ELSE adult_confirmed_at END
                 WHERE id = $1 RETURNING *`,
                [opts.linkTo, Boolean(opts.adultConfirmed), new Date(this.now())],
              );
              return { account: toAccount(updated.rows[0]!), created: false, linked: true, switched: false };
            }
          }

          this.assertAdultConfirmed(opts.adultConfirmed);
          const account = await this.insertAccount(tx, name ?? defaultGuestName(), false, name ? new Date(this.now()) : null, Boolean(opts.adultConfirmed));
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
    const [identities, stats, matches, blocks, reports, singles, duos, cooldown, seasons, pushDevices, pushSettings] = await Promise.all([
      q.query('SELECT provider, created_at FROM identities WHERE account_id = $1', [id]),
      q.query('SELECT games, wins, losses, leaves, throws, holes, boards, fouls FROM player_stats WHERE account_id = $1', [id]),
      q.query(
        `SELECT m.code, m.ended_at, m.outcome, m.winner, m.score_a, m.score_b, m.innings, p.seat, p.team, p.left_early, p.throws, p.holes, p.boards, p.fouls
         FROM match_players p JOIN matches m ON m.id = p.match_id WHERE p.account_id = $1 ORDER BY m.ended_at DESC LIMIT 500`,
        [id],
      ),
      q.query('SELECT blocked_id, created_at FROM blocks WHERE blocker_id = $1', [id]),
      q.query('SELECT reported_id, match_id, reason, note, status, created_at FROM reports WHERE reporter_id = $1', [id]),
      q.query('SELECT rating, peak, games, wins, losses, streak, last_played_at FROM singles_ratings WHERE account_id = $1', [id]),
      q.query(
        `SELECT CASE WHEN member_a = $1 THEN member_b ELSE member_a END AS partner_id, rating, peak, games, wins, losses, streak, last_played_at
           FROM duo_ratings WHERE member_a = $1 OR member_b = $1 ORDER BY rating DESC`,
        [id],
      ),
      q.query('SELECT until, reason FROM ranked_cooldowns WHERE account_id = $1', [id]),
      q.query(
        `SELECT season, mode, rank, rating, peak, games, wins, losses,
                CASE WHEN mode = 'teams' THEN CASE WHEN member_a = $1 THEN member_b ELSE member_a END END AS partner_id
           FROM season_results WHERE member_a = $1 OR member_b = $1 ORDER BY season DESC, mode`,
        [id],
      ),
      q.query('SELECT platform, app_version, created_at, updated_at FROM push_devices WHERE account_id = $1', [id]),
      q.query('SELECT push_settings FROM accounts WHERE id = $1', [id]),
    ]);
    return {
      exportedAt: new Date(this.now()).toISOString(),
      account: {
        id: account.id,
        displayName: account.displayName,
        isGuest: account.isGuest,
        createdAt: account.createdAt,
        lastSeenAt: account.lastSeenAt,
        adultConfirmedAt: account.adultConfirmedAt,
        termsVersion: account.termsVersion,
        showOnLeaderboards: account.showOnLeaderboards,
      },
      signInMethods: identities.rows,
      stats: stats.rows[0] ?? null,
      ratings: { singles: singles.rows[0] ?? null, teams: duos.rows },
      rankedCooldown: cooldown.rows[0] ?? null,
      seasonResults: seasons.rows,
      // the push token itself is left out: it is a delivery address, not information about the person
      pushNotifications: { devices: pushDevices.rows, settings: pushSettings.rows[0]?.push_settings ?? {} },
      matches: matches.rows,
      blockedPlayers: blocks.rows,
      reportsFiled: reports.rows,
    };
  }
}
