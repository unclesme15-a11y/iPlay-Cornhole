import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gestureToward } from '../src/bots/botPolicy.js';
import { TestEnv, auth, connectWs, type Booted } from './helpers/app.js';

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

async function createMatch(t: Booted, token: string, body: Record<string, unknown> = {}) {
  const res = await t.call(token, 'POST', '/api/matches', { config: { mode: '1v1', playTo: 11 }, ...body });
  return { res, json: res.json() };
}

describe('health and meta', () => {
  it('health and ready respond (ready checks the database)', async () => {
    const t = await env.boot();
    expect((await t.app.inject('/health')).json()).toEqual({ status: 'ok' });
    expect((await t.app.inject('/ready')).json()).toMatchObject({ status: 'ready', matches: 0, maintenance: false });
  });

  it('meta exposes the catalog the client needs', async () => {
    const t = await env.boot();
    const meta = (await t.app.inject('/api/meta')).json();
    expect(meta.protocol).toBe(2);
    expect(meta.colors).toHaveLength(12);
    expect(meta.characters).toHaveLength(8);
    expect(meta.targetScores).toEqual([11, 15, 21]);
    expect(meta.defaults).toMatchObject({ playTo: 21, mode: '2v2', boardCam: true, bust: false, skunk: false });
    expect(meta.limits.displayName).toEqual({ min: 3, max: 20 });
    expect(meta.signIn).toEqual({ guest: true, apple: false, google: false });
    expect(meta.led.strips.length).toBeGreaterThan(2);
    expect(meta.sounds.map((s: { id: string }) => s.id)).toContain('cornhole_hit');
    expect(meta.board).toMatchObject({ widthIn: 24, lengthIn: 48, holeRadiusIn: 3 });
  });

  it('meta says which sign-in methods are switched on', async () => {
    const t = await env.boot({ env: { APPLE_CLIENT_IDS: 'com.iplay.cornhole', ALLOW_GUESTS: 'false' } });
    expect((await t.app.inject('/api/meta')).json().signIn).toEqual({ guest: false, apple: true, google: false });
  });

  it('unknown routes are a clean 404', async () => {
    const t = await env.boot();
    const res = await t.app.inject('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});

describe('creating and joining', () => {
  it('creates a match with defaults (21, 2v2, host in A1, three bots) and an invite', async () => {
    const t = await env.boot();
    const host = await t.guest('Uncle Me');
    const res = await t.call(host.token, 'POST', '/api/matches', {});
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.matchId).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(json.seat).toBe('A1');
    expect(json.invite).toEqual({
      code: json.matchId,
      url: `http://localhost:3000/join/${json.matchId}`,
      deepLink: `iplaycornhole://join/${json.matchId}`,
    });
    expect(json.view.config.playTo).toBe(21);
    expect(json.view.config.mode).toBe('2v2');
    expect(json.view.seats.map((s: { kind: string }) => s.kind)).toEqual(['human', 'bot', 'bot', 'bot']);
    expect(json.view.you).toMatchObject({ playerId: host.id, seat: 'A1', host: true });
    expect(json.view.seats[0]).toMatchObject({ name: 'Uncle Me', accountId: host.id });
    expect(json.bearer).toBeUndefined(); // the account's session token is the only credential
  });

  it('honours the setup screen options', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const { json } = await createMatch(t, host.token, {
      config: { mode: '2v2', playTo: 15, bust: true, skunk: true, distance: 'backyard', throwTimerSec: null, boardCam: false, tutorial: true },
      seats: { B1: { kind: 'human' }, A2: { kind: 'bot', level: 'pro' }, B2: { kind: 'bot', level: 'rookie' } },
    });
    expect(json.view.config).toEqual({ mode: '2v2', playTo: 15, bust: true, skunk: true, distance: 'backyard', throwTimerSec: null, boardCam: false, tutorial: true, wind: 'breezy' });
    const seats = Object.fromEntries(json.view.seats.map((s: { id: string }) => [s.id, s]));
    expect(seats.B1.kind).toBe('human');
    expect(seats.A2.botLevel).toBe('pro');
    expect(seats.B2.botLevel).toBe('rookie');
  });

  it.each([
    ['unknown option', { config: { playTo: 21, wagers: true } }],
    ['bad target score', { config: { playTo: 30 } }],
    ['bad mode', { config: { mode: '3v3' } }],
    ['seat not in this mode', { config: { mode: '1v1' }, seats: { A2: { kind: 'bot' } } }],
    ['host as a bot', { seats: { A1: { kind: 'bot' } } }],
    ['unknown top-level field', { wager: 5 }],
  ])('rejects %s with a 400', async (_name, body) => {
    const t = await env.boot();
    const host = await t.guest();
    const res = await t.call(host.token, 'POST', '/api/matches', body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toMatch(/bad_/);
  });

  it('there is no wager option anywhere: the setup endpoint refuses one', async () => {
    const t = await env.boot();
    const host = await t.guest();
    expect((await t.call(host.token, 'POST', '/api/matches', { config: { wager: 10 } })).statusCode).toBe(400);
  });

  it('a friend joins with the match code and lands in the open seat', async () => {
    const t = await env.boot();
    const host = await t.guest('Host Person');
    const friend = await t.guest('Friend Person');
    const { json: created } = await createMatch(t, host.token, { seats: { B1: { kind: 'human' } } });
    const res = await t.call(friend.token, 'POST', `/api/matches/${created.matchId}/join`, {});
    expect(res.statusCode).toBe(201);
    const joined = res.json();
    expect(joined.seat).toBe('B1');
    expect(joined.view.you).toMatchObject({ playerId: friend.id, seat: 'B1', host: false });
    // match codes are case-insensitive
    const again = await t.app.inject({ method: 'GET', url: `/api/matches/${created.matchId.toLowerCase()}` });
    expect(again.statusCode).toBe(200);
  });

  it('joining a full or missing match fails cleanly', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const other = await t.guest();
    const { json: created } = await createMatch(t, host.token);
    const full = await t.call(other.token, 'POST', `/api/matches/${created.matchId}/join`, {});
    expect(full.statusCode).toBe(409);
    expect(full.json().error.code).toBe('match_full');
    expect((await t.call(other.token, 'POST', '/api/matches/ZZZZZZZZ/join', {})).statusCode).toBe(404);
  });

  it('caps how many matches can exist', async () => {
    const t = await env.boot({ env: { MAX_MATCHES: '2' } });
    const accounts = await Promise.all([t.guest(), t.guest(), t.guest()]);
    await createMatch(t, accounts[0]!.token);
    await createMatch(t, accounts[1]!.token);
    const third = await createMatch(t, accounts[2]!.token);
    expect(third.res.statusCode).toBe(503);
    expect(third.json.error.code).toBe('server_busy');
  });
});

describe('auth on match routes', () => {
  it('every action needs a valid session token; the public view never shows secrets', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const { json } = await createMatch(t, host.token);
    const url = (p: string) => `/api/matches/${json.matchId}/${p}`;
    for (const path of ['start', 'character', 'color', 'throw', 'leave', 'seats', 'kick', 'rematch', 'invite']) {
      expect((await t.call(null, 'POST', url(path), {})).statusCode, path).toBe(401);
      expect((await t.call('a'.repeat(43), 'POST', url(path), {})).statusCode, `${path} (fake token)`).toBe(401);
      expect((await t.call(null, 'POST', url(path), {}, { authorization: 'Bearer nope' })).statusCode, `${path} (junk)`).toBe(401);
    }
    const publicView = await t.app.inject({ method: 'GET', url: `/api/matches/${json.matchId}` });
    expect(publicView.json().you).toBeNull();
    expect(publicView.body).not.toContain(host.token);
  });

  it("one player's token cannot act as another player, and outsiders cannot act in a match", async () => {
    const t = await env.boot();
    const host = await t.guest();
    const outsider = await t.guest();
    const { json } = await createMatch(t, host.token);
    const res = await t.call(outsider.token, 'POST', `/api/matches/${json.matchId}/start`, {});
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('unknown_player');
  });
});

describe('a whole match over HTTP', () => {
  it('lobby -> character -> colour -> toss -> throws -> finish, then it appears in history and stats', async () => {
    const t = await env.boot();
    const host = await t.guest('Uncle Me');
    const { json } = await createMatch(t, host.token);
    const id = json.matchId as string;

    let res = await t.call(host.token, 'POST', `/api/matches/${id}/start`, undefined, { 'content-type': 'application/json', 'content-length': '0' });
    expect(res.statusCode).toBe(200);
    expect(res.json().phase).toBe('characters');

    res = await t.call(host.token, 'POST', `/api/matches/${id}/character`, { characterId: 'keisha' });
    expect(res.json().phase).toBe('colors');

    res = await t.call(host.token, 'POST', `/api/matches/${id}/color`, { colorId: 'hot-pink' });
    expect(res.json().phase).toBe('toss');
    expect(res.json().colors.A).toBe('hot-pink');

    t.scheduler.advance(3000);
    const gesture = gestureToward({ x: 0, y: 39 }, 1);
    for (let i = 0; i < 800; i++) {
      const view = (await t.call(host.token, 'GET', `/api/matches/${id}`)).json();
      if (view.phase === 'finished') break;
      if (view.turn?.controlledBy === 'human') {
        expect((await t.call(host.token, 'POST', `/api/matches/${id}/throw`, gesture)).statusCode).toBe(200);
      }
      t.scheduler.advance(500);
    }
    const final = (await t.call(host.token, 'GET', `/api/matches/${id}`)).json();
    expect(final.phase).toBe('finished');
    expect(final.winner).toMatch(/^[AB]$/);
    expect(final.scores[final.winner]).toBeGreaterThanOrEqual(11);

    const events = (await t.app.inject({ method: 'GET', url: `/api/matches/${id}/events?since=0` })).json();
    expect(events.events.some((e: { type: string }) => e.type === 'match_end')).toBe(true);
    expect(events.resync).toBe(false);

    // The result is saved: history and running totals
    await t.services.persistence.idle();
    await new Promise((r) => setTimeout(r, 200));
    const me = (await t.call(host.token, 'GET', '/api/me')).json();
    expect(me.activeMatchId).toBeNull();
    expect(me.stats.games).toBe(1);
    expect(me.stats.wins + me.stats.losses).toBe(1);
    expect(me.stats.throws).toBeGreaterThanOrEqual(8);
    const matches = (await t.call(host.token, 'GET', '/api/me/matches')).json();
    expect(matches.matches).toHaveLength(1);
    expect(matches.matches[0]).toMatchObject({ code: id, outcome: 'score' });
    expect(matches.matches[0].players.find((p: { kind: string }) => p.kind === 'human')).toMatchObject({ accountId: host.id, displayName: 'Uncle Me' });
  });

  it('game-rule errors come back as 409 with a readable code', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const { json } = await createMatch(t, host.token);
    const early = await t.call(host.token, 'POST', `/api/matches/${json.matchId}/throw`, { power: 0.5, aim: 0, arc: 0.5 });
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('wrong_phase');
  });

  it('rejects malformed throw bodies', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const { json } = await createMatch(t, host.token);
    for (const payload of [{}, { power: 'x', aim: 0, arc: 0 }, { power: 0.5, aim: 0, arc: 0, extra: 1 }, { power: null, aim: 0, arc: 0 }]) {
      expect((await t.call(host.token, 'POST', `/api/matches/${json.matchId}/throw`, payload)).statusCode).toBe(400);
    }
    const huge = await t.call(host.token, 'POST', `/api/matches/${json.matchId}/throw`, JSON.stringify({ junk: 'x'.repeat(40_000) }), { 'content-type': 'application/json' });
    expect(huge.statusCode).toBe(413);
  });
});

describe('client compatibility', () => {
  it('accepts a JSON content-type on POSTs that have no body (what Unity sends for start and leave)', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const { json } = await createMatch(t, host.token);
    const headers = { 'content-type': 'application/json', 'content-length': '0' };
    const start = await t.call(host.token, 'POST', `/api/matches/${json.matchId}/start`, undefined, headers);
    expect(start.statusCode).toBe(200);
    expect(start.json().phase).toBe('characters');
    const leave = await t.call(host.token, 'POST', `/api/matches/${json.matchId}/leave`, undefined, headers);
    expect(leave.statusCode).toBe(200);
  });

  it('still rejects genuinely broken JSON', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const { json } = await createMatch(t, host.token);
    const res = await t.call(host.token, 'POST', `/api/matches/${json.matchId}/color`, '{not json', { 'content-type': 'application/json' });
    expect(res.statusCode).toBe(400);
  });
});

describe('rate limiting', () => {
  it('limits match creation and guest sign-ups per IP', async () => {
    const t = await env.boot();
    let limited = 0;
    for (let i = 0; i < 30; i++) {
      const res = await t.call(null, 'POST', '/api/auth/guest', { confirmAdult: true });
      if (res.statusCode === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('health checks are never limited', async () => {
    const t = await env.boot({ env: { RATE_LIMIT_PER_MIN: '2' } });
    for (let i = 0; i < 20; i++) expect((await t.app.inject('/health')).statusCode).toBe(200);
  });
});

describe('websocket', () => {
  it('welcome carries the current view; events stream live; a player connection is tracked', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const { json } = await createMatch(t, host.token);
    const port = await t.listen();
    const client = connectWs(port, json.matchId);
    await client.opened;
    client.hello({ bearer: host.token, since: 0 });
    const welcome = await client.waitFor((m) => m.type === 'welcome');
    expect(welcome.view.id).toBe(json.matchId);
    expect(welcome.view.you.seat).toBe('A1');
    expect(welcome.view.seats[0].connected).toBe(true);
    expect(welcome.resync).toBe(false);

    await t.call(host.token, 'POST', `/api/matches/${json.matchId}/start`, {});
    const ev = await client.waitFor((m) => m.type === 'event' && m.event.type === 'phase' && m.event.data.phase === 'characters');
    expect(ev.event.seq).toBeGreaterThan(0);

    client.ws.send(JSON.stringify({ type: 'ping' }));
    await client.waitFor((m) => m.type === 'pong');

    client.ws.close();
    await client.closed;
    await new Promise((r) => setTimeout(r, 50));
    expect(t.services.registry.get(json.matchId)!.view().seats[0]!.connected).toBe(false);
  });

  it('a reconnecting client gets what it missed, and is told to reload if the server forgot events', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const { json } = await createMatch(t, host.token);
    await t.call(host.token, 'POST', `/api/matches/${json.matchId}/start`, {});
    const port = await t.listen();

    const a = connectWs(port, json.matchId);
    await a.opened;
    a.hello({ bearer: host.token, since: 0 });
    const welcome = await a.waitFor((m) => m.type === 'welcome');
    expect(welcome.missed.some((e: { type: string }) => e.type === 'phase')).toBe(true);
    a.ws.close();

    const b = connectWs(port, json.matchId);
    await b.opened;
    b.hello({ bearer: host.token, since: 99_999 }); // a number from before a server restart
    const resync = await b.waitFor((m) => m.type === 'welcome');
    expect(resync.resync).toBe(true);
    expect(resync.missed).toEqual([]);
    expect(resync.view.phase).toBe('characters');
    b.ws.close();
  });

  it('spectators can watch without credentials, and bad credentials are refused', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const { json } = await createMatch(t, host.token);
    const port = await t.listen();
    const spectator = connectWs(port, json.matchId);
    await spectator.opened;
    spectator.hello();
    const welcome = await spectator.waitFor((m) => m.type === 'welcome');
    expect(welcome.view.you).toBeNull();
    spectator.ws.close();

    const bad = connectWs(port, json.matchId);
    await bad.opened;
    bad.hello({ bearer: 'a'.repeat(43) });
    expect(await bad.closed).toBe(4401);
  });

  it('a signed-in stranger can watch but does not count as a player', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const stranger = await t.guest();
    const { json } = await createMatch(t, host.token);
    const port = await t.listen();
    const c = connectWs(port, json.matchId);
    await c.opened;
    c.hello({ bearer: stranger.token });
    const welcome = await c.waitFor((m) => m.type === 'welcome');
    expect(welcome.view.you).toBeNull();
    c.ws.close();
    await c.closed;
  });

  it('closes sockets for unknown matches and for garbage hello messages', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const port = await t.listen();
    const ghost = connectWs(port, 'ZZZZZZZZ');
    await ghost.opened.catch(() => undefined);
    expect(await ghost.closed).toBe(4404);

    const { json } = await createMatch(t, host.token);
    const junk = connectWs(port, json.matchId);
    await junk.opened;
    junk.ws.send(JSON.stringify({ type: 'hello', bearer: 5 }));
    expect(await junk.closed).toBe(4400);
  });

  it('two tabs for one player: closing one does not count as a disconnect', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const { json } = await createMatch(t, host.token);
    const port = await t.listen();
    const a = connectWs(port, json.matchId);
    const b = connectWs(port, json.matchId);
    await Promise.all([a.opened, b.opened]);
    a.hello({ bearer: host.token });
    b.hello({ bearer: host.token });
    await a.waitFor((m) => m.type === 'welcome');
    await b.waitFor((m) => m.type === 'welcome');
    a.ws.close();
    await a.closed;
    await new Promise((r) => setTimeout(r, 50));
    expect(t.services.registry.get(json.matchId)!.view().seats[0]!.connected).toBe(true);
    b.ws.close();
    await b.closed;
    await new Promise((r) => setTimeout(r, 50));
    expect(t.services.registry.get(json.matchId)!.view().seats[0]!.connected).toBe(false);
  });
});

describe('registry cleanup', () => {
  it('drops finished matches after the retention window and idle matches after the idle window', async () => {
    const t = await env.boot({ overrides: { registry: { finishedTtlMs: 10 * 60_000, idleTtlMs: 60 * 60_000, sweepEveryMs: 60_000 } } });
    const a = await t.guest();
    const b = await t.guest();
    const idle = await createMatch(t, a.token);
    const done = await createMatch(t, b.token);
    await t.call(b.token, 'POST', `/api/matches/${done.json.matchId}/leave`, {}); // host leaves the lobby -> abandoned
    expect(t.services.registry.get(done.json.matchId)!.isOver).toBe(true);
    t.scheduler.advance(5 * 60_000);
    expect(t.services.registry.size).toBe(2);
    t.scheduler.advance(6 * 60_000);
    expect(t.services.registry.get(done.json.matchId)).toBeUndefined();
    expect(t.services.registry.get(idle.json.matchId)).toBeDefined();
    t.scheduler.advance(60 * 60_000);
    expect(t.services.registry.size).toBe(0);
  });
});

void auth;
