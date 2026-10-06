import { generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import http from 'node:http';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { ApnsSender, FcmSender, type PushMessage, type PushSender, type SendOutcome } from '../src/push/senders.js';
import { AWAY_DELAY_MS } from '../src/push/service.js';
import { TestEnv, type Booted } from './helpers/app.js';

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
function checkJwt(jwt: string, key: KeyObject, alg: 'ES256' | 'RS256') {
  const [h, c, sig] = jwt.split('.') as [string, string, string];
  const ok = alg === 'ES256'
    ? verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))
    : verify('sha256', Buffer.from(`${h}.${c}`), key, Buffer.from(sig, 'base64url'));
  return { ok, header: decode(h), claims: decode(c) };
}
const MSG: PushMessage = { title: 'Ranked match found', body: 'Tap to play.', data: { matchId: 'ABCD1234' }, collapseId: 'ranked-found', ttlSec: 60 };

describe('Apple push (APNs over HTTP/2)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const p8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  let server: http2.Http2Server;
  let host: string;
  const seen: Array<{ headers: http2.IncomingHttpHeaders; body: Record<string, unknown> }> = [];
  let reply: { status: number; reason?: string } = { status: 200 };

  beforeAll(async () => {
    server = http2.createServer();
    server.on('stream', (stream, headers) => {
      let data = '';
      stream.setEncoding('utf8');
      stream.on('data', (c: string) => (data += c));
      stream.on('end', () => {
        seen.push({ headers, body: JSON.parse(data) });
        stream.respond({ ':status': reply.status });
        stream.end(reply.reason ? JSON.stringify({ reason: reply.reason }) : '');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it('sends a correctly signed alert to the device, and reuses its login token for 40 minutes', async () => {
    let now = Date.parse('2026-10-06T12:00:00Z');
    const sender = new ApnsSender({ keyId: 'KEY123', teamId: 'TEAM45', privateKey: p8.replace(/\n/g, '\\n'), bundleId: 'com.iplay.cornhole', sandbox: false, host }, () => now);
    reply = { status: 200 };
    expect(await sender.send('device-token-1', MSG)).toBe('sent');
    const first = seen.at(-1)!;
    expect(first.headers[':path']).toBe('/3/device/device-token-1');
    expect(first.headers['apns-topic']).toBe('com.iplay.cornhole');
    expect(first.headers['apns-push-type']).toBe('alert');
    expect(first.headers['apns-collapse-id']).toBe('ranked-found');
    expect(Number(first.headers['apns-expiration'])).toBe(Math.floor(now / 1000) + 60);
    expect(first.body).toEqual({ aps: { alert: { title: 'Ranked match found', body: 'Tap to play.' }, sound: 'default' }, matchId: 'ABCD1234' });
    const jwt = String(first.headers.authorization).replace(/^bearer /, '');
    const v = checkJwt(jwt, publicKey, 'ES256');
    expect(v.ok).toBe(true);
    expect(v.header).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(v.claims).toEqual({ iss: 'TEAM45', iat: Math.floor(now / 1000) });

    now += 39 * 60_000;
    await sender.send('device-token-1', MSG);
    expect(seen.at(-1)!.headers.authorization).toBe(first.headers.authorization);
    now += 2 * 60_000;
    await sender.send('device-token-1', MSG);
    expect(seen.at(-1)!.headers.authorization).not.toBe(first.headers.authorization);
    sender.close();
  });

  it('reports dead tokens as gone and other problems as failed', async () => {
    const sender = new ApnsSender({ keyId: 'K', teamId: 'T', privateKey: p8, bundleId: 'b', sandbox: true, host });
    const cases: Array<[number, string | undefined, SendOutcome]> = [
      [410, 'Unregistered', 'gone'],
      [400, 'BadDeviceToken', 'gone'],
      [400, 'DeviceTokenNotForTopic', 'gone'],
      [400, 'PayloadTooLarge', 'failed'],
      [429, 'TooManyRequests', 'failed'],
      [500, undefined, 'failed'],
    ];
    for (const [status, reason, want] of cases) {
      reply = { status, ...(reason ? { reason } : {}) };
      expect(await sender.send('t', MSG), `${status} ${reason}`).toBe(want);
    }
    sender.close();
    const nowhere = new ApnsSender({ keyId: 'K', teamId: 'T', privateKey: p8, bundleId: 'b', sandbox: true, host: 'http://127.0.0.1:1' });
    expect(await nowhere.send('t', MSG)).toBe('failed'); // unreachable: never throws
    nowhere.close();
  });
});

describe('Google push (FCM HTTP v1)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pemKey = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  let server: http.Server;
  let base: string;
  const tokenRequests: URLSearchParams[] = [];
  const sends: Array<{ auth: string; body: { message: Record<string, unknown> } }> = [];
  let sendReply: { status: number; body?: unknown } = { status: 200 };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/token') {
          tokenRequests.push(new URLSearchParams(data));
          res.end(JSON.stringify({ access_token: `access-${tokenRequests.length}`, expires_in: 3600 }));
          return;
        }
        sends.push({ auth: String(req.headers.authorization), body: JSON.parse(data) });
        res.statusCode = sendReply.status;
        res.end(JSON.stringify(sendReply.body ?? { name: 'projects/p/messages/1' }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it('signs in with the service account, caches the access token, and sends the message', async () => {
    let now = Date.parse('2026-10-06T12:00:00Z');
    const sender = new FcmSender({ projectId: 'iplay-cornhole', clientEmail: 'push@iplay.iam.gserviceaccount.com', privateKey: pemKey, sendUrl: `${base}/send`, tokenUrl: `${base}/token` }, () => now);
    sendReply = { status: 200 };
    expect(await sender.send('android-token', MSG)).toBe('sent');
    expect(await sender.send('android-token', MSG)).toBe('sent');
    expect(tokenRequests).toHaveLength(1); // cached
    const req = tokenRequests[0]!;
    expect(req.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const v = checkJwt(req.get('assertion')!, publicKey, 'RS256');
    expect(v.ok).toBe(true);
    expect(v.claims).toMatchObject({ iss: 'push@iplay.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: `${base}/token` });
    expect(sends.at(-1)!.auth).toBe('Bearer access-1');
    expect(sends.at(-1)!.body.message).toEqual({
      token: 'android-token',
      notification: { title: 'Ranked match found', body: 'Tap to play.' },
      data: { matchId: 'ABCD1234' },
      android: { priority: 'high', ttl: '60s', collapse_key: 'ranked-found' },
    });
    now += 56 * 60_000; // past the refresh point (expires_in minus 5 minutes)
    await sender.send('android-token', MSG);
    expect(tokenRequests).toHaveLength(2);
  });

  it('forgets uninstalled apps, but never a good token because of a message problem', async () => {
    const sender = new FcmSender({ projectId: 'p', clientEmail: 'e', privateKey: pemKey, sendUrl: `${base}/send`, tokenUrl: `${base}/token` });
    const cases: Array<[number, unknown, SendOutcome]> = [
      [404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }, 'gone'],
      [400, { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } }, 'gone'],
      [400, { error: { status: 'INVALID_ARGUMENT', message: 'Invalid value at message.data' } }, 'failed'],
      [429, { error: { status: 'RESOURCE_EXHAUSTED' } }, 'failed'],
      [503, {}, 'failed'],
    ];
    for (const [status, body, want] of cases) {
      sendReply = { status, body };
      expect(await sender.send('t', MSG), JSON.stringify(body)).toBe(want);
    }
  });
});

describe('push notifications in the game', () => {
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

  class FakeSender implements PushSender {
    sent: Array<{ token: string; msg: PushMessage }> = [];
    dead = new Set<string>();
    async send(token: string, msg: PushMessage): Promise<SendOutcome> {
      if (this.dead.has(token)) return 'gone';
      this.sent.push({ token, msg });
      return 'sent';
    }
    close() {}
  }
  const boot = async () => {
    const ios = new FakeSender();
    const android = new FakeSender();
    const t = await env.boot({ overrides: { pushSenders: { ios, android } } });
    return { t, ios, android };
  };
  const flush = () => new Promise((r) => setTimeout(r, 30));
  const register = (t: Booted, token: string, tok: string, platform: 'ios' | 'android') =>
    t.call(token, 'POST', '/api/me/push', { token: tok, platform }, { 'x-client-version': '1.0.0' });

  it('registers phones, follows the settings, never repeats the same kind within the gap, and forgets dead phones', async () => {
    const { t, ios, android } = await boot();
    const a = await t.guest('Push A');
    expect((await register(t, a.token, 'ios-token-aaaa', 'ios')).json()).toEqual({ registered: true });
    expect((await register(t, a.token, 'android-token-aaaa', 'android')).statusCode).toBe(200);
    expect((await t.call(null, 'GET', '/api/meta')).json().push).toEqual({ ios: true, android: true, categories: ['match', 'ranked', 'season'] });

    const msg: PushMessage = { title: 'x', body: 'y' };
    expect(await t.services.push.notify([a.id], 'ranked', msg, 60_000)).toBe(2);
    expect(ios.sent).toHaveLength(1);
    expect(android.sent).toHaveLength(1);
    expect(await t.services.push.notify([a.id], 'ranked', msg, 60_000)).toBe(0); // within the gap
    t.scheduler.advance(60_000);

    expect((await t.call(a.token, 'PUT', '/api/me/push-settings', { ranked: false })).json().settings).toEqual({ match: true, ranked: false, season: true });
    expect(await t.services.push.notify([a.id], 'ranked', msg, 0)).toBe(0);
    expect(await t.services.push.notify([a.id], 'season', msg, 0)).toBe(2);
    expect((await t.call(a.token, 'GET', '/api/me/push-settings')).json().settings.ranked).toBe(false);
    expect((await t.call(a.token, 'PUT', '/api/me/push-settings', {})).statusCode).toBe(400);

    android.dead.add('android-token-aaaa');
    expect(await t.services.push.notify([a.id], 'match', msg, 0)).toBe(1);
    expect((await t.services.db.query('SELECT token FROM push_devices WHERE account_id = $1', [a.id])).rows).toEqual([{ token: 'ios-token-aaaa' }]);

    const exported = (await t.call(a.token, 'GET', '/api/me/export')).json().pushNotifications;
    expect(exported.devices).toEqual([expect.objectContaining({ platform: 'ios', app_version: '1.0.0' })]);
    expect(JSON.stringify(exported)).not.toContain('ios-token-aaaa');

    expect((await t.call(a.token, 'DELETE', '/api/me/push', { token: 'ios-token-aaaa' })).json()).toEqual({ removed: true });
    expect(await t.services.push.notify([a.id], 'match', msg, 0)).toBe(0);
  });

  it('a phone follows whoever signs in on it, and an account keeps at most 5 phones', async () => {
    const { t } = await boot();
    const a = await t.guest('Owner A');
    const b = await t.guest('Owner B');
    await register(t, a.token, 'shared-phone-1', 'ios');
    await register(t, b.token, 'shared-phone-1', 'ios');
    expect((await t.services.db.query('SELECT account_id FROM push_devices')).rows).toEqual([{ account_id: b.id }]);
    for (let i = 0; i < 7; i++) {
      t.scheduler.advance(1000);
      await register(t, a.token, `phone-number-${i}`, 'android');
    }
    const kept = (await t.services.db.query<{ token: string }>('SELECT token FROM push_devices WHERE account_id = $1 ORDER BY token', [a.id])).rows.map((r) => r.token);
    expect(kept).toEqual(['phone-number-2', 'phone-number-3', 'phone-number-4', 'phone-number-5', 'phone-number-6']);
    await t.call(a.token, 'DELETE', '/api/me');
    expect((await t.services.db.query('SELECT count(*)::int AS n FROM push_devices WHERE account_id = $1', [a.id])).rows[0]).toEqual({ n: 0 });
  });

  it('"your match is still on" only when the player stays away, not after a quick blip', async () => {
    const { t, android } = await boot();
    const a = await t.guest('Away Player');
    await register(t, a.token, 'away-phone-1', 'android');
    const created = (await t.call(a.token, 'POST', '/api/matches', { config: { mode: '1v1', playTo: 21 }, seats: { B1: { kind: 'bot', level: 'regular' } } })).json();
    await t.call(a.token, 'POST', `/api/matches/${created.matchId}/start`, {});
    const session = t.services.registry.get(created.matchId)!;
    session.setConnected(a.id, true);

    session.setConnected(a.id, false); // a blip...
    t.scheduler.advance(2000);
    session.setConnected(a.id, true); // ...back in 2 seconds
    t.scheduler.advance(AWAY_DELAY_MS);
    await flush();
    expect(android.sent).toHaveLength(0);

    session.setConnected(a.id, false); // really gone
    t.scheduler.advance(AWAY_DELAY_MS);
    await flush();
    expect(android.sent.map((s) => s.msg.title)).toEqual(['Your cornhole match is still on']);
    expect(android.sent[0]!.msg.data).toEqual({ type: 'match', matchId: created.matchId });
    expect(android.sent[0]!.msg.body).toContain('a bot takes your seat');
  });

  it('"ranked match found" goes to both players', async () => {
    const { t, ios } = await boot();
    const a = await t.guest('Ranked A');
    const b = await t.guest('Ranked B');
    await register(t, a.token, 'ranked-phone-a', 'ios');
    await register(t, b.token, 'ranked-phone-b', 'ios');
    await t.call(a.token, 'POST', '/api/ranked/queue', { mode: 'singles' });
    await t.call(b.token, 'POST', '/api/ranked/queue', { mode: 'singles' });
    t.services.ranked.tick();
    await flush();
    expect(ios.sent.map((s) => s.token).sort()).toEqual(['ranked-phone-a', 'ranked-phone-b']);
    expect(ios.sent[0]!.msg.title).toBe('Ranked match found');
  });

  it('at the end of a season, each player hears how they finished', async () => {
    const { t, ios } = await boot();
    const a = await t.guest('Season A');
    const b = await t.guest('Season B');
    await register(t, a.token, 'season-phone-a', 'ios');
    await register(t, b.token, 'season-phone-b', 'ios');
    const db = t.services.db;
    await db.query("INSERT INTO seasons (number, starts_at, ends_at, closed_at) VALUES (1, now(), now(), now()) ON CONFLICT (number) DO UPDATE SET closed_at = now()");
    await db.query("INSERT INTO season_results (season, mode, entry_key, member_a, name_a, rank, rating, peak, games, wins, losses) VALUES (1, 'singles', $1, $1, 'A', 3, 1500, 1500, 20, 14, 6)", [a.id]);
    await db.query("INSERT INTO season_results (season, mode, entry_key, member_a, name_a, rank, rating, peak, games, wins, losses) VALUES (1, 'singles', $1, $1, 'B', NULL, 1250, 1250, 4, 2, 2)", [b.id]);
    expect(await t.services.push.seasonClosed(1, 'Season 2')).toBe(2);
    const byToken = Object.fromEntries(ios.sent.map((s) => [s.token, s.msg.body]));
    expect(byToken['season-phone-a']).toBe('You finished #3 in singles. Season 2 starts now: everyone gets a fresh climb.');
    expect(byToken['season-phone-b']).toBe('Thanks for playing ranked. Season 2 starts now: everyone gets a fresh climb.');
  });

  it('no keys: nothing is sent and nothing breaks; partial Apple keys are refused at start-up', async () => {
    const t = await env.boot();
    const a = await t.guest('No Keys');
    expect((await register(t, a.token, 'quiet-phone-1', 'ios')).statusCode).toBe(200); // kept for when keys arrive
    expect(await t.services.push.notify([a.id], 'match', { title: 'x', body: 'y' }, 0)).toBe(0);
    expect((await t.call(null, 'GET', '/api/meta')).json().push).toMatchObject({ ios: false, android: false });
    expect(() => loadConfig({ NODE_ENV: 'test', APNS_KEY_ID: 'ABC' })).toThrow(/iPhone push needs/);
  });
});
