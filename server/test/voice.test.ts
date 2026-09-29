import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { VivoxSigner } from '../src/voice/vivox.js';
import { TestEnv, type Booted } from './helpers/app.js';

const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
const KEY = 'test-secret-key';
const VIVOX = { VIVOX_ISSUER: 'issuer', VIVOX_DOMAIN: 'example.test', VIVOX_SIGNING_KEY: KEY, VIVOX_UNITY_ENVIRONMENT_ID: 'environment' };

const decode = (token: string) => {
  const [header, payload, signature] = token.split('.') as [string, string, string];
  return {
    header,
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>,
    signature,
    unsigned: `${header}.${payload}`,
  };
};
const expectValidSignature = (token: string, key = KEY) => {
  const t = decode(token);
  expect(t.signature).toBe(createHmac('sha256', key).update(t.unsigned).digest('base64url'));
  return t;
};

describe('Vivox signer', () => {
  const signer = () => VivoxSigner.fromConfig(loadConfig({ NODE_ENV: 'test', ...VIVOX }))!;

  it('does not exist until all four settings are present', () => {
    expect(VivoxSigner.fromConfig(loadConfig({ NODE_ENV: 'test' }))).toBeNull();
    expect(() => loadConfig({ NODE_ENV: 'test', VIVOX_ISSUER: 'issuer', VIVOX_DOMAIN: 'example.test', VIVOX_SIGNING_KEY: KEY })).toThrow(/voice needs all of/);
  });

  it('accepts the names the other iPlay games use', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      IPLAY_VIVOX_ISSUER: 'issuer', IPLAY_VIVOX_DOMAIN: '@example.test', IPLAY_VIVOX_SIGNING_KEY: KEY, IPLAY_UNITY_ENVIRONMENT_ID: 'environment',
    });
    expect(VivoxSigner.fromConfig(config)?.userUri('p1')).toBe('sip:.issuer.p1.environment.@example.test');
  });

  it.each([['login', false], ['join', true], ['join_muted', true]] as const)('signs a %s token for one person and (if joining) one channel', (action, hasChannel) => {
    const s = signer().sign(action, 'player1', hasChannel ? 'cornhole-ABCD2345' : null, NOW);
    const t = expectValidSignature(s.token);
    expect(t.header).toBe(Buffer.from('{}').toString('base64url'));
    expect(t.payload).toMatchObject({ iss: 'issuer', vxa: action, f: 'sip:.issuer.player1.environment.@example.test', exp: Math.floor(NOW / 1000) + 300 });
    expect(typeof t.payload.vxi).toBe('string');
    expect('t' in t.payload).toBe(hasChannel);
    if (hasChannel) expect(t.payload.t).toBe('sip:confctl-g-issuer.cornhole-ABCD2345.environment@example.test');
    expect(s.expiresAt).toBe(NOW + 300_000);
  });

  it('makes every token unique, and a different key gives a different signature', () => {
    const a = signer().sign('login', 'p1', null, NOW).token;
    const b = signer().sign('login', 'p1', null, NOW).token;
    expect(a).not.toBe(b);
    expect(decode(a).payload.vxi).not.toBe(decode(b).payload.vxi);
    const other = VivoxSigner.fromConfig(loadConfig({ NODE_ENV: 'test', ...VIVOX, VIVOX_SIGNING_KEY: 'another-secret-key' }))!;
    const t = decode(other.sign('login', 'p1', null, NOW).token);
    expect(t.signature).not.toBe(createHmac('sha256', KEY).update(t.unsigned).digest('base64url'));
  });

  it('refuses unsafe names, unknown actions and a join with no channel', () => {
    const s = signer();
    expect(() => s.sign('delete' as never, 'p1', null, NOW)).toThrow(/Unsupported/);
    expect(() => s.sign('join', 'p1', null, NOW)).toThrow(/channel is required/);
    for (const bad of ['', 'a/b', 'a b', 'a@b', 'x'.repeat(65), 'a:b']) {
      expect(() => s.sign('join', bad, 'cornhole-X', NOW)).toThrow();
      expect(() => s.sign('join', 'p1', bad, NOW)).toThrow();
    }
  });
});

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

async function table(t: Booted, mode: '1v1' | '2v2') {
  const host = await t.guest('Host H');
  const seats = mode === '1v1' ? { B1: { kind: 'human' } } : { B1: { kind: 'human' }, A2: { kind: 'human' }, B2: { kind: 'human' } };
  const created = (await t.call(host.token, 'POST', '/api/matches', { config: { mode }, seats })).json();
  const players: Player[] = [host];
  const need = mode === '1v1' ? 1 : 3;
  for (let i = 0; i < need; i++) {
    const p = await t.guest(`Guest ${i + 1}`);
    expect((await t.call(p.token, 'POST', `/api/matches/${created.matchId}/join`, {})).statusCode).toBe(201);
    players.push(p);
  }
  return { id: created.matchId as string, players };
}
const voice = (t: Booted, p: Player, id: string) => t.call(p.token, 'POST', `/api/matches/${id}/voice`);

describe('voice chat endpoint', () => {
  it('is off, and says so, when Vivox is not configured', async () => {
    const t = await env.boot();
    const { id, players } = await table(t, '1v1');
    expect((await t.call(null, 'GET', '/api/meta')).json().voice).toEqual({ enabled: false, provider: null });
    const res = await voice(t, players[0]!, id);
    expect(res.statusCode).toBe(501);
    expect(res.json().error.code).toBe('voice_unavailable');
  });

  it('gives a 1v1 table channel and no team channel, with correctly signed tokens for the caller only', async () => {
    const t = await env.boot({ env: VIVOX });
    const { id, players } = await table(t, '1v1');
    expect((await t.call(null, 'GET', '/api/meta')).json().voice).toEqual({ enabled: true, provider: 'vivox' });
    const [a, b] = players as [Player, Player];
    const res = await voice(t, a, id);
    expect(res.statusCode).toBe(200);
    const g = res.json();
    expect(g.identity).toEqual({ username: a.id, uri: `sip:.issuer.${a.id}.environment.@example.test` });
    expect(g.team).toBeNull();
    expect(g.table).toMatchObject({ name: `cornhole-${id}`, uri: `sip:confctl-g-issuer.cornhole-${id}.environment@example.test` });
    const login = expectValidSignature(g.loginToken);
    expect(login.payload).toMatchObject({ vxa: 'login', f: g.identity.uri });
    const join = expectValidSignature(g.table.joinToken);
    expect(join.payload).toMatchObject({ vxa: 'join', f: g.identity.uri, t: g.table.uri });
    expect(new Date(g.expiresAt).getTime()).toBe(t.scheduler.now() + 300_000);
    expect(g.roster.map((r: any) => r.username).sort()).toEqual([a.id, b.id].sort());
    expect(g.mute).toEqual([]);
    expect(JSON.stringify(g)).not.toContain(KEY); // the signing key never leaves the server
  });

  it('in 2v2 gives each player a channel for just their own team', async () => {
    const t = await env.boot({ env: VIVOX });
    const { id, players } = await table(t, '2v2');
    const grants = await Promise.all(players.map(async (p) => (await voice(t, p, id)).json()));
    const view = t.services.registry.get(id)!.view();
    const teamOf = (p: Player) => view.seats.find((s) => s.accountId === p.id)!.team;
    for (const [i, p] of players.entries()) {
      const g = grants[i];
      expect(g.team.name).toBe(`cornhole-${id}-team-${teamOf(p)}`);
      expect(expectValidSignature(g.team.joinToken).payload).toMatchObject({ vxa: 'join', t: g.team.uri, f: g.identity.uri });
      expect(g.table.name).toBe(`cornhole-${id}`);
    }
    const [a1, b1, a2] = [players[0]!, players[1]!, players[2]!];
    void b1;
    expect(teamOf(a1)).toBe(teamOf(a2));
    expect(grants[0].team.uri).toBe(grants[2].team.uri);
    expect(grants[0].team.uri).not.toBe(grants[1].team.uri);
    expect(grants[0].roster).toHaveLength(4);
  });

  it('tells the phone to mute the people this player blocked (and only those at this match)', async () => {
    const t = await env.boot({ env: VIVOX });
    const { id, players } = await table(t, '1v1');
    const [a, b] = players as [Player, Player];
    const stranger = await t.guest('Stranger');
    await t.call(a.token, 'PUT', `/api/blocks/${b.id}`);
    await t.call(a.token, 'PUT', `/api/blocks/${stranger.id}`);
    expect((await voice(t, a, id)).json().mute).toEqual([b.id]);
    expect((await voice(t, b, id)).json().mute).toEqual([]); // being blocked does not mute anyone for you
  });

  it('is only for players seated in that match', async () => {
    const t = await env.boot({ env: VIVOX });
    const { id } = await table(t, '1v1');
    const outsider = await t.guest('Outsider');
    expect((await voice(t, outsider, id)).json().error.code).toBe('not_in_match');
    expect((await voice(t, outsider, 'NOSUCHID')).statusCode).toBe(404);
    expect((await t.call(null, 'POST', `/api/matches/${id}/voice`)).statusCode).toBe(401);
  });

  it('stops for a player who left, and once the match is abandoned', async () => {
    const t = await env.boot({ env: VIVOX });
    const { id, players } = await table(t, '1v1');
    const [a, b] = players as [Player, Player];
    await t.call(b.token, 'POST', `/api/matches/${id}/leave`);
    expect((await voice(t, b, id)).json().error.code).toBe('not_in_match');
    await t.call(a.token, 'POST', `/api/matches/${id}/leave`);
    expect([403, 409]).toContain((await voice(t, a, id)).statusCode);
  });

  it('is for adults on the current terms only', async () => {
    const t = await env.boot({ env: { ...VIVOX, TERMS_VERSION: '2' } });
    const { id, players } = await table(t, '1v1');
    const a = players[0]!;
    await t.db.query('UPDATE accounts SET terms_version = $2 WHERE id = $1', [a.id, '1']);
    t.services.sessions.forget(a.id);
    expect((await voice(t, a, id)).json().error.code).toBe('terms_update_required');
    await t.db.query('UPDATE accounts SET terms_version = $2, adult_confirmed_at = NULL WHERE id = $1', [a.id, '2']);
    t.services.sessions.forget(a.id);
    expect((await voice(t, a, id)).json().error.code).toBe('adult_confirmation_required');
  });

  it('does not put a bot-controlled seat in the roster', async () => {
    const t = await env.boot({ env: VIVOX });
    const created = (await (async () => {
      const host = await t.guest('Solo');
      const r = (await t.call(host.token, 'POST', '/api/matches', { config: { mode: '1v1' } })).json();
      return { host, id: r.matchId as string };
    })());
    const g = (await voice(t, created.host, created.id)).json();
    expect(g.roster).toHaveLength(1);
    expect(g.roster[0].username).toBe(created.host.id);
  });

  it('works for a ranked match too', async () => {
    const t = await env.boot({ env: VIVOX });
    const a = await t.guest('Rank A');
    const b = await t.guest('Rank B');
    await t.call(a.token, 'POST', '/api/ranked/queue', { mode: 'singles' });
    await t.call(b.token, 'POST', '/api/ranked/queue', { mode: 'singles' });
    t.services.ranked.tick();
    const id = (await t.call(a.token, 'GET', '/api/ranked/queue')).json().matchId as string;
    const g = (await voice(t, a, id)).json();
    expect(g.table.name).toBe(`cornhole-${id}`);
    expect(g.roster).toHaveLength(2);
  });
});

describe('ad settings for the app', () => {
  it('are off by default and never allow ads during a match', async () => {
    const t = await env.boot();
    const ads = (await t.call(null, 'GET', '/api/meta')).json().ads;
    expect(ads).toEqual({ enabled: false, interstitialEveryNMatches: 3, minSecondsBetweenInterstitials: 180, menuBanner: true, duringMatch: false });
  });
  it('can be switched on and paced from the server', async () => {
    const t = await env.boot({ env: { ADS_ENABLED: 'true', ADS_INTERSTITIAL_EVERY_N_MATCHES: '5', ADS_MIN_SECONDS_BETWEEN_INTERSTITIALS: '300', ADS_MENU_BANNER: 'false' } });
    expect((await t.call(null, 'GET', '/api/meta')).json().ads).toEqual({ enabled: true, interstitialEveryNMatches: 5, minSecondsBetweenInterstitials: 300, menuBanner: false, duringMatch: false });
  });
  it('rejects silly pacing', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', ADS_MIN_SECONDS_BETWEEN_INTERSTITIALS: '1' })).toThrow();
    expect(() => loadConfig({ NODE_ENV: 'test', ADS_INTERSTITIAL_EVERY_N_MATCHES: '0' })).toThrow();
  });
});
