import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gestureToward } from '../src/bots/botPolicy.js';
import { joinPage } from '../src/http/routes/invites.js';
import { TestEnv, connectWs, type Booted } from './helpers/app.js';

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

type Player = { token: string; id: string; name: string };
const PERFECT = gestureToward({ x: 0, y: 39 }, 1);

async function create(t: Booted, host: Player, body: Record<string, unknown> = {}) {
  const res = await t.call(host.token, 'POST', '/api/matches', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

/** Plays a match to the end. `players` maps each human's account id to their token. */
async function finishMatch(t: Booted, matchId: string, players: Player[]): Promise<Record<string, any>> {
  const byId = new Map(players.map((p) => [p.id, p]));
  for (let i = 0; i < 4000; i++) {
    const view = t.services.registry.get(matchId)!.view();
    if (view.phase === 'finished') return view as unknown as Record<string, any>;
    if (view.turn?.controlledBy === 'human') {
      const seat = view.seats.find((s) => s.id === view.turn!.seat)!;
      const p = byId.get(seat.accountId!);
      if (p) await t.call(p.token, 'POST', `/api/matches/${matchId}/throw`, PERFECT);
    }
    t.scheduler.advance(500);
  }
  throw new Error('match did not finish');
}

describe('invite links', () => {
  it('a seated player can fetch the invite; outsiders cannot', async () => {
    const t = await env.boot({ env: { PUBLIC_BASE_URL: 'https://play.iplay.example/', DEEP_LINK_SCHEME: 'iplaycornhole' } });
    const host = await t.guest('Uncle Me');
    const outsider = await t.guest();
    const m = await create(t, host);
    expect(m.invite.url).toBe(`https://play.iplay.example/join/${m.matchId}`);
    const again = await t.call(host.token, 'POST', `/api/matches/${m.matchId}/invite`);
    expect(again.json()).toEqual(m.invite);
    expect((await t.call(outsider.token, 'POST', `/api/matches/${m.matchId}/invite`)).statusCode).toBe(404);
  });

  it('shows anyone with the code a small preview, and stops once the match has started', async () => {
    const t = await env.boot();
    const host = await t.guest('Uncle Me');
    const m = await create(t, host, { config: { mode: '2v2', playTo: 15 }, seats: { B1: { kind: 'human' }, A2: { kind: 'human' } } });
    const preview = (await t.app.inject(`/api/invites/${m.matchId}`)).json();
    expect(preview).toEqual({ code: m.matchId, hostName: 'Uncle Me', mode: '2v2', playTo: 15, phase: 'lobby', openSeats: ['B1', 'A2'], canJoin: true });
    expect(JSON.stringify(preview)).not.toContain(host.id); // no account ids in the public preview
    await t.call(host.token, 'POST', `/api/matches/${m.matchId}/start`, { fillOpenWithBots: true });
    expect((await t.app.inject(`/api/invites/${m.matchId}`)).json()).toMatchObject({ canJoin: false, openSeats: [] });
  });

  it('unknown, malformed and finished invites are all just "expired"', async () => {
    const t = await env.boot();
    for (const code of ['ZZZZZZZZ', 'short', 'has%20spaces', '..%2F..%2Fetc']) {
      const res = await t.app.inject(`/api/invites/${code}`);
      expect(res.statusCode, code).toBe(404);
      expect(res.json().error.code).toBe('invite_expired');
    }
  });

  it('the link a friend taps is a small web page with an open-in-app button', async () => {
    const t = await env.boot({ env: { IOS_STORE_URL: 'https://apps.apple.com/app/id1', ANDROID_STORE_URL: 'https://play.google.com/store/apps/details?id=x' } });
    const host = await t.guest('Uncle Me');
    const m = await create(t, host);
    await t.call(host.token, 'POST', `/api/matches/${m.matchId}/seats`, { seat: 'B1', kind: 'human' });
    const res = await t.app.inject(`/join/${m.matchId}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.body).toContain('Uncle Me invited you to play cornhole');
    expect(res.body).toContain(`iplaycornhole://join/${m.matchId}`);
    expect(res.body).toContain('https://apps.apple.com/app/id1');
    expect(res.body).not.toContain('<script');
  });

  it('an expired or unknown link says so instead of erroring', async () => {
    const t = await env.boot();
    for (const code of ['ZZZZZZZZ', 'nope']) {
      const res = await t.app.inject(`/join/${code}`);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('This invite has expired');
      expect(res.body).not.toContain('Open in iPlay Cornhole');
    }
  });

  it('escapes anything it prints on the page', () => {
    const html = joinPage({ code: 'ABCD2345', hostName: '<img src=x onerror=alert(1)>', open: true, deepLink: 'x://join/"><script>', iosUrl: 'https://a.example/?q="x"' });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain('&quot;');
  });

  it('serves the app-link files only once the app ids are configured', async () => {
    const off = await env.boot();
    expect((await off.app.inject('/.well-known/apple-app-site-association')).statusCode).toBe(404);
    expect((await off.app.inject('/.well-known/assetlinks.json')).statusCode).toBe(404);
    await env.closeAll();
    const on = await env.boot({ env: { APPLE_TEAM_ID: 'TEAM123456', IOS_BUNDLE_ID: 'com.iplay.cornhole', ANDROID_PACKAGE: 'com.iplay.cornhole', ANDROID_CERT_SHA256: 'AA:BB:CC' } });
    expect((await on.app.inject('/.well-known/apple-app-site-association')).json()).toEqual({
      applinks: { apps: [], details: [{ appID: 'TEAM123456.com.iplay.cornhole', paths: ['/join/*'] }] },
    });
    expect((await on.app.inject('/.well-known/assetlinks.json')).json()[0].target).toEqual({
      namespace: 'android_app', package_name: 'com.iplay.cornhole', sha256_cert_fingerprints: ['AA:BB:CC'],
    });
  });
});

describe('filling seats before the match starts', () => {
  it('the host turns a bot seat into an open seat, a friend joins from the invite, and the host can remove them again', async () => {
    const t = await env.boot();
    const host = await t.guest('Host Person');
    const friend = await t.guest('Friend Person');
    const m = await create(t, host, { config: { mode: '1v1' } });
    expect(m.view.seats.find((s: { id: string }) => s.id === 'B1').kind).toBe('bot');

    const opened = await t.call(host.token, 'POST', `/api/matches/${m.matchId}/seats`, { seat: 'B1', kind: 'human' });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().seats.find((s: { id: string }) => s.id === 'B1')).toMatchObject({ kind: 'human', claimed: false });
    expect((await t.app.inject(`/api/invites/${m.matchId}`)).json().openSeats).toEqual(['B1']);

    const joined = await t.call(friend.token, 'POST', `/api/matches/${m.matchId}/join`, {});
    expect(joined.json().seat).toBe('B1');
    expect((await t.call(friend.token, 'GET', '/api/me')).json().activeMatchId).toBe(m.matchId);

    const kicked = await t.call(host.token, 'POST', `/api/matches/${m.matchId}/kick`, { seat: 'B1' });
    expect(kicked.statusCode).toBe(200);
    expect(kicked.json().seats.find((s: { id: string }) => s.id === 'B1')).toMatchObject({ claimed: false, accountId: null });
    expect((await t.call(friend.token, 'GET', '/api/me')).json().activeMatchId).toBeNull();
    expect((await t.call(friend.token, 'POST', `/api/matches/${m.matchId}/start`, {})).statusCode).toBe(404); // no longer in it
    // and the friend is free to join something else
    const other = await create(t, await t.guest('Other Host'));
    expect((await t.call(friend.token, 'POST', `/api/matches/${other.matchId}/join`, { seat: 'B1' })).statusCode).toBe(409); // that one's a bot seat, but not "already in a match"
  });

  it('changes a bot seat\'s skill, and turns an empty human seat back into a bot', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const m = await create(t, host, { config: { mode: '1v1' }, seats: { B1: { kind: 'human' } } });
    const bot = await t.call(host.token, 'POST', `/api/matches/${m.matchId}/seats`, { seat: 'B1', kind: 'bot', level: 'pro' });
    expect(bot.json().seats.find((s: { id: string }) => s.id === 'B1')).toMatchObject({ kind: 'bot', botLevel: 'pro', claimed: true });
    const harder = await t.call(host.token, 'POST', `/api/matches/${m.matchId}/seats`, { seat: 'B1', kind: 'bot', level: 'rookie' });
    expect(harder.json().seats.find((s: { id: string }) => s.id === 'B1').botLevel).toBe('rookie');
  });

  it('only the host can edit seats or remove people, and never the host\'s own seat or a seat with someone in it', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const friend = await t.guest();
    const m = await create(t, host, { config: { mode: '2v2' }, seats: { B1: { kind: 'human' } } });
    await t.call(friend.token, 'POST', `/api/matches/${m.matchId}/join`, {});
    const asFriend = await t.call(friend.token, 'POST', `/api/matches/${m.matchId}/seats`, { seat: 'A2', kind: 'human' });
    expect(asFriend.statusCode).toBe(403);
    expect(asFriend.json().error.code).toBe('not_host');
    expect((await t.call(friend.token, 'POST', `/api/matches/${m.matchId}/kick`, { seat: 'A1' })).statusCode).toBe(403);
    expect((await t.call(host.token, 'POST', `/api/matches/${m.matchId}/seats`, { seat: 'A1', kind: 'bot' })).statusCode).toBe(400);
    const taken = await t.call(host.token, 'POST', `/api/matches/${m.matchId}/seats`, { seat: 'B1', kind: 'bot' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('seat_taken');
    expect((await t.call(host.token, 'POST', `/api/matches/${m.matchId}/kick`, { seat: 'A1' })).statusCode).toBe(400);
    expect((await t.call(host.token, 'POST', `/api/matches/${m.matchId}/kick`, { seat: 'A2' })).json().error.code).toBe('seat_empty');
    expect((await t.call(host.token, 'POST', `/api/matches/${m.matchId}/seats`, { seat: 'Z9', kind: 'bot' })).statusCode).toBe(400);
  });

  it('seat editing only works in the lobby', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const m = await create(t, host);
    await t.call(host.token, 'POST', `/api/matches/${m.matchId}/start`, {});
    const res = await t.call(host.token, 'POST', `/api/matches/${m.matchId}/seats`, { seat: 'B1', kind: 'human' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('wrong_phase');
  });

  it('start waits for open seats, unless the host says to fill them with bots', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const m = await create(t, host, { config: { mode: '2v2' }, seats: { B1: { kind: 'human' }, A2: { kind: 'human' } } });
    const blocked = await t.call(host.token, 'POST', `/api/matches/${m.matchId}/start`, {});
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatchObject({ code: 'seats_open' });
    expect(blocked.json().error.message).toContain('B1');
    const started = await t.call(host.token, 'POST', `/api/matches/${m.matchId}/start`, { fillOpenWithBots: true });
    expect(started.statusCode).toBe(200);
    expect(started.json().phase).toBe('characters');
    const kinds = Object.fromEntries(started.json().seats.map((s: { id: string; kind: string }) => [s.id, s.kind]));
    expect(kinds).toEqual({ A1: 'human', B1: 'bot', A2: 'bot', B2: 'bot' });
  });

  it('a seat someone already took is left alone by "fill with bots"', async () => {
    const t = await env.boot();
    const host = await t.guest();
    const friend = await t.guest();
    const m = await create(t, host, { config: { mode: '2v2' }, seats: { B1: { kind: 'human' }, A2: { kind: 'human' } } });
    await t.call(friend.token, 'POST', `/api/matches/${m.matchId}/join`, { seat: 'B1' });
    const started = (await t.call(host.token, 'POST', `/api/matches/${m.matchId}/start`, { fillOpenWithBots: true })).json();
    const kinds = Object.fromEntries(started.seats.map((s: { id: string; kind: string }) => [s.id, s.kind]));
    expect(kinds).toEqual({ A1: 'human', B1: 'human', A2: 'bot', B2: 'bot' });
  });
});

describe('one match at a time', () => {
  it('you cannot host or join a second match while in one, and the error says which to go back to', async () => {
    const t = await env.boot();
    const a = await t.guest();
    const b = await t.guest();
    const first = await create(t, a);
    const second = await create(t, b, { config: { mode: '1v1' }, seats: { B1: { kind: 'human' } } });

    const again = await t.call(a.token, 'POST', '/api/matches', {});
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatchObject({ code: 'already_in_match', matchId: first.matchId });

    const join = await t.call(a.token, 'POST', `/api/matches/${second.matchId}/join`, {});
    expect(join.statusCode).toBe(409);
    expect(join.json().error).toMatchObject({ code: 'already_in_match', matchId: first.matchId });
  });

  it('joining the match you are already in just returns your seat', async () => {
    const t = await env.boot();
    const a = await t.guest();
    const b = await t.guest();
    const m = await create(t, a, { config: { mode: '1v1' }, seats: { B1: { kind: 'human' } } });
    const first = await t.call(b.token, 'POST', `/api/matches/${m.matchId}/join`, {});
    const retry = await t.call(b.token, 'POST', `/api/matches/${m.matchId}/join`, {});
    expect(retry.statusCode).toBe(201);
    expect(retry.json().seat).toBe(first.json().seat);
  });

  it('leaving frees you to start another', async () => {
    const t = await env.boot();
    const a = await t.guest();
    const m = await create(t, a);
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/leave`, {});
    expect((await t.call(a.token, 'POST', '/api/matches', {})).statusCode).toBe(201);
  });
});

describe('rematch', () => {
  it('after a match, "play again" starts a new one with the same setup, skipping the picks', async () => {
    const t = await env.boot({ overrides: { timing: { botThinkMinMs: 200, botThinkMaxMs: 400, reactionMs: 300, inningEndMs: 300 } } });
    const host = await t.guest('Uncle Me');
    const m = await create(t, host, { config: { mode: '1v1', playTo: 11 } });
    await t.call(host.token, 'POST', `/api/matches/${m.matchId}/start`, {});
    await t.call(host.token, 'POST', `/api/matches/${m.matchId}/character`, { characterId: 'tanya' });
    await t.call(host.token, 'POST', `/api/matches/${m.matchId}/color`, { colorId: 'teal' });
    t.scheduler.advance(3000);
    const finished = await finishMatch(t, m.matchId, [host]);
    expect(finished.rematch).toMatchObject({ votes: {}, matchId: null, cancelled: false });

    const vote = await t.call(host.token, 'POST', `/api/matches/${m.matchId}/rematch`, { accept: true });
    expect(vote.statusCode).toBe(200);
    const rematchId = vote.json().rematch.matchId as string;
    expect(rematchId).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(rematchId).not.toBe(m.matchId);

    const next = (await t.call(host.token, 'GET', `/api/matches/${rematchId}`)).json();
    expect(next).toMatchObject({ phase: 'toss', rematchOf: m.matchId, colors: { A: 'teal' } });
    expect(next.config).toEqual(finished.config);
    expect(next.you).toMatchObject({ seat: 'A1', host: true });
    expect(next.seats.find((s: { id: string }) => s.id === 'A1')).toMatchObject({ characterId: 'tanya', accountId: host.id });
    expect((await t.call(host.token, 'GET', '/api/me')).json().activeMatchId).toBe(rematchId);

    // it plays: the coin toss ends and turns begin
    t.scheduler.advance(5000);
    expect(t.services.registry.get(rematchId)!.currentPhase).toBe('playing');
  });

  it('with two players: one says yes and one says no, and the "no" seat becomes a bot', async () => {
    const t = await env.boot({ overrides: { timing: { botThinkMinMs: 200, botThinkMaxMs: 400, reactionMs: 300, inningEndMs: 300 } } });
    const a = await t.guest('Player A');
    const b = await t.guest('Player B');
    const m = await create(t, a, { config: { mode: '1v1', playTo: 11 }, seats: { B1: { kind: 'human' } } });
    await t.call(b.token, 'POST', `/api/matches/${m.matchId}/join`, {});
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/start`, {});
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/character`, { characterId: 'keisha' });
    await t.call(b.token, 'POST', `/api/matches/${m.matchId}/character`, { characterId: 'dre' });
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/color`, { colorId: 'red' });
    await t.call(b.token, 'POST', `/api/matches/${m.matchId}/color`, { colorId: 'teal' });
    t.scheduler.advance(3000);
    await finishMatch(t, m.matchId, [a, b]);

    // one vote is not enough: it waits for the other
    const first = await t.call(a.token, 'POST', `/api/matches/${m.matchId}/rematch`, { accept: true });
    expect(first.json().rematch).toMatchObject({ votes: { [a.id]: true }, matchId: null });
    const second = await t.call(b.token, 'POST', `/api/matches/${m.matchId}/rematch`, { accept: false });
    const id = second.json().rematch.matchId as string;
    expect(id).toBeTruthy();
    const next = (await t.call(a.token, 'GET', `/api/matches/${id}`)).json();
    const seats = Object.fromEntries(next.seats.map((s: { id: string }) => [s.id, s]));
    expect(seats.A1).toMatchObject({ kind: 'human', accountId: a.id });
    expect(seats.B1).toMatchObject({ kind: 'bot', characterId: 'dre', accountId: null });
    expect((await t.call(b.token, 'GET', '/api/me')).json().activeMatchId).toBeNull(); // b is free
    // a voted twice? the second attempt is refused once it is decided
    expect((await t.call(a.token, 'POST', `/api/matches/${m.matchId}/rematch`, { accept: true })).json().error.code).toBe('rematch_closed');
  });

  it('nobody accepting cancels it, and so does running out the clock with no votes', async () => {
    const t = await env.boot({ overrides: { timing: { botThinkMinMs: 200, botThinkMaxMs: 400, reactionMs: 300, inningEndMs: 300 } } });
    const a = await t.guest();
    const m = await create(t, a, { config: { mode: '1v1', playTo: 11 } });
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/start`, {});
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/character`, { characterId: 'keisha' });
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/color`, { colorId: 'red' });
    t.scheduler.advance(3000);
    await finishMatch(t, m.matchId, [a]);
    const declined = await t.call(a.token, 'POST', `/api/matches/${m.matchId}/rematch`, { accept: false });
    expect(declined.json().rematch).toMatchObject({ cancelled: true, matchId: null });
    expect((await t.call(a.token, 'GET', '/api/me')).json().activeMatchId).toBeNull();
  });

  it('is refused while the match is still going, and leaving after the end counts as "no"', async () => {
    const t = await env.boot({ overrides: { timing: { botThinkMinMs: 200, botThinkMaxMs: 400, reactionMs: 300, inningEndMs: 300 } } });
    const a = await t.guest();
    const m = await create(t, a, { config: { mode: '1v1', playTo: 11 } });
    const early = await t.call(a.token, 'POST', `/api/matches/${m.matchId}/rematch`, { accept: true });
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('wrong_phase');
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/start`, {});
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/character`, { characterId: 'keisha' });
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/color`, { colorId: 'red' });
    t.scheduler.advance(3000);
    await finishMatch(t, m.matchId, [a]);
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/leave`, {});
    expect(t.services.registry.get(m.matchId)!.view().rematch).toMatchObject({ cancelled: true });
  });

  it('is turned away in maintenance mode, and when a player has since joined another match', async () => {
    const t = await env.boot({ overrides: { timing: { botThinkMinMs: 200, botThinkMaxMs: 400, reactionMs: 300, inningEndMs: 300 } } });
    const a = await t.guest();
    const m = await create(t, a, { config: { mode: '1v1', playTo: 11 } });
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/start`, {});
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/character`, { characterId: 'keisha' });
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/color`, { colorId: 'red' });
    t.scheduler.advance(3000);
    await finishMatch(t, m.matchId, [a]);
    await create(t, a); // a starts something else while the results screen is up
    const res = await t.call(a.token, 'POST', `/api/matches/${m.matchId}/rematch`, { accept: true });
    expect(res.json().rematch).toMatchObject({ cancelled: true, matchId: null });
    const events = t.services.registry.get(m.matchId)!.eventsSince(0);
    expect(events.find((e) => e.type === 'rematch_cancelled')!.data.reason).toBe('already_in_match');
  });

  it('a rematch can be seen over the websocket', async () => {
    const t = await env.boot({ overrides: { timing: { botThinkMinMs: 200, botThinkMaxMs: 400, reactionMs: 300, inningEndMs: 300 } } });
    const a = await t.guest();
    const m = await create(t, a, { config: { mode: '1v1', playTo: 11 } });
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/start`, {});
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/character`, { characterId: 'keisha' });
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/color`, { colorId: 'red' });
    t.scheduler.advance(3000);
    const port = await t.listen();
    const c = connectWs(port, m.matchId);
    await c.opened;
    c.hello({ bearer: a.token });
    await c.waitFor((x) => x.type === 'welcome');
    await finishMatch(t, m.matchId, [a]);
    await t.call(a.token, 'POST', `/api/matches/${m.matchId}/rematch`, { accept: true });
    const ready = await c.waitFor((x) => x.type === 'event' && x.event.type === 'rematch_ready');
    expect(ready.event.data.matchId).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    c.ws.close();
  });
});
