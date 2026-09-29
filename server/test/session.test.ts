import { describe, expect, it } from 'vitest';
import { BAG_COLORS, CHARACTERS } from '../src/core/constants.js';
import { DomainError } from '../src/core/errors.js';
import { createRng } from '../src/core/rng.js';
import { DEFAULT_CONFIG, type MatchConfig } from '../src/core/types.js';
import { gestureToward } from '../src/bots/botPolicy.js';
import { ManualScheduler } from '../src/lobby/scheduler.js';
import { MatchSession, type SeatPlan, type SessionEvent } from '../src/lobby/session.js';

import { simulateThrow } from '../src/physics/throwSim.js';

let acctCounter = 0;
/** A fake account for a match seat. Real ones come from the accounts service. */
const acct = (name: string) => ({ id: `acct-${++acctCounter}-${name.replace(/\W/g, '')}`, displayName: name });

const PERFECT = gestureToward({ x: 0, y: 39 }, 1);

/** A throw seed for which the given gesture drops straight into the hole (wobble is seeded). */
function holeSeed(): number {
  for (let seed = 1; seed < 2000; seed++) {
    const r = simulateThrow({ gesture: PERFECT, bagId: 'T', boardBags: [], distanceIn: 324, seed });
    if (r.status === 'hole') return seed;
  }
  throw new Error('no hole seed found');
}
const MISS = { power: 0.05, aim: 0, arc: 0.5, spin: 0 };

function make(over: { config?: Partial<MatchConfig>; seats?: SeatPlan; seed?: number; throwSeed?: number } = {}) {
  const sched = new ManualScheduler();
  const rng = createRng(over.seed ?? 1);
  let n = 0;
  const session = new MatchSession({
    id: 'TEST1234',
    config: { ...DEFAULT_CONFIG, mode: '1v1', ...over.config },
    seatPlan: over.seats ?? { A1: { kind: 'human' }, B1: { kind: 'bot', level: 'regular' } },
    scheduler: sched,
    rng,
    seedSource: over.throwSeed !== undefined ? () => over.throwSeed! : () => ++n * 7919,
  });
  const host = session.createHost(acct('Host'));
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  return { session, sched, host, events };
}

const types = (events: SessionEvent[]) => events.map((e) => e.type);
const fail = (fn: () => void): DomainError => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    return e as DomainError;
  }
  throw new Error('expected a DomainError');
};

/** Get from lobby to the first turn. */
function toPlaying(ctx: ReturnType<typeof make>, colorId = 'royal-blue') {
  const { session, sched, host } = ctx;
  session.start(host.playerId);
  session.pickCharacter(host.playerId, 'keisha');
  session.pickColor(host.playerId, colorId);
  sched.advance(3000); // coin toss
  expect(session.currentPhase).toBe('playing');
}

/** Advance time until the human's turn opens (or the match ends). */
function untilHumanTurn(ctx: ReturnType<typeof make>): boolean {
  for (let i = 0; i < 400; i++) {
    const v = ctx.session.view(ctx.host.playerId);
    if (v.turn && v.turn.controlledBy === 'human') return true;
    if (ctx.session.isOver) return false;
    ctx.sched.advance(500);
  }
  throw new Error('never reached the human turn');
}

describe('lobby', () => {
  it('host is seated in A1; join fills open human seats; start waits for them', () => {
    const { session, host } = make({ config: { mode: '2v2' }, seats: { B1: { kind: 'human' }, A2: { kind: 'bot' }, B2: { kind: 'bot' } } });
    expect(host.seat).toBe('A1');
    expect(fail(() => session.start(host.playerId)).code).toBe('seats_open');
    const guest = session.join(acct('Guest'));
    expect(guest.seat).toBe('B1');
    expect(fail(() => session.join(acct('Third'))).code).toBe('match_full');
    session.start(host.playerId);
    expect(session.currentPhase).toBe('characters');
  });

  it('only the host can start; a guest gets 403', () => {
    const { session, host } = make({ seats: { B1: { kind: 'human' } } });
    const guest = session.join(acct('Guest'));
    expect(fail(() => session.start(guest.playerId)).status).toBe(403);
    session.start(host.playerId);
  });

  it('cannot join a bot seat, a taken seat, or a seat that does not exist', () => {
    const { session } = make({ config: { mode: '2v2' }, seats: { B1: { kind: 'human' } } });
    expect(fail(() => session.join(acct('X'), 'A2')).code).toBe('seat_is_bot');
    expect(fail(() => session.join(acct('X'), 'A1')).code).toBe('seat_taken');
    const one = make(); // 1v1 has no A2
    expect(fail(() => one.session.join(acct('X'), 'A2')).code).toMatch(/bad_seat|match_full/);
  });

  it('a seat shows the account name, and humans carry their account id (bots do not)', () => {
    const { session, host } = make({ seats: { B1: { kind: 'human' } } });
    const friend = acct('Big Mike');
    session.join(friend);
    const seats = session.view().seats;
    expect(seats.find((s) => s.id === 'B1')).toMatchObject({ name: 'Big Mike', accountId: friend.id, claimed: true });
    expect(seats.find((s) => s.id === 'A1')!.accountId).toBe(host.playerId);
    const botView = make().session.view().seats.find((s) => s.id === 'B1')!;
    expect(botView.accountId).toBeNull();
  });

  it('joining again from the same account returns the same seat instead of taking another', () => {
    const { session } = make({ config: { mode: '2v2' }, seats: { B1: { kind: 'human' }, A2: { kind: 'human' } } });
    const friend = acct('Friend');
    const first = session.join(friend);
    const again = session.join(friend);
    expect(again).toEqual(first);
    expect(session.view().seats.filter((s) => s.kind === 'human' && s.claimed)).toHaveLength(2);
  });

  it('knows who is in the match', () => {
    const { session, host } = make({ seats: { B1: { kind: 'human' } } });
    const friend = acct('Friend');
    session.join(friend);
    expect(session.hasActivePlayer(host.playerId)).toBe(true);
    expect(session.hasActivePlayer(friend.id)).toBe(true);
    expect(session.hasActivePlayer('someone-else')).toBe(false);
    expect(session.seatOf(friend.id)).toBe('B1');
    expect(session.activeAccountIds().sort()).toEqual([host.playerId, friend.id].sort());
    expect(session.hostName).toBe('Host');
  });

  it('host leaving the lobby abandons the match; a guest leaving frees the seat', () => {
    const a = make({ seats: { B1: { kind: 'human' } } });
    const guest = a.session.join(acct('G'));
    a.session.leave(guest.playerId);
    expect(a.session.view().seats.find((s) => s.id === 'B1')!.claimed).toBe(false);
    a.session.leave(a.host.playerId);
    expect(a.session.currentPhase).toBe('abandoned');
  });
});

describe('character pick', () => {
  it('first come, first served: a taken character is rejected', () => {
    const { session, host } = make({ seats: { B1: { kind: 'human' } } });
    const guest = session.join(acct('G'));
    session.start(host.playerId);
    session.pickCharacter(host.playerId, 'keisha');
    expect(fail(() => session.pickCharacter(guest.playerId, 'keisha')).code).toBe('character_taken');
    session.pickCharacter(guest.playerId, 'dre');
    expect(session.currentPhase).toBe('colors');
  });

  it('can change your pick before the phase ends; unknown characters are rejected', () => {
    const { session, host } = make({ seats: { B1: { kind: 'human' } } });
    session.join(acct('G'));
    session.start(host.playerId);
    session.pickCharacter(host.playerId, 'keisha');
    session.pickCharacter(host.playerId, 'tanya');
    expect(session.view().seats[0]!.characterId).toBe('tanya');
    expect(fail(() => session.pickCharacter(host.playerId, 'batman')).code).toBe('bad_character');
  });

  it('timeout gives unpicked humans then bots random FREE characters, all distinct', () => {
    const { session, sched, host } = make({ config: { mode: '2v2' }, seats: { B1: { kind: 'bot' }, A2: { kind: 'bot' }, B2: { kind: 'bot' } } });
    session.start(host.playerId);
    session.pickCharacter(host.playerId, 'big-mike');
    // host picked and nobody else is human, so the phase ends at once
    const ids = session.view().seats.map((s) => s.characterId);
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe('big-mike');
    expect(ids.every((id) => CHARACTERS.some((c) => c.id === id))).toBe(true);
    void sched;
  });

  it('a human who never picks is auto-assigned when the timer runs out', () => {
    const { session, sched, host, events } = make();
    session.start(host.playerId);
    sched.advance(20_000);
    expect(events.some((e) => e.type === 'character_picked' && e.data.auto === true && e.data.seat === 'A1')).toBe(true);
    expect(session.currentPhase).toBe('colors');
  });

  it('picking is only allowed in the character phase', () => {
    const { session, host } = make();
    expect(fail(() => session.pickCharacter(host.playerId, 'keisha')).code).toBe('wrong_phase');
  });
});

describe('bag colour pick (first come, first served)', () => {
  function toColors(over: Parameters<typeof make>[0] = {}) {
    const ctx = make({ seats: { B1: { kind: 'human' } }, ...over });
    const guest = ctx.session.join(acct('G'));
    ctx.session.start(ctx.host.playerId);
    ctx.session.pickCharacter(ctx.host.playerId, 'keisha');
    ctx.session.pickCharacter(guest.playerId, 'dre');
    return { ...ctx, guest };
  }

  it('the first team to tap a colour gets it; the second is told it is taken', () => {
    const { session, host, guest } = toColors();
    session.pickColor(host.playerId, 'hot-pink');
    const err = fail(() => session.pickColor(guest.playerId, 'hot-pink'));
    expect(err.code).toBe('color_taken');
    expect(err.status).toBe(409);
    session.pickColor(guest.playerId, 'teal');
    expect(session.view().colors).toEqual({ A: 'hot-pink', B: 'teal' });
    expect(session.currentPhase).toBe('toss');
  });

  it('in 2v2 either partner can pick for the team; the other sees it and cannot pick again', () => {
    const sched = new ManualScheduler();
    const s = new MatchSession({
      id: 'X',
      config: { ...DEFAULT_CONFIG, mode: '2v2' },
      seatPlan: { A1: { kind: 'human' }, A2: { kind: 'human' }, B1: { kind: 'human' }, B2: { kind: 'bot' } },
      scheduler: sched,
      rng: createRng(3),
    });
    const a1 = s.createHost(acct('One'));
    const b1 = s.join(acct('Three'), 'B1');
    const a2 = s.join(acct('Two'), 'A2');
    s.start(a1.playerId);
    s.pickCharacter(a1.playerId, 'keisha');
    s.pickCharacter(a2.playerId, 'tanya');
    s.pickCharacter(b1.playerId, 'dre');
    s.pickColor(a2.playerId, 'purple'); // partner picked for the team
    expect(fail(() => s.pickColor(a1.playerId, 'teal')).code).toBe('team_already_picked');
    expect(s.view().colors).toEqual({ A: 'purple' });
    expect(s.currentPhase).toBe('colors'); // still waiting on team B
    expect(fail(() => s.pickColor(b1.playerId, 'purple')).code).toBe('color_taken');
    s.pickColor(b1.playerId, 'teal');
    expect(s.view().colors).toEqual({ A: 'purple', B: 'teal' });
  });

  it('timeout: a team that did not pick gets a random free colour, never the other team\'s', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const ctx = toColors({ seed });
      ctx.session.pickColor(ctx.host.playerId, 'black');
      ctx.sched.advance(15_000);
      const colors = ctx.session.view().colors;
      expect(colors.A).toBe('black');
      expect(colors.B).toBeDefined();
      expect(colors.B).not.toBe('black');
      expect(BAG_COLORS.some((c) => c.id === colors.B)).toBe(true);
    }
  });

  it('bot-only teams pick after the human team, whatever the human picks', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const ctx = make({ seed });
      ctx.session.start(ctx.host.playerId);
      ctx.session.pickCharacter(ctx.host.playerId, 'keisha');
      const pickedColor = BAG_COLORS[seed % BAG_COLORS.length]!.id;
      ctx.session.pickColor(ctx.host.playerId, pickedColor);
      const colors = ctx.session.view().colors;
      expect(colors.A).toBe(pickedColor);
      expect(colors.B).not.toBe(pickedColor);
    }
  });

  it('rejects unknown colours and picks outside the colour phase', () => {
    const { session, host } = toColors();
    expect(fail(() => session.pickColor(host.playerId, 'plaid')).code).toBe('bad_color');
    const early = make();
    expect(fail(() => early.session.pickColor(early.host.playerId, 'black')).code).toBe('wrong_phase');
  });
});

describe('playing a match', () => {
  it('human vs bot plays to the end; results are consistent', () => {
    const ctx = make({ config: { playTo: 11 } });
    toPlaying(ctx);
    let guard = 0;
    while (!ctx.session.isOver) {
      if (++guard > 500) throw new Error('match did not finish');
      if (untilHumanTurn(ctx)) ctx.session.throw(ctx.host.playerId, PERFECT);
    }
    const v = ctx.session.view();
    expect(v.phase).toBe('finished');
    expect(v.winner).not.toBeNull();
    expect(v.scores[v.winner!]).toBeGreaterThanOrEqual(11);
    const end = ctx.events.find((e) => e.type === 'match_end')!;
    expect(end.data.winner).toBe(v.winner);
    expect(end.data.led).toMatchObject({ pattern: 'victory' });
    // every inning has exactly 8 throw results
    const throwsPerInning = new Map<number, number>();
    for (const e of ctx.events.filter((x) => x.type === 'throw_result')) {
      const inning = e.data.inning as number;
      throwsPerInning.set(inning, (throwsPerInning.get(inning) ?? 0) + 1);
    }
    for (const [inning, count] of throwsPerInning) {
      if (inning < v.history.length) expect(count).toBe(8);
    }
    // the only thing left running is the 60 s "play again?" window, and it cleans itself up
    expect(ctx.sched.pending).toBe(1);
    expect(v.rematch).toMatchObject({ votes: {}, matchId: null, cancelled: false });
    ctx.sched.advance(61_000);
    expect(ctx.sched.pending).toBe(0);
  });

  it('a cornhole fires the ring-in sound and LED flash at the moment the bag drops in', () => {
    const ctx = make({ throwSeed: holeSeed() });
    toPlaying(ctx, 'royal-blue');
    untilHumanTurn(ctx);
    ctx.session.throw(ctx.host.playerId, PERFECT);
    const result = ctx.events.find((e) => e.type === 'throw_result' && e.data.seat === 'A1')!;
    expect(result.data.status).toBe('hole');
    const cues = result.data.cues as Array<{ atMs: number; sound?: string; led?: { pattern: string; colors: string[]; boardEnd: number } }>;
    const hit = cues.find((c) => c.sound === 'cornhole_hit')!;
    expect(hit.atMs).toBe(result.data.flightMs);
    expect(hit.led!.pattern).toBe('flash_burst');
    expect(hit.led!.colors).toEqual(['#FFFFFF', '#1D4ED8']); // team A chose royal blue
    expect(hit.led!.boardEnd).toBe(result.data.targetEnd);
  });

  it('a bag that stays on the board only gets a thud, no light show', () => {
    const ctx = make();
    toPlaying(ctx);
    untilHumanTurn(ctx);
    ctx.session.throw(ctx.host.playerId, gestureToward({ x: 0, y: 15 }, 1));
    const result = ctx.events.find((e) => e.type === 'throw_result' && e.data.seat === 'A1')!;
    const cues = result.data.cues as Array<{ sound?: string; led?: unknown }>;
    expect(cues.some((c) => c.sound === 'cornhole_hit')).toBe(false);
    expect(cues.every((c) => !c.led)).toBe(true);
  });

  it('throw_result carries replayable frames live, but the replay log keeps only the outcome', () => {
    const ctx = make();
    toPlaying(ctx);
    untilHumanTurn(ctx);
    ctx.session.throw(ctx.host.playerId, PERFECT);
    const live = ctx.events.find((e) => e.type === 'throw_result' && e.data.seat === 'A1')!;
    expect((live.data.flight as unknown[]).length).toBeGreaterThan(5);
    const logged = ctx.session.eventsSince(0).find((e) => e.type === 'throw_result' && e.data.seat === 'A1')!;
    expect(logged.data.flight).toBeUndefined();
    expect(logged.data.framesOmitted).toBe(true);
    expect(logged.data.status).toBe(live.data.status);
  });

  it('rejects throws out of turn, on a bot turn, during the pause after a throw, and bad gestures', () => {
    const ctx = make();
    expect(fail(() => ctx.session.throw(ctx.host.playerId, PERFECT)).code).toBe('wrong_phase');
    toPlaying(ctx);
    untilHumanTurn(ctx);
    expect(fail(() => ctx.session.throw(ctx.host.playerId, { ...PERFECT, power: 5 })).code).toBe('bad_gesture');
    expect(fail(() => ctx.session.throw(ctx.host.playerId, { ...PERFECT, aim: NaN })).code).toBe('bad_gesture');
    ctx.session.throw(ctx.host.playerId, PERFECT);
    // right after a throw the next turn has not opened yet
    expect(fail(() => ctx.session.throw(ctx.host.playerId, PERFECT)).code).toBe('not_your_turn');
    expect(fail(() => ctx.session.throw('nobody', PERFECT)).status).toBe(404);
  });

  it('a wrong-seat human cannot throw on someone else\'s turn', () => {
    const ctx = make({ seats: { B1: { kind: 'human' } } });
    const guest = ctx.session.join(acct('G'));
    ctx.session.start(ctx.host.playerId);
    ctx.session.pickCharacter(ctx.host.playerId, 'keisha');
    ctx.session.pickCharacter(guest.playerId, 'dre');
    ctx.session.pickColor(ctx.host.playerId, 'black');
    ctx.session.pickColor(guest.playerId, 'white');
    ctx.sched.advance(3000);
    const turn = ctx.session.view().turn!;
    const other = turn.seat === 'A1' ? guest : ctx.host;
    expect(fail(() => ctx.session.throw(other.playerId, PERFECT)).code).toBe('not_your_turn');
    const right = turn.seat === 'A1' ? ctx.host : guest;
    ctx.session.throw(right.playerId, MISS); // works
  });

  it('runs out the clock: 20 s without a throw is a foul, and play moves on', () => {
    const ctx = make();
    toPlaying(ctx);
    untilHumanTurn(ctx);
    const first = ctx.session.view().turn!;
    expect(first.deadlineAt).not.toBeNull();
    ctx.sched.advance(20_000);
    expect(ctx.events.some((e) => e.type === 'throw_timeout')).toBe(true);
    expect(ctx.events.some((e) => e.type === 'turn_start' && e.data.bagId !== first.bagId)).toBe(true);
    const bag = ctx.session.view().board.find((b) => b.id === first.bagId);
    expect(bag).toBeUndefined(); // foul: removed
  });

  it('no timer when the host turned it off', () => {
    const ctx = make({ config: { throwTimerSec: null } });
    toPlaying(ctx);
    untilHumanTurn(ctx);
    expect(ctx.session.view().turn!.deadlineAt).toBeNull();
    ctx.sched.advance(120_000);
    expect(ctx.events.some((e) => e.type === 'throw_timeout')).toBe(false);
  });

  it('2v2 with three bots: the far-end pair throws inning 2, and the match finishes', () => {
    const ctx = make({
      config: { mode: '2v2', playTo: 11 },
      seats: { A1: { kind: 'human' }, B1: { kind: 'bot', level: 'pro' }, A2: { kind: 'bot', level: 'pro' }, B2: { kind: 'bot', level: 'pro' } },
    });
    toPlaying(ctx);
    let guard = 0;
    while (!ctx.session.isOver) {
      if (++guard > 800) throw new Error('did not finish');
      if (untilHumanTurn(ctx)) ctx.session.throw(ctx.host.playerId, PERFECT);
    }
    const seatsBy = (inning: number) =>
      new Set(ctx.events.filter((e) => e.type === 'throw_result' && e.data.inning === inning).map((e) => e.data.seat));
    expect([...seatsBy(1)].sort()).toEqual(['A1', 'B1']);
    if (ctx.session.view().history.length >= 2) expect([...seatsBy(2)].sort()).toEqual(['A2', 'B2']);
  });

  it('is deterministic given the same randomness', () => {
    const run = () => {
      const ctx = make({ seed: 99, config: { playTo: 11 } });
      toPlaying(ctx);
      let guard = 0;
      while (!ctx.session.isOver) {
        if (++guard > 500) throw new Error('did not finish');
        if (untilHumanTurn(ctx)) ctx.session.throw(ctx.host.playerId, PERFECT);
      }
      return ctx.events.map((e) => ({ type: e.type, data: e.data }));
    };
    expect(run()).toEqual(run());
  });
});

describe('disconnects and leaving', () => {
  it('a disconnected player has 30 s to return; after that a bot plays their turns', () => {
    const ctx = make();
    toPlaying(ctx);
    // wait for a moment that is not the human's turn, then drop the connection
    untilHumanTurn(ctx);
    ctx.session.throw(ctx.host.playerId, PERFECT);
    ctx.session.setConnected(ctx.host.playerId, false);
    ctx.sched.advance(29_000);
    expect(ctx.events.some((e) => e.type === 'seat_takeover')).toBe(false);
    ctx.sched.advance(1_500);
    expect(ctx.events.some((e) => e.type === 'seat_takeover' && e.data.reason === 'disconnect')).toBe(true);
    const before = ctx.events.length;
    ctx.sched.advance(30_000);
    const after = ctx.events.slice(before);
    // the bot throws for the human's seat, and nothing times out
    expect(after.some((e) => e.type === 'turn_start' && e.data.seat === 'A1' && e.data.controlledBy === 'bot')).toBe(true);
    expect(after.some((e) => e.type === 'throw_result' && e.data.seat === 'A1')).toBe(true);
    expect(after.some((e) => e.type === 'throw_timeout')).toBe(false);
  });

  it('if the takeover happens mid-turn, the bot throws right away instead of waiting for the clock', () => {
    const ctx = make({ config: { throwTimerSec: null } });
    toPlaying(ctx);
    untilHumanTurn(ctx);
    ctx.session.setConnected(ctx.host.playerId, false);
    ctx.sched.advance(30_500);
    expect(ctx.events.some((e) => e.type === 'turn_control' && e.data.controlledBy === 'bot')).toBe(true);
    ctx.sched.advance(3000);
    expect(ctx.events.some((e) => e.type === 'throw_result' && e.data.seat === 'A1')).toBe(true);
  });

  it('the 20 s throw clock still applies to a player who has dropped but is inside the 30 s grace window', () => {
    const ctx = make();
    toPlaying(ctx);
    untilHumanTurn(ctx);
    ctx.session.setConnected(ctx.host.playerId, false);
    ctx.sched.advance(21_000);
    expect(ctx.events.some((e) => e.type === 'throw_timeout')).toBe(true);
    expect(ctx.events.some((e) => e.type === 'seat_takeover')).toBe(false);
  });

  it('reconnecting within the grace period cancels the takeover', () => {
    const ctx = make();
    toPlaying(ctx);
    ctx.session.setConnected(ctx.host.playerId, false);
    ctx.sched.advance(20_000);
    ctx.session.setConnected(ctx.host.playerId, true);
    ctx.sched.advance(60_000);
    expect(ctx.events.some((e) => e.type === 'seat_takeover')).toBe(false);
  });

  it('reconnecting after a takeover gets the seat back for the next turn', () => {
    const ctx = make();
    toPlaying(ctx);
    ctx.session.setConnected(ctx.host.playerId, false);
    ctx.sched.advance(31_000);
    expect(ctx.events.some((e) => e.type === 'seat_takeover')).toBe(true);
    ctx.session.setConnected(ctx.host.playerId, true);
    expect(ctx.events.some((e) => e.type === 'seat_reclaimed')).toBe(true);
    expect(untilHumanTurn(ctx)).toBe(true);
    ctx.session.throw(ctx.host.playerId, PERFECT);
  });

  it('leaving mid-match hands the seat to a bot immediately; with no humans left the match is abandoned', () => {
    const ctx = make();
    toPlaying(ctx);
    ctx.session.leave(ctx.host.playerId);
    expect(ctx.session.currentPhase).toBe('abandoned');
    expect(ctx.events.some((e) => e.type === 'seat_takeover' && e.data.reason === 'left')).toBe(true);
    expect(ctx.sched.pending).toBe(0);
  });

  it('with another human still in, a leaver is replaced by a bot and the match goes on', () => {
    const ctx = make({ seats: { B1: { kind: 'human' } } });
    const guest = ctx.session.join(acct('G'));
    ctx.session.start(ctx.host.playerId);
    ctx.session.pickCharacter(ctx.host.playerId, 'keisha');
    ctx.session.pickCharacter(guest.playerId, 'dre');
    ctx.session.pickColor(ctx.host.playerId, 'black');
    ctx.session.pickColor(guest.playerId, 'white');
    ctx.sched.advance(3000);
    ctx.session.leave(guest.playerId);
    expect(ctx.session.currentPhase).toBe('playing');
    ctx.sched.advance(60_000);
    expect(ctx.events.some((e) => e.type === 'throw_result' && e.data.seat === 'B1')).toBe(true);
  });

  it('abandons a match that nobody has been connected to for 2 minutes', () => {
    const ctx = make();
    toPlaying(ctx);
    ctx.session.setConnected(ctx.host.playerId, false);
    ctx.sched.advance(119_000);
    expect(ctx.session.currentPhase).not.toBe('abandoned');
    ctx.sched.advance(2_000);
    expect(ctx.session.currentPhase).toBe('abandoned');
    expect(ctx.session.view().winReason).toBe('abandoned');
    expect(ctx.sched.pending).toBe(0);
  });

  it('a subscriber that throws does not break the match', () => {
    const ctx = make();
    ctx.session.subscribe(() => {
      throw new Error('boom');
    });
    expect(() => toPlaying(ctx)).not.toThrow();
  });
});
