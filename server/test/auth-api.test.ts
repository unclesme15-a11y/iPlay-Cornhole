import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/types.js';
import type { MatchSummary } from '../src/accounts/history.js';
import { TestEnv, type Booted } from './helpers/app.js';
import { StaticKeys, makeKey, signJwt } from './helpers/jwt.js';

let env: TestEnv;
beforeAll(async () => {
  env = await TestEnv.create();
});
afterAll(async () => {
  await env.destroy();
});
afterEach(async () => {
  await env.closeAll();
});

const ADMIN = 'a'.repeat(40);
const key = makeKey('k1');
const NONCE = 'nonce-value-12345';
const hashed = createHash('sha256').update(NONCE).digest('hex');

const bootWithProviders = (extra: Record<string, string> = {}) =>
  env.boot({
    env: { APPLE_CLIENT_IDS: 'com.iplay.cornhole', GOOGLE_CLIENT_IDS: 'google-client-1', ADMIN_TOKEN: ADMIN, ...extra },
    overrides: { appleKeys: new StaticKeys([key]), googleKeys: new StaticKeys([key]) },
  });

const appleToken = (t: Booted, sub = 'apple-sub-1', over: Record<string, unknown> = {}) => {
  const now = t.scheduler.now() / 1000;
  return signJwt(key, { iss: 'https://appleid.apple.com', aud: 'com.iplay.cornhole', sub, iat: now - 5, exp: now + 600, nonce: hashed, ...over });
};
const googleToken = (t: Booted, sub = 'google-sub-1') => {
  const now = t.scheduler.now() / 1000;
  return signJwt(key, { iss: 'https://accounts.google.com', aud: 'google-client-1', sub, iat: now - 5, exp: now + 600, nonce: NONCE });
};

const admin = (t: Booted, method: 'GET' | 'POST', url: string, payload?: unknown) => t.call(ADMIN, method, url, payload);

describe('guests', () => {
  it('signs up a guest who can use the API straight away', async () => {
    const t = await env.boot();
    const res = await t.call(null, 'POST', '/api/auth/guest', { confirmAdult: true });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(json.account).toMatchObject({ isGuest: true });
    expect(json.account.displayName).toMatch(/^Player\d{4}$/);
    expect(new Date(json.expiresAt).getTime()).toBe(t.scheduler.now() + 90 * 24 * 60 * 60_000);
    const me = await t.call(json.token, 'GET', '/api/me');
    expect(me.json().account.id).toBe(json.account.id);
  });

  it('applies the name filter to a chosen name', async () => {
    const t = await env.boot();
    expect((await t.call(null, 'POST', '/api/auth/guest', { displayName: 'sh1t', confirmAdult: true })).json().error.code).toBe('name_profane');
    expect((await t.call(null, 'POST', '/api/auth/guest', { displayName: 'iPlay Support', confirmAdult: true })).json().error.code).toBe('name_reserved');
    expect((await t.call(null, 'POST', '/api/auth/guest', { displayName: 'Big Mike', confirmAdult: true })).json().account.displayName).toBe('Big Mike');
  });

  it('can be switched off so only Apple and Google accounts exist', async () => {
    const t = await env.boot({ env: { ALLOW_GUESTS: 'false' } });
    const res = await t.call(null, 'POST', '/api/auth/guest', { confirmAdult: true });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('guests_disabled');
  });

  it('rejects unknown fields', async () => {
    const t = await env.boot();
    expect((await t.call(null, 'POST', '/api/auth/guest', { displayName: 'Fine Name', isAdmin: true, confirmAdult: true })).statusCode).toBe(400);
  });
});

describe('sign in with Apple and Google', () => {
  it('creates an account on first sign-in and finds it on the next', async () => {
    const t = await bootWithProviders();
    const first = await t.call(null, 'POST', '/api/auth/apple', { identityToken: appleToken(t), nonce: NONCE, displayName: 'Keisha 34', confirmAdult: true });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ created: true, linked: false, account: { displayName: 'Keisha 34', isGuest: false } });
    const second = await t.call(null, 'POST', '/api/auth/apple', { identityToken: appleToken(t), nonce: NONCE, confirmAdult: true });
    expect(second.statusCode).toBe(200);
    expect(second.json().account.id).toBe(first.json().account.id);
    expect(second.json().token).not.toBe(first.json().token); // a new session on each sign-in
    const me = await t.call(second.json().token, 'GET', '/api/me');
    expect(me.json().signInMethods).toEqual(['apple']);
  });

  it('works for Google too', async () => {
    const t = await bootWithProviders();
    const res = await t.call(null, 'POST', '/api/auth/google', { idToken: googleToken(t), nonce: NONCE, confirmAdult: true });
    expect(res.statusCode).toBe(201);
    expect((await t.call(res.json().token, 'GET', '/api/me')).json().signInMethods).toEqual(['google']);
  });

  it('rejects a forged token, a wrong nonce, an expired token and a missing nonce', async () => {
    const t = await bootWithProviders();
    const forger = makeKey('k1');
    const now = t.scheduler.now() / 1000;
    const forged = signJwt(forger, { iss: 'https://appleid.apple.com', aud: 'com.iplay.cornhole', sub: 'x', exp: now + 600, nonce: hashed });
    expect((await t.call(null, 'POST', '/api/auth/apple', { identityToken: forged, nonce: NONCE, confirmAdult: true })).json().error.code).toBe('invalid_identity_token');
    expect((await t.call(null, 'POST', '/api/auth/apple', { identityToken: appleToken(t), nonce: 'a-different-nonce', confirmAdult: true })).json().error.code).toBe('invalid_identity_token');
    expect((await t.call(null, 'POST', '/api/auth/apple', { identityToken: appleToken(t, 'x', { exp: now - 3600 }), nonce: NONCE, confirmAdult: true })).json().error.code).toBe('invalid_identity_token');
    const noNonce = await t.call(null, 'POST', '/api/auth/apple', { identityToken: appleToken(t), confirmAdult: true });
    expect(noNonce.statusCode).toBe(400);
    expect(noNonce.json().error.code).toBe('nonce_required');
    expect((await t.db.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
  });

  it('reports a provider that is not set up', async () => {
    const t = await env.boot();
    const res = await t.call(null, 'POST', '/api/auth/apple', { identityToken: 'x'.repeat(30), nonce: NONCE, confirmAdult: true });
    expect(res.statusCode).toBe(501);
    expect(res.json().error.code).toBe('provider_not_configured');
  });

  it('a signed-in guest who signs in with Apple keeps their account and stats', async () => {
    const t = await bootWithProviders();
    const guest = await t.guest('Dre Dre');
    await t.db.query('INSERT INTO player_stats (account_id, games, wins) VALUES ($1, 4, 3)', [guest.id]);
    const res = await t.call(guest.token, 'POST', '/api/auth/apple', { identityToken: appleToken(t), nonce: NONCE, confirmAdult: true });
    expect(res.json()).toMatchObject({ linked: true, created: false, switched: false, account: { id: guest.id, isGuest: false } });
    const me = (await t.call(res.json().token, 'GET', '/api/me')).json();
    expect(me.stats).toMatchObject({ games: 4, wins: 3 });
    expect(me.signInMethods).toEqual(['apple']);
  });

  it('signing in on a phone that holds a different guest switches to the existing account', async () => {
    const t = await bootWithProviders();
    const original = await t.call(null, 'POST', '/api/auth/apple', { identityToken: appleToken(t), nonce: NONCE, confirmAdult: true });
    const newGuest = await t.guest();
    const res = await t.call(newGuest.token, 'POST', '/api/auth/apple', { identityToken: appleToken(t), nonce: NONCE, confirmAdult: true });
    expect(res.json()).toMatchObject({ switched: true, linked: false });
    expect(res.json().account.id).toBe(original.json().account.id);
  });

  it('the name filter applies to a name sent with sign-in', async () => {
    const t = await bootWithProviders();
    const res = await t.call(null, 'POST', '/api/auth/apple', { identityToken: appleToken(t), nonce: NONCE, displayName: 'admin', confirmAdult: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('name_reserved');
  });
});

describe('sessions', () => {
  it('logout ends that session only', async () => {
    const t = await env.boot();
    const a = await t.guest();
    const otherSession = await t.services.sessions.issue(a.id);
    expect((await t.call(a.token, 'POST', '/api/auth/logout')).statusCode).toBe(200);
    expect((await t.call(a.token, 'GET', '/api/me')).statusCode).toBe(401);
    expect((await t.call(otherSession.token, 'GET', '/api/me')).statusCode).toBe(200);
  });

  it('a session that ran out is refused', async () => {
    const t = await env.boot();
    const a = await t.guest();
    t.scheduler.advance(91 * 24 * 60 * 60_000);
    expect((await t.call(a.token, 'GET', '/api/me')).statusCode).toBe(401);
  });
});

describe('my account', () => {
  it('shows account, stats, sign-in methods and any match to rejoin', async () => {
    const t = await env.boot();
    const a = await t.guest('Uncle Me');
    let me = (await t.call(a.token, 'GET', '/api/me')).json();
    expect(me).toMatchObject({ account: { id: a.id, displayName: 'Uncle Me', isGuest: true }, signInMethods: [], activeMatchId: null });
    expect(me.stats).toEqual({ games: 0, wins: 0, losses: 0, leaves: 0, throws: 0, holes: 0, boards: 0, fouls: 0 });
    const created = (await t.call(a.token, 'POST', '/api/matches', {})).json();
    me = (await t.call(a.token, 'GET', '/api/me')).json();
    expect(me.activeMatchId).toBe(created.matchId); // after an app crash, the app can offer to rejoin
  });

  it('renames with the filter and a 7 day cooldown', async () => {
    const t = await env.boot();
    const a = await t.guest();
    expect((await t.call(a.token, 'PATCH', '/api/me', { displayName: 'Big Mike' })).json().account.displayName).toBe('Big Mike');
    const again = await t.call(a.token, 'PATCH', '/api/me', { displayName: 'Travis' });
    expect(again.statusCode).toBe(429);
    expect(again.json().error).toMatchObject({ code: 'rename_cooldown' });
    expect(new Date(again.json().error.retryAt).getTime()).toBe(t.scheduler.now() + 7 * 24 * 60 * 60_000);
    t.scheduler.advance(7 * 24 * 60 * 60_000 + 1);
    expect((await t.call(a.token, 'PATCH', '/api/me', { displayName: 'f.u.c.k' })).json().error.code).toBe('name_profane');
    expect((await t.call(a.token, 'PATCH', '/api/me', { displayName: 'Travis' })).statusCode).toBe(200);
  });

  it('a rename shows up in the next match seat', async () => {
    const t = await env.boot();
    const a = await t.guest();
    await t.call(a.token, 'PATCH', '/api/me', { displayName: 'Marisol' });
    const created = (await t.call(a.token, 'POST', '/api/matches', {})).json();
    expect(created.view.seats[0].name).toBe('Marisol');
  });

  it('exports everything held about the person', async () => {
    const t = await env.boot();
    const a = await t.guest('Keisha 34');
    const res = await t.call(a.token, 'GET', '/api/me/export');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ account: { id: a.id, displayName: 'Keisha 34' }, matches: [], blockedPlayers: [] });
  });

  it('deleting the account erases it, pulls the person out of their match, and invalidates the login', async () => {
    const t = await env.boot();
    const a = await t.guest('Marisol T');
    const created = (await t.call(a.token, 'POST', '/api/matches', {})).json();
    const del = await t.call(a.token, 'DELETE', '/api/me');
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deleted: true });
    expect((await t.call(a.token, 'GET', '/api/me')).statusCode).toBe(401);
    expect((await t.db.query('SELECT 1 FROM accounts')).rowCount).toBe(0);
    expect(t.services.registry.get(created.matchId)!.currentPhase).toBe('abandoned'); // they were the only human
  });

  it('pages through match history', async () => {
    const t = await env.boot();
    const a = await t.guest('Player One');
    const T0 = t.scheduler.now();
    for (let i = 0; i < 5; i++) {
      const summary: MatchSummary = {
        code: `CODE000${i}`, config: { ...DEFAULT_CONFIG, mode: '1v1' }, createdAt: new Date(T0), startedAt: new Date(T0), endedAt: new Date(T0 + i * 60_000),
        outcome: 'score', winner: 'A', scores: { A: 21, B: i }, innings: 8, rematchOf: null,
        players: [{ seat: 'A1', team: 'A', accountId: a.id, displayName: 'Player One', kind: 'human', botLevel: null, characterId: 'keisha', leftEarly: false, throws: 8, holes: 2, boards: 3, fouls: 1 }],
      };
      await t.services.history.record(summary);
    }
    const page1 = (await t.call(a.token, 'GET', '/api/me/matches?limit=2')).json();
    expect(page1.matches.map((m: { code: string }) => m.code)).toEqual(['CODE0004', 'CODE0003']);
    expect(page1.next).toBeTruthy();
    const page2 = (await t.call(a.token, 'GET', `/api/me/matches?limit=2&before=${encodeURIComponent(page1.next)}`)).json();
    expect(page2.matches.map((m: { code: string }) => m.code)).toEqual(['CODE0002', 'CODE0001']);
    const last = (await t.call(a.token, 'GET', `/api/me/matches?limit=2&before=${encodeURIComponent(page2.next)}`)).json();
    expect(last.matches.map((m: { code: string }) => m.code)).toEqual(['CODE0000']);
    expect(last.next).toBeNull();
    expect((await t.call(a.token, 'GET', '/api/me/matches?limit=500')).statusCode).toBe(400);
  });

  it('needs a login for every account route', async () => {
    const t = await env.boot();
    for (const [method, url] of [['GET', '/api/me'], ['PATCH', '/api/me'], ['DELETE', '/api/me'], ['GET', '/api/me/export'], ['GET', '/api/me/matches'], ['GET', '/api/blocks'], ['POST', '/api/reports']] as const) {
      expect((await t.call(null, method, url, method === 'GET' || method === 'DELETE' ? undefined : {})).statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('blocking and reporting', () => {
  it('blocks, lists and unblocks a player', async () => {
    const t = await env.boot();
    const a = await t.guest('Alice A');
    const b = await t.guest('Bobby B');
    expect((await t.call(a.token, 'PUT', `/api/blocks/${b.id}`)).json()).toEqual({ blocked: true });
    const list = (await t.call(a.token, 'GET', '/api/blocks')).json();
    expect(list.blocks).toHaveLength(1);
    expect(list.blocks[0]).toMatchObject({ accountId: b.id, displayName: 'Bobby B' });
    expect((await t.call(b.token, 'GET', '/api/blocks')).json().blocks).toHaveLength(0); // private and one-way
    expect((await t.call(a.token, 'DELETE', `/api/blocks/${b.id}`)).json()).toEqual({ blocked: false });
    expect((await t.call(a.token, 'GET', '/api/blocks')).json().blocks).toHaveLength(0);
    expect((await t.call(a.token, 'PUT', `/api/blocks/${a.id}`)).statusCode).toBe(400);
    expect((await t.call(a.token, 'PUT', '/api/blocks/nobody')).statusCode).toBe(404);
  });

  it('files a report that staff can review and close', async () => {
    const t = await bootWithProviders();
    const a = await t.guest('Reporter R');
    const b = await t.guest('Reported P');
    const res = await t.call(a.token, 'POST', '/api/reports', { accountId: b.id, matchId: 'ABCD2345', reason: 'harassment', note: 'kept shouting' });
    expect(res.statusCode).toBe(201);
    const again = await t.call(a.token, 'POST', '/api/reports', { accountId: b.id, reason: 'cheating' });
    expect(again.json().reportId).toBe(res.json().reportId); // no pile-ups
    const listed = (await admin(t, 'GET', '/admin/reports')).json().reports;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ reason: 'harassment', note: 'kept shouting', reporterName: 'Reporter R', reportedName: 'Reported P', status: 'open' });
    expect((await admin(t, 'POST', `/admin/reports/${res.json().reportId}`, { status: 'resolved' })).json().status).toBe('resolved');
    expect((await admin(t, 'GET', '/admin/reports')).json().reports).toHaveLength(0);
    expect((await admin(t, 'GET', '/admin/reports?status=resolved')).json().reports).toHaveLength(1);
    expect((await admin(t, 'POST', `/admin/reports/${res.json().reportId}`, { status: 'dismissed' })).statusCode).toBe(404); // already closed
  });

  it('validates reports', async () => {
    const t = await env.boot();
    const a = await t.guest();
    const b = await t.guest();
    expect((await t.call(a.token, 'POST', '/api/reports', { accountId: b.id, reason: 'boredom' })).statusCode).toBe(400);
    expect((await t.call(a.token, 'POST', '/api/reports', { accountId: a.id, reason: 'other' })).statusCode).toBe(400);
    expect((await t.call(a.token, 'POST', '/api/reports', { accountId: 'nobody', reason: 'other' })).statusCode).toBe(404);
    expect((await t.call(a.token, 'POST', '/api/reports', { accountId: b.id, reason: 'other', extra: 1 })).statusCode).toBe(400);
  });
});

describe('admin', () => {
  it('does not exist unless ADMIN_TOKEN is set', async () => {
    const t = await env.boot();
    expect((await t.call('x'.repeat(43), 'GET', '/admin/status')).statusCode).toBe(404);
  });

  it('refuses anyone without the secret', async () => {
    const t = await bootWithProviders();
    const player = await t.guest();
    expect((await t.call(null, 'GET', '/admin/status')).statusCode).toBe(401);
    expect((await t.call(player.token, 'GET', '/admin/status')).statusCode).toBe(401);
    expect((await t.call('b'.repeat(40), 'GET', '/admin/status')).statusCode).toBe(401);
    expect((await admin(t, 'GET', '/admin/status')).statusCode).toBe(200);
  });

  it('reports live status', async () => {
    const t = await bootWithProviders();
    const a = await t.guest();
    await t.call(a.token, 'POST', '/api/matches', {});
    expect((await admin(t, 'GET', '/admin/status')).json()).toEqual({ liveMatches: 1, maintenance: false, accounts: 1, openReports: 0 });
  });

  it('bans a player: pulled out of their match at once, refused at the door with the reason, until it ends or is lifted', async () => {
    const t = await bootWithProviders();
    const a = await t.guest('Troublemaker');
    const created = (await t.call(a.token, 'POST', '/api/matches', {})).json();
    await t.call(a.token, 'GET', '/api/me'); // their login is now remembered in memory
    const res = await admin(t, 'POST', `/admin/accounts/${a.id}/ban`, { reason: 'harassment in voice chat', days: 7 });
    expect(res.statusCode).toBe(200);
    expect(res.json().account).toMatchObject({ status: 'banned' });

    const blocked = await t.call(a.token, 'GET', '/api/me');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toMatchObject({ code: 'account_banned', reason: 'harassment in voice chat' });
    expect(new Date(blocked.json().error.bannedUntil).getTime()).toBe(t.scheduler.now() + 7 * 24 * 60 * 60_000);
    expect(t.services.registry.get(created.matchId)!.currentPhase).toBe('abandoned');

    // they cannot get a new login while banned
    const viaApple = await t.call(null, 'POST', '/api/auth/apple', { identityToken: appleToken(t, 'apple-ban'), nonce: NONCE, displayName: 'Banned Guy', confirmAdult: true });
    expect(viaApple.statusCode).toBe(201); // a different person: this identity is new
    // the ban ends by itself
    t.scheduler.advance(8 * 24 * 60 * 60_000);
    expect((await t.call(a.token, 'GET', '/api/me')).statusCode).toBe(200);
  });

  it('a permanent ban can be lifted', async () => {
    const t = await bootWithProviders();
    const a = await t.guest();
    await admin(t, 'POST', `/admin/accounts/${a.id}/ban`, { reason: 'cheating' });
    expect((await t.call(a.token, 'GET', '/api/me')).statusCode).toBe(403);
    expect((await admin(t, 'POST', `/admin/accounts/${a.id}/unban`)).json().account.status).toBe('active');
    expect((await t.call(a.token, 'GET', '/api/me')).statusCode).toBe(200);
  });

  it('a banned Apple/Google account cannot sign back in', async () => {
    const t = await bootWithProviders();
    const first = await t.call(null, 'POST', '/api/auth/apple', { identityToken: appleToken(t), nonce: NONCE, confirmAdult: true });
    await admin(t, 'POST', `/admin/accounts/${first.json().account.id}/ban`, { reason: 'x' });
    const again = await t.call(null, 'POST', '/api/auth/apple', { identityToken: appleToken(t), nonce: NONCE, confirmAdult: true });
    expect(again.statusCode).toBe(403);
    expect(again.json().error.code).toBe('account_banned');
  });

  it('looks up an account', async () => {
    const t = await bootWithProviders();
    const a = await t.guest('Look Up Me');
    const res = (await admin(t, 'GET', `/admin/accounts/${a.id}`)).json();
    expect(res.account).toMatchObject({ id: a.id, displayName: 'Look Up Me', status: 'active' });
    expect(res).toMatchObject({ activeMatchId: null, reportsAgainst: 0 });
    expect((await admin(t, 'GET', '/admin/accounts/nobody')).statusCode).toBe(404);
  });

  it('validates admin input', async () => {
    const t = await bootWithProviders();
    const a = await t.guest();
    expect((await admin(t, 'POST', `/admin/accounts/${a.id}/ban`, { days: 5 })).statusCode).toBe(400); // reason is required
    expect((await admin(t, 'POST', `/admin/accounts/${a.id}/ban`, { reason: 'x', days: -1 })).statusCode).toBe(400);
    expect((await admin(t, 'POST', '/admin/accounts/nobody/ban', { reason: 'x' })).statusCode).toBe(404);
    expect((await admin(t, 'POST', '/admin/reports/abc', { status: 'resolved' })).statusCode).toBe(404);
  });

  it('maintenance mode stops new matches but not the ones running', async () => {
    const t = await bootWithProviders();
    const a = await t.guest();
    const b = await t.guest();
    const c = await t.guest();
    const running = (await t.call(a.token, 'POST', '/api/matches', { config: { mode: '1v1' }, seats: { B1: { kind: 'human' } } })).json();
    expect((await admin(t, 'POST', '/admin/maintenance', { enabled: true })).json()).toEqual({ maintenance: true });
    const blockedCreate = await t.call(b.token, 'POST', '/api/matches', {});
    expect(blockedCreate.statusCode).toBe(503);
    expect(blockedCreate.json().error.code).toBe('maintenance');
    expect((await t.call(c.token, 'POST', `/api/matches/${running.matchId}/join`, {})).statusCode).toBe(503);
    expect((await t.call(a.token, 'POST', `/api/matches/${running.matchId}/start`, { fillOpenWithBots: true })).statusCode).toBe(200); // the running match carries on
    expect((await t.app.inject('/api/version')).json().maintenance).toBe(true);
    await admin(t, 'POST', '/admin/maintenance', { enabled: false });
    expect((await t.call(b.token, 'POST', '/api/matches', {})).statusCode).toBe(201);
  });
});
