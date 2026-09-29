import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { compareVersions } from '../src/config.js';
import { parseClientVersion } from '../src/http/version.js';
import { TestEnv, connectWs } from './helpers/app.js';

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

const STRICT = { MIN_CLIENT_VERSION: '1.2.0', LATEST_CLIENT_VERSION: '1.4.0', IOS_STORE_URL: 'https://apps.apple.com/app/id1', ANDROID_STORE_URL: 'https://play.google.com/store/apps/details?id=x' };

describe('version helpers', () => {
  it('compares versions number by number, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });
  it('reads the number from a header, ignoring beta tags', () => {
    expect(parseClientVersion('1.4.2')).toBe('1.4.2');
    expect(parseClientVersion(' 1.4.2-beta.3 ')).toBe('1.4.2');
    expect(parseClientVersion('v1.4.2')).toBeNull();
    expect(parseClientVersion('latest')).toBeNull();
    expect(parseClientVersion(undefined)).toBeNull();
  });
});

describe('the app version gate', () => {
  it('lets everything through when no minimum is set', async () => {
    const t = await env.boot();
    expect((await t.app.inject('/api/meta')).statusCode).toBe(200);
  });

  it('tells an app with no version to send one, and an old app to update', async () => {
    const t = await env.boot({ env: STRICT });
    const missing = await t.app.inject('/api/meta');
    expect(missing.statusCode).toBe(426);
    expect(missing.json().error).toMatchObject({ code: 'client_version_required', minVersion: '1.2.0', latestVersion: '1.4.0' });

    const old = await t.app.inject({ method: 'GET', url: '/api/meta', headers: { 'x-client-version': '1.1.9' } });
    expect(old.statusCode).toBe(426);
    expect(old.json().error).toMatchObject({
      code: 'client_outdated',
      minVersion: '1.2.0',
      latestVersion: '1.4.0',
      storeUrls: { ios: 'https://apps.apple.com/app/id1', android: 'https://play.google.com/store/apps/details?id=x' },
    });
  });

  it('lets current and newer apps in', async () => {
    const t = await env.boot({ env: STRICT });
    for (const v of ['1.2.0', '1.2.1', '1.10.0', '2.0.0', '1.3.0-beta.2']) {
      expect((await t.app.inject({ method: 'GET', url: '/api/meta', headers: { 'x-client-version': v } })).statusCode, v).toBe(200);
    }
  });

  it('rejects a version header that is not a version', async () => {
    const t = await env.boot({ env: STRICT });
    const res = await t.app.inject({ method: 'GET', url: '/api/meta', headers: { 'x-client-version': 'banana' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_client_version');
  });

  it('checks every API route, including sign-in and match actions', async () => {
    const t = await env.boot({ env: STRICT });
    for (const [method, url] of [['POST', '/api/auth/guest'], ['POST', '/api/matches'], ['GET', '/api/me'], ['GET', '/api/invites/ABCD2345']] as const) {
      const res = await t.app.inject({ method, url, headers: { 'x-client-version': '1.0.0' }, ...(method === 'POST' ? { payload: {} } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(426);
    }
    const ok = await t.app.inject({ method: 'POST', url: '/api/auth/guest', headers: { 'x-client-version': '1.2.0', 'x-client-platform': 'ios' }, payload: { confirmAdult: true } });
    expect(ok.statusCode).toBe(201);
    // the version and platform are kept with the session for support
    const row = (await t.db.query<{ platform: string; client_version: string }>('SELECT platform, client_version FROM sessions')).rows[0]!;
    expect(row).toEqual({ platform: 'ios', client_version: '1.2.0' });
  });

  it('always answers /api/version, even to an app that is too old, and never gates web pages or health checks', async () => {
    const t = await env.boot({ env: STRICT });
    const res = await t.app.inject({ method: 'GET', url: '/api/version', headers: { 'x-client-version': '0.1.0' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ protocol: 2, minClientVersion: '1.2.0', latestClientVersion: '1.4.0', maintenance: false });
    expect(typeof res.json().serverTime).toBe('string');
    expect((await t.app.inject('/health')).statusCode).toBe(200);
    expect((await t.app.inject('/join/ABCD2345')).statusCode).toBe(200);
  });

  it('refuses to start with a latest version older than the minimum', async () => {
    await expect(env.boot({ env: { MIN_CLIENT_VERSION: '2.0.0', LATEST_CLIENT_VERSION: '1.0.0' } })).rejects.toThrow(/cannot be older/);
  });

  it('applies to the realtime connection too', async () => {
    const t = await env.boot({ env: STRICT });
    // The shared sign-up helper sends no app version, so make this player directly.
    const account = await t.services.accounts.createGuest('Version Host', { adultConfirmed: true });
    const host = { token: (await t.services.sessions.issue(account.id)).token };
    const created = (await t.call(host.token, 'POST', '/api/matches', {}, { 'x-client-version': '1.2.0' })).json();
    const port = await t.listen();

    const old = connectWs(port, created.matchId);
    await old.opened;
    old.hello({ bearer: host.token, clientVersion: '1.0.0' });
    const err = await old.waitFor((m) => m.type === 'error');
    expect(err).toMatchObject({ code: 'client_outdated', minVersion: '1.2.0' });
    expect(await old.closed).toBe(4426);

    const missing = connectWs(port, created.matchId);
    await missing.opened;
    missing.hello({ bearer: host.token });
    expect(await missing.closed).toBe(4426);

    const current = connectWs(port, created.matchId);
    await current.opened;
    current.hello({ bearer: host.token, clientVersion: '1.2.5' });
    await current.waitFor((m) => m.type === 'welcome');
    current.ws.close();
  });
});
