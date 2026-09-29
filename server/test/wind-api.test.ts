import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gestureToward } from '../src/bots/botPolicy.js';
import { MatchSession } from '../src/lobby/session.js';
import { TestEnv, type Booted } from './helpers/app.js';

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

const AIRMAIL = gestureToward({ x: 0, y: 39 }, 0.9);

/** A 1v1 against a bot, advanced to the human's first turn. */
async function toMyTurn(t: Booted, config: Record<string, unknown> = {}) {
  const me = await t.guest('Thrower T');
  const m = (await t.call(me.token, 'POST', '/api/matches', { config: { mode: '1v1', ...config } })).json();
  await t.call(me.token, 'POST', `/api/matches/${m.matchId}/start`, {});
  const session = t.services.registry.get(m.matchId)!;
  session.setConnected(me.id, true);
  for (let i = 0; i < 400; i++) {
    const v = session.view(me.id);
    if (v.turn?.controlledBy === 'human') return { me, id: m.matchId as string, session };
    t.scheduler.advance(500);
  }
  throw new Error('never got a turn');
}

describe('wind in a match', () => {
  it('is breezy by default, shown on the turn from the thrower\'s side, and in the setup data', async () => {
    const t = await env.boot();
    const { me, session } = await toMyTurn(t);
    const v = session.view(me.id);
    expect(v.config.wind).toBe('breezy');
    expect(v.wind!.mph).toBeGreaterThanOrEqual(3);
    expect(v.wind!.mph).toBeLessThanOrEqual(10);
    expect(v.turn!.wind).toMatchObject({ mph: v.wind!.mph });
    expect(Math.hypot(v.turn!.wind.cross, v.turn!.wind.along)).toBeCloseTo(v.wind!.mph, 0);
    const meta = (await t.call(null, 'GET', '/api/meta')).json();
    expect(meta.defaults.wind).toBe('breezy');
    expect(meta.throwing.shots).toHaveLength(3);
    expect(meta.throwing.wind.holeMarksPer10MphCross.standard).toBeGreaterThan(0.5);
  });

  it('is calm when switched off and in the tutorial', async () => {
    const t = await env.boot();
    const off = await toMyTurn(t, { wind: 'off' });
    expect(off.session.view().wind).toMatchObject({ mph: 0 });
    const t2 = await env.boot();
    const tut = await toMyTurn(t2, { tutorial: true, wind: 'gusty' });
    expect(tut.session.view().wind).toMatchObject({ mph: 0 });
  });

  it('rejects an unknown wind setting', async () => {
    const t = await env.boot();
    const me = await t.guest('Setup S');
    expect((await t.call(me.token, 'POST', '/api/matches', { config: { wind: 'hurricane' } })).statusCode).toBe(400);
  });

  it('applies the flick and reports what it did, along with the wind the bag flew through', async () => {
    const t = await env.boot();
    const { me, id, session } = await toMyTurn(t, { wind: 'off' });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));
    const res = await t.call(me.token, 'POST', `/api/matches/${id}/throw`, { ...AIRMAIL, release: { angleDeg: 13, speed: 3, holdMs: 900, curve: 0 } });
    expect(res.statusCode).toBe(200);
    const result = events.find((e) => e.type === 'throw_result')!.data;
    expect(result.release).toMatchObject({ pushIn: 5.5, verdict: 'pushed', aimed: { aim: AIRMAIL.aim } });
    expect(result.gesture.aim).toBeGreaterThan(AIRMAIL.aim); // the pushed gesture is what was thrown
    expect(result.wind).toEqual({ cross: 0, along: 0, driftX: 0, driftY: 0 });
  });

  it('refuses a release with impossible values', async () => {
    const t = await env.boot();
    const { me, id } = await toMyTurn(t);
    const res = await t.call(me.token, 'POST', `/api/matches/${id}/throw`, { ...AIRMAIL, release: { angleDeg: 200, speed: 3, holdMs: 0, curve: 0 } });
    expect(res.statusCode).toBe(400);
  });

  it('keeps the same wind across a server restart', async () => {
    const t = await env.boot();
    const { session } = await toMyTurn(t, { wind: 'gusty' });
    const before = session.view().wind;
    const restored = MatchSession.restore(session.snapshot(), { scheduler: t.scheduler });
    expect(restored.view().wind).toEqual(before);
  });
});
