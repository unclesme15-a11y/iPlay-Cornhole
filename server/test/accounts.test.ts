import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountService, isBanned } from '../src/accounts/service.js';
import { SessionService } from '../src/accounts/sessions.js';
import type { Db } from '../src/db/types.js';
import { backends, type TestDb } from './helpers/db.js';

const T0 = 1_800_000_000_000;
const DAY = 24 * 60 * 60_000;

describe.each(backends)('accounts and sessions ($name)', (backend) => {
  let handle: TestDb;
  let db: Db;
  let now = T0;
  let accounts: AccountService;
  let sessions: SessionService;

  beforeAll(async () => {
    handle = await backend.open();
    db = handle.db;
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(async () => {
    await db.exec('TRUNCATE accounts, matches, live_matches, reports RESTART IDENTITY CASCADE');
    now = T0;
    accounts = new AccountService(db, () => now);
    sessions = new SessionService(db, () => now);
  });

  describe('guests', () => {
    it('creates a guest with a friendly default name', async () => {
      const a = await accounts.createGuest();
      expect(a.displayName).toMatch(/^Player\d{4}$/);
      expect(a.isGuest).toBe(true);
      expect(a.status).toBe('active');
      expect((await accounts.get(a.id))?.displayName).toBe(a.displayName);
    });

    it('lets a guest pick a name up front, and applies the name filter', async () => {
      expect((await accounts.createGuest('Uncle Me')).displayName).toBe('Uncle Me');
      await expect(accounts.createGuest('sh1t')).rejects.toMatchObject({ code: 'name_profane', status: 400 });
      await expect(accounts.createGuest('iPlay Support')).rejects.toMatchObject({ code: 'name_reserved' });
      await expect(accounts.createGuest('a')).rejects.toMatchObject({ code: 'name_length' });
    });

    it('gives every account its own id', async () => {
      const ids = new Set((await Promise.all([1, 2, 3, 4, 5].map(() => accounts.createGuest()))).map((a) => a.id));
      expect(ids.size).toBe(5);
    });
  });

  describe('sign in with Apple or Google', () => {
    const apple = { provider: 'apple' as const, subject: 'apple-1' };
    const google = { provider: 'google' as const, subject: 'google-1' };

    it('creates an account the first time and finds it the next', async () => {
      const first = await accounts.signInWithIdentity(apple, { displayName: 'Keisha 34' });
      expect(first).toMatchObject({ created: true, linked: false });
      expect(first.account.isGuest).toBe(false);
      expect(first.account.displayName).toBe('Keisha 34');
      const second = await accounts.signInWithIdentity(apple);
      expect(second.created).toBe(false);
      expect(second.account.id).toBe(first.account.id);
    });

    it('turns a guest into a full account and keeps its id and stats', async () => {
      const guest = await accounts.createGuest('Dre');
      await db.query('INSERT INTO player_stats (account_id, games, wins) VALUES ($1, 7, 5)', [guest.id]);
      const r = await accounts.signInWithIdentity(apple, { linkTo: guest.id });
      expect(r).toMatchObject({ linked: true, created: false, switched: false });
      expect(r.account.id).toBe(guest.id);
      expect(r.account.isGuest).toBe(false);
      const stats = await db.query<{ games: number }>('SELECT games FROM player_stats WHERE account_id = $1', [guest.id]);
      expect(stats.rows[0]!.games).toBe(7);
    });

    it('signing in on a phone that holds a different guest switches to the existing account', async () => {
      const original = (await accounts.signInWithIdentity(apple)).account;
      const newGuest = await accounts.createGuest();
      const r = await accounts.signInWithIdentity(apple, { linkTo: newGuest.id });
      expect(r.account.id).toBe(original.id);
      expect(r.switched).toBe(true);
      expect(r.linked).toBe(false);
    });

    it('an account can link both Apple and Google, but not two Apple identities', async () => {
      const a = (await accounts.signInWithIdentity(apple)).account;
      const both = await accounts.signInWithIdentity(google, { linkTo: a.id });
      expect(both.account.id).toBe(a.id);
      await expect(accounts.signInWithIdentity({ provider: 'apple', subject: 'apple-2' }, { linkTo: a.id })).rejects.toMatchObject({ code: 'already_linked', status: 409 });
      // and signing in with either finds the same account
      expect((await accounts.signInWithIdentity(google)).account.id).toBe(a.id);
    });

    it('linking to an account that no longer exists creates a fresh one instead', async () => {
      const r = await accounts.signInWithIdentity(apple, { linkTo: 'missing-id' });
      expect(r.created).toBe(true);
    });

    it('ten devices signing in at once with the same brand-new identity end up with one account', async () => {
      const results = await Promise.all(Array.from({ length: 10 }, () => accounts.signInWithIdentity(apple)));
      expect(new Set(results.map((r) => r.account.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect((await db.query('SELECT 1 FROM accounts')).rowCount).toBe(1);
    });

    it('applies the name filter to a name sent with sign-in', async () => {
      await expect(accounts.signInWithIdentity(apple, { displayName: 'admin' })).rejects.toMatchObject({ code: 'name_reserved' });
      expect((await db.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
    });
  });

  describe('renaming', () => {
    it('the first custom name is free, then there is a cooldown', async () => {
      const a = await accounts.createGuest(); // default name, never changed
      const first = await accounts.rename(a.id, 'Big Mike');
      expect(first.displayName).toBe('Big Mike');
      const err = await accounts.rename(a.id, 'Travis').catch((e) => e);
      expect(err).toMatchObject({ code: 'rename_cooldown', status: 429 });
      expect(new Date(err.details.retryAt).getTime()).toBe(T0 + 7 * DAY);
      now += 7 * DAY + 1;
      expect((await accounts.rename(a.id, 'Travis')).displayName).toBe('Travis');
    });

    it('applies the name filter, and reports a missing account', async () => {
      const a = await accounts.createGuest();
      await expect(accounts.rename(a.id, 'f.u.c.k')).rejects.toMatchObject({ code: 'name_profane' });
      await expect(accounts.rename('nope', 'Fine Name')).rejects.toMatchObject({ code: 'unknown_account', status: 404 });
    });
  });

  describe('bans', () => {
    it('a permanent ban and a temporary ban', async () => {
      const a = await accounts.createGuest();
      const perm = await accounts.ban(a.id, 'cheating', null);
      expect(isBanned(perm, now)).toBe(true);
      const temp = await accounts.ban(a.id, 'rude', new Date(now + DAY));
      expect(isBanned(temp, now)).toBe(true);
      expect(isBanned(temp, now + 2 * DAY)).toBe(false);
      const back = await accounts.unban(a.id);
      expect(isBanned(back, now)).toBe(false);
      expect(back.banReason).toBeNull();
      await expect(accounts.ban('nope', 'x', null)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('deleting an account and exporting data', () => {
    async function withHistory() {
      const a = await accounts.signInWithIdentity({ provider: 'apple', subject: 'del-1' }, { displayName: 'Marisol' });
      const other = await accounts.createGuest('Carlos');
      await db.query("INSERT INTO player_stats (account_id, games, wins) VALUES ($1, 3, 2)", [a.account.id]);
      await db.query("INSERT INTO matches (id, code, config, created_at, ended_at, outcome, winner, score_a, score_b, innings) VALUES ('m1', 'CODE1234', '{}'::jsonb, now(), now(), 'score', 'A', 21, 5, 9)");
      await db.query("INSERT INTO match_players (match_id, seat, team, account_id, display_name, kind) VALUES ('m1', 'A1', 'A', $1, 'Marisol', 'human'), ('m1', 'B1', 'B', $2, 'Carlos', 'human')", [a.account.id, other.id]);
      await db.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [a.account.id, other.id]);
      await db.query("INSERT INTO reports (reporter_id, reported_id, reason) VALUES ($1, $2, 'other')", [a.account.id, other.id]);
      await sessions.issue(a.account.id);
      return { a: a.account, other };
    }

    it('exports everything we hold about a person', async () => {
      const { a } = await withHistory();
      const data = (await accounts.exportData(a.id)) as Record<string, any>;
      expect(data.account).toMatchObject({ id: a.id, displayName: 'Marisol' });
      expect(data.signInMethods).toHaveLength(1);
      expect(data.signInMethods[0].provider).toBe('apple');
      expect(data.stats).toMatchObject({ games: 3, wins: 2 });
      expect(data.matches).toHaveLength(1);
      expect(data.blockedPlayers).toHaveLength(1);
      expect(data.reportsFiled).toHaveLength(1);
      expect(JSON.stringify(data)).not.toContain('apple-user'); // no provider subject ids in the export
    });

    it('erases the person but keeps other players\' match history intact', async () => {
      const { a, other } = await withHistory();
      await accounts.delete(a.id);
      expect(await accounts.get(a.id)).toBeNull();
      for (const table of ['identities', 'sessions', 'player_stats', 'blocks']) {
        expect((await db.query(`SELECT 1 FROM ${table} WHERE ${table === 'blocks' ? 'blocker_id' : 'account_id'} = $1`, [a.id])).rowCount, table).toBe(0);
      }
      const players = await db.query<{ seat: string; display_name: string; account_id: string | null }>('SELECT seat, display_name, account_id FROM match_players ORDER BY seat');
      expect(players.rows[0]).toMatchObject({ seat: 'A1', display_name: 'Deleted player', account_id: null });
      expect(players.rows[1]).toMatchObject({ seat: 'B1', display_name: 'Carlos', account_id: other.id });
      expect((await db.query('SELECT reporter_id FROM reports')).rows[0]).toMatchObject({ reporter_id: null });
    });

    it('is fine to delete an account that has nothing attached', async () => {
      const g = await accounts.createGuest();
      await expect(accounts.delete(g.id)).resolves.toBeUndefined();
      await expect(accounts.exportData(g.id)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('sessions', () => {
    it('issues a token that identifies the account, and stores only a hash', async () => {
      const a = await accounts.createGuest();
      const { token, expiresAt } = await sessions.issue(a.id, { platform: 'ios', clientVersion: '1.2.3' });
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(expiresAt.getTime()).toBe(T0 + 90 * DAY);
      expect((await sessions.verify(token)).id).toBe(a.id);
      const rows = await db.query<{ token_hash: string; platform: string }>('SELECT token_hash, platform FROM sessions');
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.token_hash).not.toContain(token);
      expect(rows.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows.rows[0]!.platform).toBe('ios');
    });

    it('every token is different', async () => {
      const a = await accounts.createGuest();
      const tokens = new Set((await Promise.all([1, 2, 3].map(() => sessions.issue(a.id)))).map((s) => s.token));
      expect(tokens.size).toBe(3);
    });

    it.each(['', 'short', 'x'.repeat(43), 'a'.repeat(44), 'has spaces in it and is the right length ok', '../../etc/passwd'])('rejects the token %j', async (bad) => {
      await expect(sessions.verify(bad)).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
    });

    it('rejects an expired token and cleans it up', async () => {
      const a = await accounts.createGuest();
      const { token } = await sessions.issue(a.id);
      now += 91 * DAY;
      const fresh = new SessionService(db, () => now); // no memory of the token
      await expect(fresh.verify(token)).rejects.toMatchObject({ status: 401 });
      expect((await db.query('SELECT 1 FROM sessions')).rowCount).toBe(0);
    });

    it('keeps a session alive while it is used (sliding 90 days), but writes at most once an hour', async () => {
      const a = await accounts.createGuest();
      const { token } = await sessions.issue(a.id);
      const svc = new SessionService(db, () => now, { cacheMs: 0 });
      now += 10 * 60_000;
      await svc.verify(token);
      const before = (await db.query<{ expires_at: Date }>('SELECT expires_at FROM sessions')).rows[0]!.expires_at.getTime();
      expect(before).toBe(T0 + 90 * DAY); // not touched yet
      now += 60 * DAY;
      await svc.verify(token);
      const after = (await db.query<{ expires_at: Date }>('SELECT expires_at FROM sessions')).rows[0]!.expires_at.getTime();
      expect(after).toBe(now + 90 * DAY);
      // still valid 100 days after issue because it was used on day 60
      now += 40 * DAY;
      await expect(svc.verify(token)).resolves.toBeTruthy();
    });

    it('revokes one session or all of an account\'s sessions', async () => {
      const a = await accounts.createGuest();
      const s1 = await sessions.issue(a.id);
      const s2 = await sessions.issue(a.id);
      await sessions.verify(s1.token);
      await sessions.revoke(s1.token);
      await expect(sessions.verify(s1.token)).rejects.toMatchObject({ status: 401 });
      await expect(sessions.verify(s2.token)).resolves.toBeTruthy();
      await sessions.revokeAllFor(a.id);
      await expect(sessions.verify(s2.token)).rejects.toMatchObject({ status: 401 });
      await expect(sessions.revoke('garbage')).resolves.toBeUndefined();
    });

    it('turns away a banned account with the reason, and lets a temporary ban run out', async () => {
      const a = await accounts.createGuest();
      const { token } = await sessions.issue(a.id);
      await sessions.verify(token);
      await accounts.ban(a.id, 'harassment', new Date(now + DAY));
      sessions.forget(a.id);
      const err = await sessions.verify(token).catch((e) => e);
      expect(err).toMatchObject({ code: 'account_banned', status: 403 });
      expect(err.details).toMatchObject({ reason: 'harassment', bannedUntil: new Date(T0 + DAY).toISOString() });
      now += 2 * DAY;
      const back = await sessions.verify(token);
      expect(back.status).toBe('active');
      expect((await accounts.get(a.id))!.status).toBe('active');
    });

    it('a ban takes effect at once on this server when the cache is cleared, and within the cache time otherwise', async () => {
      const a = await accounts.createGuest();
      const { token } = await sessions.issue(a.id);
      await sessions.verify(token); // now remembered for 30 s
      await accounts.ban(a.id, 'x', null);
      await expect(sessions.verify(token)).resolves.toBeTruthy(); // still remembered
      now += 31_000;
      await expect(sessions.verify(token)).rejects.toMatchObject({ code: 'account_banned' });
    });

    it('sweeps expired sessions', async () => {
      const a = await accounts.createGuest();
      await sessions.issue(a.id);
      await sessions.issue(a.id);
      now += 91 * DAY;
      const live = await sessions.issue(a.id);
      expect(await sessions.sweepExpired()).toBe(2);
      await expect(sessions.verify(live.token)).resolves.toBeTruthy();
    });

    it('sessions disappear when their account is deleted', async () => {
      const a = await accounts.createGuest();
      const { token } = await sessions.issue(a.id);
      await accounts.delete(a.id);
      const fresh = new SessionService(db, () => now);
      await expect(fresh.verify(token)).rejects.toMatchObject({ status: 401 });
    });
  });
});
