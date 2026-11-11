import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gestureToward } from '../src/bots/botPolicy.js';
import { IPLAY_ID_PATTERN } from '../src/accounts/service.js';
import { TestEnv, connectWs, type Booted } from './helpers/app.js';
import { StaticKeys, makeKey, signJwt } from './helpers/jwt.js';

/**
 * A guest who has not signed in with Apple, Google or email still gets one iPlay id.
 * The session token is what comes back after a reconnect. Match scores are stored on that id.
 * Apple/Google upgrade keeps the id. Email is not a provider; the same `signInWithIdentity({ linkTo })`
 * hook is what an email verifier would call, and it is covered here with Apple.
 */

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

const PERFECT = gestureToward({ x: 0, y: 39 }, 1);
const key = makeKey('k1');
const NONCE = 'nonce-value-12345';
const hashed = createHash('sha256').update(NONCE).digest('hex');

type Guest = { token: string; id: string; name: string };

async function playToEnd(t: Booted, token: string, matchId: string): Promise<Record<string, any>> {
  for (let i = 0; i < 800; i++) {
    const view = (await t.call(token, 'GET', `/api/matches/${matchId}`)).json();
    if (view.phase === 'finished') return view;
    if (view.turn?.controlledBy === 'human') {
      const thrown = await t.call(token, 'POST', `/api/matches/${matchId}/throw`, PERFECT);
      expect(thrown.statusCode, thrown.body).toBe(200);
    }
    t.scheduler.advance(500);
  }
  throw new Error('match did not finish');
}

describe('iPlay ID guest sessions', () => {
  it('creates a guest with a stable iPlay id and no sign-in provider', async () => {
    const t = await env.boot();
    const res = await t.call(null, 'POST', '/api/auth/guest', { displayName: 'Maya Throws', confirmAdult: true });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.account.id).toMatch(IPLAY_ID_PATTERN);
    expect(body.account).toMatchObject({
      id: body.account.id,
      iplayId: body.account.id,
      displayName: 'Maya Throws',
      isGuest: true,
    });
    expect(body).toMatchObject({ created: true, linked: false, switched: false });
    const me = (await t.call(body.token, 'GET', '/api/me')).json();
    expect(me.account).toMatchObject({ id: body.account.id, iplayId: body.account.id, isGuest: true });
    expect(me.signInMethods).toEqual([]);
    expect(me.stats).toEqual({ games: 0, wins: 0, losses: 0, leaves: 0, throws: 0, holes: 0, boards: 0, fouls: 0 });
  });

  it('keeps the same guest across a reconnect, including a dropped socket', async () => {
    const t = await env.boot();
    const created = await t.call(null, 'POST', '/api/auth/guest', { displayName: 'Maya Throws', confirmAdult: true });
    const guest = created.json() as { token: string; account: { id: string } };
    const token = guest.token;
    const id = guest.account.id;

    // A restart drops the in-memory session cache. The token in the phone's storage is unchanged.
    t.services.sessions.forget(id);
    t.scheduler.advance(31_000);
    const me = (await t.call(token, 'GET', '/api/me')).json();
    expect(me.account).toMatchObject({ id, iplayId: id, displayName: 'Maya Throws', isGuest: true });
    expect((await t.db.query('SELECT id FROM accounts')).rows).toEqual([{ id }]);

    const match = (await t.call(token, 'POST', '/api/matches', { config: { mode: '1v1', playTo: 11 } })).json();
    const port = await t.listen();
    const first = connectWs(port, match.matchId);
    await first.opened;
    first.hello({ bearer: token });
    const welcome = await first.waitFor((m) => m.type === 'welcome');
    expect(welcome.view.you).toMatchObject({ playerId: id, iplayId: id, seat: 'A1' });
    expect(welcome.view.seats.find((s: { id: string }) => s.id === 'A1')).toMatchObject({ accountId: id, iplayId: id });
    expect(welcome.view.seats.find((s: { id: string }) => s.id === 'B1')).toMatchObject({ accountId: null, iplayId: null });
    first.ws.close();
    await first.closed;

    const second = connectWs(port, match.matchId);
    await second.opened;
    second.hello({ bearer: token });
    const again = await second.waitFor((m) => m.type === 'welcome');
    expect(again.view.you).toMatchObject({ playerId: id, iplayId: id });
    second.ws.close();
    expect((await t.db.query('SELECT count(*)::int AS n FROM accounts')).rows[0]!.n).toBe(1);
  });

  it('records the guest\'s scores when the match ends', async () => {
    const t = await env.boot();
    const guest: Guest = await t.guest('Maya Throws');
    expect(guest.id).toMatch(IPLAY_ID_PATTERN);
    const created = (await t.call(guest.token, 'POST', '/api/matches', { config: { mode: '1v1', playTo: 11 } })).json();
    await t.call(guest.token, 'POST', `/api/matches/${created.matchId}/start`, {});
    await t.call(guest.token, 'POST', `/api/matches/${created.matchId}/character`, { characterId: 'tanya' });
    await t.call(guest.token, 'POST', `/api/matches/${created.matchId}/color`, { colorId: 'teal' });
    t.scheduler.advance(3000);

    const final = await playToEnd(t, guest.token, created.matchId);
    expect(final.winner).toMatch(/^[AB]$/);
    expect(final.scores[final.winner]).toBeGreaterThanOrEqual(11);
    expect(final.seats.find((s: { id: string }) => s.id === 'A1')).toMatchObject({ accountId: guest.id, iplayId: guest.id });

    await t.services.registry.historyIdle();
    const me = (await t.call(guest.token, 'GET', '/api/me')).json();
    expect(me.stats.games).toBe(1);
    expect(me.stats.wins + me.stats.losses).toBe(1);

    const history = (await t.call(guest.token, 'GET', '/api/me/matches')).json();
    expect(history.matches).toHaveLength(1);
    expect(history.matches[0]).toMatchObject({
      code: created.matchId,
      outcome: 'score',
      winner: final.winner,
      scores: final.scores,
    });
    const human = history.matches[0].players.find((p: { kind: string }) => p.kind === 'human');
    expect(human).toMatchObject({ accountId: guest.id, iplayId: guest.id, displayName: 'Maya Throws' });
    const bot = history.matches[0].players.find((p: { kind: string }) => p.kind === 'bot');
    expect(bot).toMatchObject({ accountId: null, iplayId: null });

    const stored = await t.db.query<{ account_id: string | null; score_a: number; score_b: number }>(
      `SELECT p.account_id, m.score_a, m.score_b FROM match_players p JOIN matches m ON m.id = p.match_id
        WHERE m.code = $1 AND p.seat = 'A1'`,
      [created.matchId],
    );
    expect(stored.rows[0]).toEqual({ account_id: guest.id, score_a: final.scores.A, score_b: final.scores.B });
  });

  it('keeps the guest\'s match history when the guest is linked to Apple', async () => {
    const t = await env.boot({
      env: { APPLE_CLIENT_IDS: 'com.iplay.cornhole' },
      overrides: { appleKeys: new StaticKeys([key]) },
    });
    const guest: Guest = await t.guest('Maya Throws');
    const created = (await t.call(guest.token, 'POST', '/api/matches', { config: { mode: '1v1', playTo: 11 } })).json();
    await t.call(guest.token, 'POST', `/api/matches/${created.matchId}/start`, {});
    await t.call(guest.token, 'POST', `/api/matches/${created.matchId}/character`, { characterId: 'keisha' });
    await t.call(guest.token, 'POST', `/api/matches/${created.matchId}/color`, { colorId: 'red' });
    t.scheduler.advance(3000);
    const final = await playToEnd(t, guest.token, created.matchId);
    await t.services.registry.historyIdle();
    const before = (await t.call(guest.token, 'GET', '/api/me')).json();
    expect(before.stats.games).toBe(1);

    const now = t.scheduler.now() / 1000;
    const identityToken = signJwt(key, {
      iss: 'https://appleid.apple.com',
      aud: 'com.iplay.cornhole',
      sub: 'apple-maya',
      iat: now - 5,
      exp: now + 600,
      nonce: hashed,
    });
    const linked = await t.call(guest.token, 'POST', '/api/auth/apple', { identityToken, nonce: NONCE, confirmAdult: true });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({
      created: false,
      linked: true,
      switched: false,
      account: { id: guest.id, iplayId: guest.id, isGuest: false, displayName: 'Maya Throws' },
    });

    // The phone may still hold the guest token, or the new one from the upgrade. Both are this iPlay id.
    for (const token of [guest.token, linked.json().token as string]) {
      const me = (await t.call(token, 'GET', '/api/me')).json();
      expect(me.account).toMatchObject({ id: guest.id, iplayId: guest.id, isGuest: false });
      expect(me.signInMethods).toEqual(['apple']);
      expect(me.stats).toMatchObject({ games: before.stats.games, wins: before.stats.wins, losses: before.stats.losses });
      const history = (await t.call(token, 'GET', '/api/me/matches')).json();
      expect(history.matches).toHaveLength(1);
      expect(history.matches[0]).toMatchObject({ code: created.matchId, scores: final.scores, winner: final.winner });
      expect(history.matches[0].players.find((p: { seat: string }) => p.seat === 'A1')).toMatchObject({
        accountId: guest.id,
        iplayId: guest.id,
        displayName: 'Maya Throws',
      });
    }
    expect((await t.db.query('SELECT id, is_guest FROM accounts')).rows).toEqual([{ id: guest.id, is_guest: false }]);
  });
});
