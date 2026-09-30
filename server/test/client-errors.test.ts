import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/alerts.js';
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

describe('app error reports', () => {
  it('accepts a batch without sign-in, and alerts the owner once', async () => {
    const alerts: string[] = [];
    const fetch: FetchLike = async (_u, init) => {
      alerts.push(JSON.parse(init.body).text);
      return { ok: true, status: 204 };
    };
    const t = await env.boot({ env: { ALERT_WEBHOOK_URL: 'https://hooks.slack.com/x' }, overrides: { alertFetch: fetch } });
    const res = await t.call(null, 'POST', '/api/client-errors', {
      errors: [
        { message: 'NullReferenceException: Object reference not set', stack: 'CornholeApp.DrawResults () (at CornholeApp.Match.cs:512)', count: 3 },
        { message: 'KeyNotFoundException', count: 1 },
      ],
    }, { 'x-client-version': '1.0.0', 'x-client-platform': 'android' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ received: 2 });
    await new Promise((r) => setTimeout(r, 10));
    expect(alerts).toEqual(['[iPlay Cornhole http://localhost:3000] App error on android 1.0.0: NullReferenceException: Object reference not set']);
  });

  it('refuses empty, oversized or unexpected reports', async () => {
    const t = await env.boot();
    const bad = [
      {},
      { errors: [] },
      { errors: Array.from({ length: 21 }, () => ({ message: 'x' })) },
      { errors: [{ message: 'x'.repeat(501) }] },
      { errors: [{ message: 'x', stack: 'y'.repeat(4001) }] },
      { errors: [{ message: 'x', accountId: 'someone' }] },
    ];
    for (const body of bad) expect((await t.call(null, 'POST', '/api/client-errors', body)).statusCode, JSON.stringify(body).slice(0, 60)).toBe(400);
  });

  it('is rate limited to 10 reports a minute per address', async () => {
    const t = await env.boot({ env: { TRUST_PROXY: 'true' } });
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await t.app.inject({ method: 'POST', url: '/api/client-errors', payload: { errors: [{ message: 'x' }] }, remoteAddress: '10.1.2.3' });
      codes.push(r.statusCode);
    }
    expect(codes.filter((c) => c === 202)).toHaveLength(10);
    expect(codes[10]).toBe(429);
  });
});
