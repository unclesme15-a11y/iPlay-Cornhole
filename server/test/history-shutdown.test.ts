import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MatchSummary } from '../src/accounts/history.js';
import { TestEnv } from './helpers/app.js';

// A finished match's result is saved in the background. A deploy (shutdown) must not cut that off.
describe('saving match results across a shutdown', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await TestEnv.create();
  });
  afterAll(async () => {
    await env.destroy();
  });

  type Internals = {
    history: { recordMatch: (s: MatchSummary) => Promise<{ id: string; duplicate: boolean; voided: boolean; ratingUpdates: [] }> };
    track: (p: Promise<void>) => void;
    recordWithRetry: (s: MatchSummary, attempt: number, session: unknown) => Promise<void>;
  };
  const summary = (code: string) => ({ code, ranked: null }) as unknown as MatchSummary;

  it('shutdown waits for a result that is being saved', async () => {
    const logs: string[] = [];
    const t = await env.boot({ overrides: { log: (_l, m) => logs.push(m) } });
    const reg = t.services.registry as unknown as Internals;
    let release!: () => void;
    const saved: string[] = [];
    reg.history = {
      recordMatch: async (s) => {
        await new Promise<void>((r) => (release = r));
        saved.push(s.code);
        return { id: s.code, duplicate: false, voided: false, ratingUpdates: [] };
      },
    };
    reg.track(reg.recordWithRetry(summary('SLOWSAVE'), 0, {}));
    let done = false;
    const stopping = t.services.registry.shutdown().then(() => (done = true));
    await new Promise((r) => setTimeout(r, 50));
    expect(done).toBe(false); // still waiting for the save
    release();
    await stopping;
    expect(saved).toEqual(['SLOWSAVE']);
  });

  it('a result waiting to retry gets a last try at shutdown; if that fails, the whole result is logged', async () => {
    const logs: Array<{ m: string; d?: Record<string, unknown> }> = [];
    const t = await env.boot({ overrides: { log: (_l, m, d) => logs.push({ m, ...(d ? { d } : {}) }) } });
    const reg = t.services.registry as unknown as Internals;
    let calls = 0;
    let failAlways = false;
    reg.history = {
      recordMatch: async (s) => {
        calls++;
        if (calls === 1 || failAlways) throw new Error('database blip');
        return { id: s.code, duplicate: false, voided: false, ratingUpdates: [] };
      },
    };
    reg.track(reg.recordWithRetry(summary('RETRYME1'), 0, {}));
    await t.services.registry.historyIdle();
    expect(calls).toBe(1); // failed once, retry scheduled 2 s later (the scheduler is not advanced)
    await t.services.registry.shutdown();
    expect(calls).toBe(2); // the last try happened at shutdown, and it worked
    expect(logs.some((l) => l.m === 'could not save match history')).toBe(false);

    const t2 = await env.boot({ overrides: { log: (_l, m, d) => logs.push({ m, ...(d ? { d } : {}) }) } });
    const reg2 = t2.services.registry as unknown as Internals;
    calls = 0;
    failAlways = true;
    reg2.history = reg.history;
    reg2.track(reg2.recordWithRetry(summary('LOSTONE1'), 0, {}));
    await t2.services.registry.historyIdle();
    await t2.services.registry.shutdown();
    const lost = logs.find((l) => l.m === 'could not save match history');
    expect(lost?.d).toMatchObject({ code: 'LOSTONE1', summary: { code: 'LOSTONE1' } });
  });

  it('a save that fails while the server is shutting down still gets its last try', async () => {
    const t = await env.boot();
    const reg = t.services.registry as unknown as Internals;
    let calls = 0;
    let release!: () => void;
    reg.history = {
      recordMatch: async (s) => {
        calls++;
        if (calls === 1) {
          await new Promise<void>((r) => (release = r));
          throw new Error('database blip');
        }
        return { id: s.code, duplicate: false, voided: false, ratingUpdates: [] };
      },
    };
    reg.track(reg.recordWithRetry(summary('MIDSAVE1'), 0, {}));
    const stopping = t.services.registry.shutdown();
    await new Promise((r) => setTimeout(r, 30));
    release(); // the in-flight save fails during shutdown
    await stopping;
    expect(calls).toBe(2);
  });
});
