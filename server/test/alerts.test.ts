import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ALERT_EVERY_MS, Alerts, type FetchLike } from '../src/alerts.js';
import { TestEnv } from './helpers/app.js';

type Sent = { url: string; body: Record<string, string> };
const recorder = (): { fetch: FetchLike; sent: Sent[] } => {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 204 };
    },
  };
};
const flush = () => new Promise((r) => setTimeout(r, 10));

describe('alert webhook', () => {
  it('does nothing without a webhook address', () => {
    const r = recorder();
    const a = new Alerts(undefined, 'x', r.fetch);
    a.send('error', 'boom');
    expect(a.enabled).toBe(false);
    expect(r.sent).toHaveLength(0);
  });

  it('speaks Discord to Discord and Slack to everything else', async () => {
    const r = recorder();
    new Alerts('https://discord.com/api/webhooks/1/abc', 'Cornhole', r.fetch).send('k', 'hello');
    new Alerts('https://hooks.slack.com/services/T/B/C', 'Cornhole', r.fetch).send('k', 'hello');
    await flush();
    expect(r.sent[0]!.body).toEqual({ content: '[Cornhole] hello' });
    expect(r.sent[1]!.body).toEqual({ text: '[Cornhole] hello' });
  });

  it('sends each kind at most once per 10 minutes and counts what it held back', async () => {
    const r = recorder();
    let now = 1_000_000;
    const a = new Alerts('https://hooks.slack.com/x', 'C', r.fetch, () => now);
    a.send('error', 'one');
    a.send('error', 'two');
    a.send('error', 'three');
    a.send('report', 'other kind goes through');
    now += ALERT_EVERY_MS;
    a.send('error', 'four');
    await flush();
    expect(r.sent.map((s) => s.body.text)).toEqual(['[C] one', '[C] other kind goes through', '[C] four (+2 more like this in the last 10 minutes)']);
  });

  it('never throws when the webhook is down', async () => {
    const failures: unknown[] = [];
    const a = new Alerts('https://hooks.slack.com/x', 'C', async () => { throw new Error('offline'); }, Date.now, (e) => failures.push(e));
    expect(() => a.send('error', 'boom')).not.toThrow();
    await flush();
    expect(failures).toHaveLength(1);
  });
});

describe('what the server alerts about', () => {
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

  it('new reports (underage separately), website deletion requests, and anything logged as an error', async () => {
    const r = recorder();
    const t = await env.boot({ env: { ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/x' }, overrides: { alertFetch: r.fetch } });
    const a = await t.guest('Reporter');
    const b = await t.guest('Reported');
    expect((await t.call(a.token, 'POST', '/api/reports', { accountId: b.id, reason: 'harassment' })).statusCode).toBe(201);
    expect((await t.call(a.token, 'POST', '/api/reports', { accountId: b.id, reason: 'underage' })).statusCode).toBe(201);
    await t.app.inject({
      method: 'POST',
      url: '/delete-account',
      payload: 'name=Someone&contact=s%40example.com',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    t.services.log('error', 'could not save match history', {});
    await flush();
    const texts = r.sent.map((s) => s.body.text!);
    expect(texts.some((x) => x.includes('New player report (harassment)'))).toBe(true);
    expect(texts.some((x) => x.includes('New player report (underage)'))).toBe(true);
    expect(texts.some((x) => x.includes('New account deletion request'))).toBe(true);
    expect(texts.some((x) => x.includes('Error: could not save match history'))).toBe(true);
    expect(texts.every((x) => !x.includes('Reporter') && !x.includes(b.id))).toBe(true); // no personal details in chat
  });
});
