import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TestEnv } from './helpers/app.js';

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

describe('adults only (18+)', () => {
  it('refuses to create an account until the person confirms they are 18 or older', async () => {
    const t = await env.boot();
    for (const body of [{}, { confirmAdult: false }]) {
      const res = await t.call(null, 'POST', '/api/auth/guest', body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('adult_confirmation_required');
    }
    expect((await t.call(null, 'POST', '/api/auth/guest', { confirmAdult: true })).statusCode).toBe(201);
  });

  it('can be switched off for a private test server', async () => {
    const t = await env.boot({ env: { REQUIRE_ADULT_CONFIRMATION: 'false' } });
    expect((await t.call(null, 'POST', '/api/auth/guest', {})).statusCode).toBe(201);
  });

  it('shows the adult, terms and leaderboard flags on /api/me', async () => {
    const t = await env.boot();
    const g = await t.guest('Adult A');
    const me = (await t.call(g.token, 'GET', '/api/me')).json().account;
    expect(me).toMatchObject({ adultConfirmed: true, termsVersion: 1, currentTermsVersion: 1, needsTermsAccept: false, showOnLeaderboards: true });
  });

  it('asks for the new terms after they change, and only accepts the current version', async () => {
    const t = await env.boot({ env: { TERMS_VERSION: '2' } });
    const g = await t.guest('Adult B');
    // stamped with the terms of the day: nothing to accept
    expect((await t.call(g.token, 'GET', '/api/me')).json().account.needsTermsAccept).toBe(false);
    await t.services.db.query('UPDATE accounts SET terms_version = $2 WHERE id = $1', [g.id, '1']);
    t.services.sessions.forget(g.id);
    expect((await t.call(g.token, 'GET', '/api/me')).json().account).toMatchObject({ needsTermsAccept: true, termsVersion: 1 });
    expect((await t.call(g.token, 'POST', '/api/me/accept-terms', { version: 1 })).json().error.code).toBe('bad_terms_version');
    const ok = await t.call(g.token, 'POST', '/api/me/accept-terms', { version: 2 });
    expect(ok.json().account).toMatchObject({ needsTermsAccept: false, termsVersion: 2 });
  });

  it('lets an older account confirm later', async () => {
    const t = await env.boot();
    const g = await t.guest('Old Account');
    await t.services.db.query('UPDATE accounts SET adult_confirmed_at = NULL, terms_version = NULL WHERE id = $1', [g.id]);
    t.services.sessions.forget(g.id);
    expect((await t.call(g.token, 'GET', '/api/me')).json().account.adultConfirmed).toBe(false);
    const res = await t.call(g.token, 'POST', '/api/me/confirm-adult');
    expect(res.json().account).toMatchObject({ adultConfirmed: true, needsTermsAccept: false });
  });

  it('lets a player hide from the leaderboards, alone or with a rename', async () => {
    const t = await env.boot();
    const g = await t.guest('Shy Player');
    const res = await t.call(g.token, 'PATCH', '/api/me', { showOnLeaderboards: false });
    expect(res.json().account).toMatchObject({ showOnLeaderboards: false, displayName: 'Shy Player' });
    expect((await t.call(g.token, 'PATCH', '/api/me', {})).statusCode).toBe(400);
    // a guest who never picked a name may rename for free
    const fresh = await t.guest();
    const both = await t.call(fresh.token, 'PATCH', '/api/me', { displayName: 'Bold Player', showOnLeaderboards: false });
    expect(both.json().account).toMatchObject({ displayName: 'Bold Player', showOnLeaderboards: false });
  });

  it('accepts "underage" as a report reason', async () => {
    const t = await env.boot();
    const a = await t.guest('Reporter R');
    const b = await t.guest('Reported R');
    const res = await t.call(a.token, 'POST', '/api/reports', { accountId: b.id, reason: 'underage' });
    expect(res.statusCode).toBeLessThan(300);
  });
});
