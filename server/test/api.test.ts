import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { buildApp, type BuiltApp } from '../src/http/app.js';
import { ManualScheduler } from '../src/lobby/scheduler.js';
import { MatchRegistry } from '../src/store/registry.js';
import { gestureToward } from '../src/bots/botPolicy.js';

const config = { LOG_LEVEL: 'silent' as const, MAX_MATCHES: 100, RATE_LIMIT_PER_MIN: 10_000, TRUST_PROXY: false };

let built: BuiltApp | null = null;
afterEach(async () => {
  await built?.app.close();
  built = null;
});

async function boot(over: Partial<typeof config> = {}) {
  const scheduler = new ManualScheduler();
  const registry = new MatchRegistry({ scheduler, maxMatches: over.MAX_MATCHES ?? 100 });
  built = await buildApp({ config: { ...config, ...over }, scheduler, registry });
  return { app: built.app, scheduler, registry };
}

const auth = (bearer: string) => ({ authorization: `Bearer ${bearer}` });

async function createMatch(app: BuiltApp['app'], body: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/matches',
    payload: { hostName: 'Host', config: { mode: '1v1', playTo: 11 }, ...body },
  });
  return { res, json: res.json() };
}

describe('health and meta', () => {
  it('health and ready respond', async () => {
    const { app } = await boot();
    expect((await app.inject('/health')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/ready')).json()).toMatchObject({ status: 'ready', matches: 0 });
  });

  it('meta exposes the catalog the client needs', async () => {
    const { app } = await boot();
    const meta = (await app.inject('/api/meta')).json();
    expect(meta.colors).toHaveLength(12);
    expect(meta.characters).toHaveLength(8);
    expect(meta.targetScores).toEqual([11, 15, 21]);
    expect(meta.defaults).toMatchObject({ playTo: 21, mode: '2v2', boardCam: true, bust: false, skunk: false });
    expect(meta.led.strips.length).toBeGreaterThan(2);
    expect(meta.sounds.map((s: { id: string }) => s.id)).toContain('cornhole_hit');
    expect(meta.board).toMatchObject({ widthIn: 24, lengthIn: 48, holeRadiusIn: 3 });
  });

  it('unknown routes are a clean 404', async () => {
    const { app } = await boot();
    const res = await app.inject('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});

describe('creating and joining', () => {
  it('creates a match with defaults (21, 2v2, host in A1, three bots)', async () => {
    const { app } = await boot();
    const res = await app.inject({ method: 'POST', url: '/api/matches', payload: { hostName: 'Uncle' } });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.matchId).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(json.bearer).toMatch(/^[a-f0-9]{24}\.[a-f0-9]{64}$/);
    expect(json.view.config.playTo).toBe(21);
    expect(json.view.config.mode).toBe('2v2');
    expect(json.view.seats.map((s: { kind: string }) => s.kind)).toEqual(['human', 'bot', 'bot', 'bot']);
    expect(json.view.you).toMatchObject({ seat: 'A1', host: true });
  });

  it('honours the setup screen options', async () => {
    const { app } = await boot();
    const { json } = await createMatch(app, {
      config: { mode: '2v2', playTo: 15, bust: true, skunk: true, distance: 'backyard', throwTimerSec: null, boardCam: false, tutorial: true },
      seats: { B1: { kind: 'human' }, A2: { kind: 'bot', level: 'pro' }, B2: { kind: 'bot', level: 'rookie' } },
    });
    expect(json.view.config).toEqual({ mode: '2v2', playTo: 15, bust: true, skunk: true, distance: 'backyard', throwTimerSec: null, boardCam: false, tutorial: true });
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
    ['empty host name', { hostName: '' }],
    ['unknown top-level field', { wager: 5 }],
  ])('rejects %s with a 400', async (_name, body) => {
    const { app } = await boot();
    const res = await app.inject({ method: 'POST', url: '/api/matches', payload: { hostName: 'H', ...body } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toMatch(/bad_/);
  });

  it('there is no wager option anywhere: the setup endpoint refuses one', async () => {
    const { app } = await boot();
    const res = await app.inject({ method: 'POST', url: '/api/matches', payload: { hostName: 'H', config: { wager: 10 } } });
    expect(res.statusCode).toBe(400);
  });

  it('a friend joins with the match code and gets their own bearer', async () => {
    const { app } = await boot();
    const { json: created } = await createMatch(app, { seats: { B1: { kind: 'human' } } });
    const res = await app.inject({ method: 'POST', url: `/api/matches/${created.matchId}/join`, payload: { name: 'Friend' } });
    expect(res.statusCode).toBe(201);
    const joined = res.json();
    expect(joined.seat).toBe('B1');
    expect(joined.bearer).not.toBe(created.bearer);
    // match codes are case-insensitive
    const again = await app.inject({ method: 'GET', url: `/api/matches/${created.matchId.toLowerCase()}` });
    expect(again.statusCode).toBe(200);
  });

  it('joining a full or missing match fails cleanly', async () => {
    const { app } = await boot();
    const { json: created } = await createMatch(app);
    const full = await app.inject({ method: 'POST', url: `/api/matches/${created.matchId}/join`, payload: { name: 'X' } });
    expect(full.statusCode).toBe(409);
    expect(full.json().error.code).toBe('match_full');
    const missing = await app.inject({ method: 'POST', url: '/api/matches/ZZZZZZZZ/join', payload: { name: 'X' } });
    expect(missing.statusCode).toBe(404);
  });

  it('caps how many matches can exist', async () => {
    const { app } = await boot({ MAX_MATCHES: 2 });
    await createMatch(app);
    await createMatch(app);
    const third = await createMatch(app);
    expect(third.res.statusCode).toBe(503);
    expect(third.json.error.code).toBe('server_busy');
  });
});

describe('auth', () => {
  it('actions need a valid bearer; the public view never shows secrets', async () => {
    const { app } = await boot();
    const { json } = await createMatch(app);
    const url = (p: string) => `/api/matches/${json.matchId}/${p}`;
    for (const path of ['start', 'character', 'color', 'throw', 'leave']) {
      const none = await app.inject({ method: 'POST', url: url(path), payload: {} });
      expect(none.statusCode, path).toBe(401);
      const bad = await app.inject({ method: 'POST', url: url(path), payload: {}, headers: auth('a'.repeat(24) + '.' + 'b'.repeat(64)) });
      expect(bad.statusCode, path).toBe(401);
      const junk = await app.inject({ method: 'POST', url: url(path), payload: {}, headers: { authorization: 'Bearer nope' } });
      expect(junk.statusCode, path).toBe(401);
    }
    const publicView = await app.inject({ method: 'GET', url: `/api/matches/${json.matchId}` });
    expect(publicView.json().you).toBeNull();
    expect(publicView.body).not.toContain(json.bearer.split('.')[1]);
  });

  it("one player's bearer cannot act as another player", async () => {
    const { app } = await boot();
    const { json } = await createMatch(app, { seats: { B1: { kind: 'human' } } });
    const joined = (await app.inject({ method: 'POST', url: `/api/matches/${json.matchId}/join`, payload: { name: 'F' } })).json();
    const swapped = `${json.bearer.split('.')[0]}.${joined.bearer.split('.')[1]}`;
    const res = await app.inject({ method: 'POST', url: `/api/matches/${json.matchId}/start`, headers: auth(swapped) });
    expect(res.statusCode).toBe(401);
  });
});

describe('a whole match over HTTP', () => {
  it('lobby -> character -> colour -> toss -> throws -> finish', async () => {
    const { app, scheduler } = await boot();
    const { json } = await createMatch(app);
    const id = json.matchId as string;
    const h = auth(json.bearer);

    let res = await app.inject({ method: 'POST', url: `/api/matches/${id}/start`, headers: h });
    expect(res.statusCode).toBe(200);
    expect(res.json().phase).toBe('characters');

    res = await app.inject({ method: 'POST', url: `/api/matches/${id}/character`, headers: h, payload: { characterId: 'keisha' } });
    expect(res.json().phase).toBe('colors');

    res = await app.inject({ method: 'POST', url: `/api/matches/${id}/color`, headers: h, payload: { colorId: 'hot-pink' } });
    expect(res.json().phase).toBe('toss');
    expect(res.json().colors.A).toBe('hot-pink');

    scheduler.advance(3000);
    const throwGesture = gestureToward({ x: 0, y: 39 }, 1);
    for (let i = 0; i < 600; i++) {
      const view = (await app.inject({ method: 'GET', url: `/api/matches/${id}`, headers: h })).json();
      if (view.phase === 'finished') break;
      if (view.turn?.controlledBy === 'human') {
        const t = await app.inject({ method: 'POST', url: `/api/matches/${id}/throw`, headers: h, payload: throwGesture });
        expect(t.statusCode).toBe(200);
      }
      scheduler.advance(500);
    }
    const final = (await app.inject({ method: 'GET', url: `/api/matches/${id}`, headers: h })).json();
    expect(final.phase).toBe('finished');
    expect(final.winner).toMatch(/^[AB]$/);
    expect(final.scores[final.winner]).toBeGreaterThanOrEqual(11);

    const events = (await app.inject({ method: 'GET', url: `/api/matches/${id}/events?since=0` })).json();
    expect(events.events.some((e: { type: string }) => e.type === 'match_end')).toBe(true);
  });

  it('game-rule errors come back as 409 with a readable code', async () => {
    const { app } = await boot();
    const { json } = await createMatch(app);
    const h = auth(json.bearer);
    const early = await app.inject({ method: 'POST', url: `/api/matches/${json.matchId}/throw`, headers: h, payload: { power: 0.5, aim: 0, arc: 0.5 } });
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('wrong_phase');
  });

  it('rejects malformed throw bodies', async () => {
    const { app } = await boot();
    const { json } = await createMatch(app);
    const h = auth(json.bearer);
    for (const payload of [{}, { power: 'x', aim: 0, arc: 0 }, { power: 0.5, aim: 0, arc: 0, extra: 1 }, { power: null, aim: 0, arc: 0 }]) {
      const res = await app.inject({ method: 'POST', url: `/api/matches/${json.matchId}/throw`, headers: h, payload });
      expect(res.statusCode).toBe(400);
    }
    const huge = await app.inject({ method: 'POST', url: `/api/matches/${json.matchId}/throw`, headers: { ...h, 'content-type': 'application/json' }, payload: JSON.stringify({ junk: 'x'.repeat(40_000) }) });
    expect(huge.statusCode).toBe(413);
  });
});

describe('client compatibility', () => {
  it('accepts a JSON content-type on POSTs that have no body (what Unity sends for start and leave)', async () => {
    const { app } = await boot();
    const { json } = await createMatch(app);
    const headers = { ...auth(json.bearer), 'content-type': 'application/json', 'content-length': '0' };
    const start = await app.inject({ method: 'POST', url: `/api/matches/${json.matchId}/start`, headers });
    expect(start.statusCode).toBe(200);
    expect(start.json().phase).toBe('characters');
    const leave = await app.inject({ method: 'POST', url: `/api/matches/${json.matchId}/leave`, headers });
    expect(leave.statusCode).toBe(200);
  });

  it('still rejects genuinely broken JSON', async () => {
    const { app } = await boot();
    const { json } = await createMatch(app);
    const res = await app.inject({ method: 'POST', url: `/api/matches/${json.matchId}/color`, headers: { ...auth(json.bearer), 'content-type': 'application/json' }, payload: '{not json' });
    expect(res.statusCode).toBe(400);
  });
});

describe('rate limiting', () => {
  it('limits match creation per IP', async () => {
    const { app } = await boot();
    let limited = 0;
    for (let i = 0; i < 30; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/matches', payload: { hostName: 'H' } });
      if (res.statusCode === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('health checks are never limited', async () => {
    const { app } = await boot({ RATE_LIMIT_PER_MIN: 2 });
    for (let i = 0; i < 20; i++) expect((await app.inject('/health')).statusCode).toBe(200);
  });
});

describe('websocket', () => {
  async function listen() {
    const ctx = await boot();
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (ctx.app.server.address() as AddressInfo).port;
    return { ...ctx, port };
  }

  function connect(port: number, id: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/matches/${id}/ws`);
    const messages: Array<Record<string, any>> = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    const opened = new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    const waitFor = async (pred: (m: Record<string, any>) => boolean, timeoutMs = 3000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = messages.find(pred);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error('timed out waiting for message; got ' + JSON.stringify(messages.map((m) => m.type)));
    };
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    return { ws, messages, opened, waitFor, closed };
  }

  it('welcome carries the current view; events stream live; a player connection is tracked', async () => {
    const { app, port, registry } = await listen();
    const { json } = await createMatch(app);
    const client = connect(port, json.matchId);
    await client.opened;
    client.ws.send(JSON.stringify({ type: 'hello', bearer: json.bearer, since: 0 }));
    const welcome = await client.waitFor((m) => m.type === 'welcome');
    expect(welcome.view.id).toBe(json.matchId);
    expect(welcome.view.you.seat).toBe('A1');
    expect(welcome.view.seats[0].connected).toBe(true);

    await app.inject({ method: 'POST', url: `/api/matches/${json.matchId}/start`, headers: auth(json.bearer) });
    const ev = await client.waitFor((m) => m.type === 'event' && m.event.type === 'phase' && m.event.data.phase === 'characters');
    expect(ev.event.seq).toBeGreaterThan(0);

    client.ws.send(JSON.stringify({ type: 'ping' }));
    await client.waitFor((m) => m.type === 'pong');

    client.ws.close();
    await client.closed;
    await new Promise((r) => setTimeout(r, 50));
    expect(registry.get(json.matchId)!.view().seats[0]!.connected).toBe(false);
  });

  it('a reconnecting client gets what it missed', async () => {
    const { app, port } = await listen();
    const { json } = await createMatch(app);
    await app.inject({ method: 'POST', url: `/api/matches/${json.matchId}/start`, headers: auth(json.bearer) });
    const client = connect(port, json.matchId);
    await client.opened;
    client.ws.send(JSON.stringify({ type: 'hello', bearer: json.bearer, since: 0 }));
    const welcome = await client.waitFor((m) => m.type === 'welcome');
    expect(welcome.missed.some((e: { type: string }) => e.type === 'phase')).toBe(true);
    client.ws.close();
  });

  it('spectators can watch without credentials, and bad credentials are refused', async () => {
    const { app, port } = await listen();
    const { json } = await createMatch(app);
    const spectator = connect(port, json.matchId);
    await spectator.opened;
    spectator.ws.send(JSON.stringify({ type: 'hello' }));
    const welcome = await spectator.waitFor((m) => m.type === 'welcome');
    expect(welcome.view.you).toBeNull();
    spectator.ws.close();

    const bad = connect(port, json.matchId);
    await bad.opened;
    bad.ws.send(JSON.stringify({ type: 'hello', bearer: 'a'.repeat(24) + '.' + 'b'.repeat(64) }));
    expect(await bad.closed).toBe(4401);
  });

  it('closes sockets for unknown matches and for garbage hello messages', async () => {
    const { port, app } = await listen();
    const ghost = connect(port, 'ZZZZZZZZ');
    await ghost.opened.catch(() => undefined);
    expect(await ghost.closed).toBe(4404);

    const { json } = await createMatch(app);
    const junk = connect(port, json.matchId);
    await junk.opened;
    junk.ws.send(JSON.stringify({ type: 'hello', bearer: 5 }));
    expect(await junk.closed).toBe(4400);
  });

  it('two tabs for one player: closing one does not count as a disconnect', async () => {
    const { app, port, registry } = await listen();
    const { json } = await createMatch(app);
    const a = connect(port, json.matchId);
    const b = connect(port, json.matchId);
    await Promise.all([a.opened, b.opened]);
    a.ws.send(JSON.stringify({ type: 'hello', bearer: json.bearer }));
    b.ws.send(JSON.stringify({ type: 'hello', bearer: json.bearer }));
    await a.waitFor((m) => m.type === 'welcome');
    await b.waitFor((m) => m.type === 'welcome');
    a.ws.close();
    await a.closed;
    await new Promise((r) => setTimeout(r, 50));
    expect(registry.get(json.matchId)!.view().seats[0]!.connected).toBe(true);
    b.ws.close();
    await b.closed;
    await new Promise((r) => setTimeout(r, 50));
    expect(registry.get(json.matchId)!.view().seats[0]!.connected).toBe(false);
  });
});

describe('registry cleanup', () => {
  it('drops finished matches after the retention window and idle matches after the idle window', async () => {
    const scheduler = new ManualScheduler();
    const registry = new MatchRegistry({ scheduler, finishedTtlMs: 10 * 60_000, idleTtlMs: 60 * 60_000, sweepEveryMs: 60_000 });
    const idle = registry.create({ config: { ...(await import('../src/core/types.js')).DEFAULT_CONFIG, mode: '1v1' }, hostName: 'a' });
    const done = registry.create({ config: { ...(await import('../src/core/types.js')).DEFAULT_CONFIG, mode: '1v1' }, hostName: 'b' });
    done.session.leave(done.host.playerId); // host leaves the lobby -> abandoned
    expect(done.session.isOver).toBe(true);
    scheduler.advance(5 * 60_000);
    expect(registry.size).toBe(2);
    scheduler.advance(6 * 60_000);
    expect(registry.get(done.session.id)).toBeUndefined();
    expect(registry.get(idle.session.id)).toBeDefined();
    scheduler.advance(60 * 60_000);
    expect(registry.size).toBe(0);
    registry.dispose();
  });
});
