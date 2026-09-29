import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { VivoxSigner } from '../src/voice/vivox.js';
import { TestEnv, type Booted } from './helpers/app.js';

const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
const KEY = 'test-secret-key';
const VIVOX = { VIVOX_ISSUER: 'issuer', VIVOX_DOMAIN: 'example.test', VIVOX_SIGNING_KEY: KEY, VIVOX_UNITY_ENVIRONMENT_ID: 'environment' };
/** The Vivox identity the Unity SDK would log a player in with (it uses the Unity player id). */
const sdkIdentity = (id: string) => `sip:.issuer.${id}.environment.@example.test`;

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
  const ME = sdkIdentity('player1');

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

  it.each([['login', false], ['join', true], ['join_muted', true]] as const)('signs a %s token for the identity it is given and (if joining) one channel', (action, hasChannel) => {
    const s = signer().sign(action, ME, hasChannel ? 'cornhole-ABCD2345' : null, NOW);
    const t = expectValidSignature(s.token);
    expect(t.header).toBe(Buffer.from('{}').toString('base64url'));
    expect(t.payload).toMatchObject({ iss: 'issuer', vxa: action, f: ME, exp: Math.floor(NOW / 1000) + 300 });
    expect(typeof t.payload.vxi).toBe('string');
    expect('t' in t.payload).toBe(hasChannel);
    if (hasChannel) expect(t.payload.t).toBe('sip:confctl-g-issuer.cornhole-ABCD2345.environment@example.test');
    expect(s.expiresAt).toBe(NOW + 300_000);
  });

  it('makes every token unique, and a different key gives a different signature', () => {
    const a = signer().sign('login', ME, null, NOW).token;
    const b = signer().sign('login', ME, null, NOW).token;
    expect(a).not.toBe(b);
    expect(decode(a).payload.vxi).not.toBe(decode(b).payload.vxi);
    const other = VivoxSigner.fromConfig(loadConfig({ NODE_ENV: 'test', ...VIVOX, VIVOX_SIGNING_KEY: 'another-secret-key' }))!;
    const t = decode(other.sign('login', ME, null, NOW).token);
    expect(t.signature).not.toBe(createHmac('sha256', KEY).update(t.unsigned).digest('base64url'));
  });

  it('refuses another project\'s identity, unknown actions, a join with no channel, and unsafe channel names', () => {
    const s = signer();
    expect(() => s.sign('join', 'sip:.other.player1.environment.@example.test', 'cornhole-X', NOW)).toThrow(/does not belong/);
    expect(() => s.sign('join', 'sip:.issuer.player1.other-env.@example.test', 'cornhole-X', NOW)).toThrow(/does not belong/);
    expect(() => s.sign('join', 'sip:.issuer.player1.environment.@elsewhere.test', 'cornhole-X', NOW)).toThrow(/does not belong/);
    expect(() => s.sign('join', 'x'.repeat(300), 'cornhole-X', NOW)).toThrow();
    expect(() => s.sign('delete' as never, ME, null, NOW)).toThrow(/Unsupported/);
    expect(() => s.sign('join', ME, null, NOW)).toThrow(/channel is required/);
    for (const bad of ['', 'a/b', 'a b', 'a@b', 'x'.repeat(65), 'a:b']) expect(() => s.sign('join', ME, bad, NOW)).toThrow();
  });

  it('recognises its own identities only', () => {
    const s = signer();
    expect(s.isOurUserUri(ME)).toBe(true);
    expect(s.isOurUserUri(ME.toUpperCase())).toBe(true);
    expect(s.isOurUserUri('sip:.other.a.environment.@example.test')).toBe(false);
    expect(s.isOurUserUri('')).toBe(false);
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
const token = (t: Booted, p: Player, id: string, body: Record<string, unknown>) => t.call(p.token, 'POST', `/api/matches/${id}/voice/token`, body);

describe('voice chat endpoints', () => {
  it('are off, and say so, when Vivox is not configured', async () => {
    const t = await env.boot();
    const { id, players } = await table(t, '1v1');
    expect((await t.call(null, 'GET', '/api/meta')).json().voice).toEqual({ enabled: false, provider: null });
    const res = await voice(t, players[0]!, id);
    expect(res.statusCode).toBe(501);
    expect(res.json().error.code).toBe('voice_unavailable');
    expect((await token(t, players[0]!, id, { action: 'login' })).statusCode).toBe(501);
  });

  it('tell a 1v1 player the table channel (no team channel), who is there, and what name to log in with', async () => {
    const t = await env.boot({ env: VIVOX });
    const { id, players } = await table(t, '1v1');
    expect((await t.call(null, 'GET', '/api/meta')).json().voice).toEqual({ enabled: true, provider: 'vivox' });
    const [a, b] = players as [Player, Player];
    const res = await voice(t, a, id);
    expect(res.statusCode).toBe(200);
    const g = res.json();
    expect(g.displayName).toBe(a.id); // other phones see only this
    expect(g.team).toBeNull();
    expect(g.table).toEqual({ name: `cornhole-${id}`, uri: `sip:confctl-g-issuer.cornhole-${id}.environment@example.test` });
    expect(g.roster.map((r: any) => r.username).sort()).toEqual([a.id, b.id].sort());
    expect(g.mute).toEqual([]);
    expect(JSON.stringify(g)).not.toContain(KEY);
    expect(JSON.stringify(g)).not.toContain('accessToken'); // tokens come from the token endpoint, for the identity the SDK picks
  });

  it('sign a login and a table-join token for the identity the Vivox SDK presents', async () => {
    const t = await env.boot({ env: VIVOX });
    const { id, players } = await table(t, '1v1');
    const a = players[0]!;
    const me = sdkIdentity('unity-player-abc123');
    const login = (await token(t, a, id, { action: 'login', fromUserUri: me })).json();
    const lt = expectValidSignature(login.accessToken);
    expect(lt.payload).toMatchObject({ vxa: 'login', f: me });
    expect('t' in lt.payload).toBe(false);
    expect(new Date(login.expiresAt).getTime()).toBe(t.scheduler.now() + 300_000);
    const channelUri = `sip:confctl-g-issuer.cornhole-${id}.environment@example.test`;
    const join = (await token(t, a, id, { action: 'join', fromUserUri: me, channelUri })).json();
    expect(expectValidSignature(join.accessToken).payload).toMatchObject({ vxa: 'join', f: me, t: channelUri });
    const muted = (await token(t, a, id, { action: 'join_muted', fromUserUri: me, channelUri })).json();
    expect(expectValidSignature(muted.accessToken).payload).toMatchObject({ vxa: 'join_muted' });
    // with no identity given, the account id is used
    const plain = (await token(t, a, id, { action: 'login' })).json();
    expect(expectValidSignature(plain.accessToken).payload.f).toBe(sdkIdentity(a.id));
  });

  it('refuse to sign for another project\'s identity, or a channel that is not yours', async () => {
    const t = await env.boot({ env: VIVOX });
    const one = await table(t, '1v1');
    const other = await table(t, '1v1');
    const a = one.players[0]!;
    const uriOf = (matchId: string) => `sip:confctl-g-issuer.cornhole-${matchId}.environment@example.test`;
    expect((await token(t, a, one.id, { action: 'login', fromUserUri: 'sip:.someone-else.x.environment.@example.test' })).json().error.code).toBe('voice_identity_invalid');
    expect((await token(t, a, one.id, { action: 'join', channelUri: uriOf(other.id) })).json().error.code).toBe('voice_channel_forbidden'); // another match
    expect((await token(t, a, one.id, { action: 'join' })).json().error.code).toBe('voice_channel_forbidden'); // no channel given
    expect((await token(t, a, one.id, { action: 'join', channelUri: 'sip:confctl-g-issuer.anything.environment@example.test' })).statusCode).toBe(403);
    expect((await token(t, a, one.id, { action: 'delete' })).statusCode).toBe(400);
    expect((await token(t, a, one.id, { action: 'login', unexpected: true })).statusCode).toBe(400);
  });

  it('in 2v2 give each player their own team channel and refuse the other team\'s', async () => {
    const t = await env.boot({ env: VIVOX });
    const { id, players } = await table(t, '2v2');
    const grants = await Promise.all(players.map(async (p) => (await voice(t, p, id)).json()));
    const view = t.services.registry.get(id)!.view();
    const teamOf = (p: Player) => view.seats.find((s) => s.accountId === p.id)!.team;
    for (const [i, p] of players.entries()) {
      expect(grants[i].team.name).toBe(`cornhole-${id}-team-${teamOf(p)}`);
      expect(grants[i].table.name).toBe(`cornhole-${id}`);
      const own = (await token(t, p, id, { action: 'join', channelUri: grants[i].team.uri })).json();
      expect(expectValidSignature(own.accessToken).payload.t).toBe(grants[i].team.uri);
    }
    expect(teamOf(players[0]!)).toBe(teamOf(players[2]!));
    expect(grants[0].team.uri).toBe(grants[2].team.uri);
    expect(grants[0].team.uri).not.toBe(grants[1].team.uri);
    expect(grants[0].roster).toHaveLength(4);
    // the other team's private channel is off limits
    const denied = await token(t, players[0]!, id, { action: 'join', channelUri: grants[1].team.uri });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('voice_channel_forbidden');
  });

  it('tell the phone to mute the people this player blocked (and only those at this match)', async () => {
    const t = await env.boot({ env: VIVOX });
    const { id, players } = await table(t, '1v1');
    const [a, b] = players as [Player, Player];
    const stranger = await t.guest('Stranger');
    await t.call(a.token, 'PUT', `/api/blocks/${b.id}`);
    await t.call(a.token, 'PUT', `/api/blocks/${stranger.id}`);
    expect((await voice(t, a, id)).json().mute).toEqual([b.id]);
    expect((await voice(t, b, id)).json().mute).toEqual([]); // being blocked does not mute anyone for you
  });

  it('are only for players seated in that match', async () => {
    const t = await env.boot({ env: VIVOX });
    const { id } = await table(t, '1v1');
    const outsider = await t.guest('Outsider');
    expect((await voice(t, outsider, id)).json().error.code).toBe('not_in_match');
    expect((await token(t, outsider, id, { action: 'login' })).json().error.code).toBe('not_in_match');
    expect((await voice(t, outsider, 'NOSUCHID')).statusCode).toBe(404);
    expect((await t.call(null, 'POST', `/api/matches/${id}/voice`)).statusCode).toBe(401);
    expect((await t.call(null, 'POST', `/api/matches/${id}/voice/token`, { action: 'login' })).statusCode).toBe(401);
  });

  it('stop for a player who left, and once the match is abandoned', async () => {
    const t = await env.boot({ env: VIVOX });
    const { id, players } = await table(t, '1v1');
    const [a, b] = players as [Player, Player];
    await t.call(b.token, 'POST', `/api/matches/${id}/leave`);
    expect((await voice(t, b, id)).json().error.code).toBe('not_in_match');
    expect((await token(t, b, id, { action: 'login' })).json().error.code).toBe('not_in_match');
    await t.call(a.token, 'POST', `/api/matches/${id}/leave`);
    expect([403, 409]).toContain((await voice(t, a, id)).statusCode);
  });

  it('are for adults on the current terms only', async () => {
    const t = await env.boot({ env: { ...VIVOX, TERMS_VERSION: '2' } });
    const { id, players } = await table(t, '1v1');
    const a = players[0]!;
    await t.db.query('UPDATE accounts SET terms_version = $2 WHERE id = $1', [a.id, '1']);
    t.services.sessions.forget(a.id);
    expect((await voice(t, a, id)).json().error.code).toBe('terms_update_required');
    expect((await token(t, a, id, { action: 'login' })).json().error.code).toBe('terms_update_required');
    await t.db.query('UPDATE accounts SET terms_version = $2, adult_confirmed_at = NULL WHERE id = $1', [a.id, '2']);
    t.services.sessions.forget(a.id);
    expect((await voice(t, a, id)).json().error.code).toBe('adult_confirmation_required');
    expect((await token(t, a, id, { action: 'login' })).json().error.code).toBe('adult_confirmation_required');
  });

  it('do not put a bot-controlled seat in the roster', async () => {
    const t = await env.boot({ env: VIVOX });
    const host = await t.guest('Solo');
    const r = (await t.call(host.token, 'POST', '/api/matches', { config: { mode: '1v1' } })).json();
    const g = (await voice(t, host, r.matchId)).json();
    expect(g.roster).toHaveLength(1);
    expect(g.roster[0].username).toBe(host.id);
  });

  it('work for a ranked match too', async () => {
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
    expect((await token(t, a, id, { action: 'join', channelUri: g.table.uri })).statusCode).toBe(200);
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
