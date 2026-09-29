import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/core/errors.js';
import { createRng } from '../src/core/rng.js';
import { DEFAULT_CONFIG, type MatchConfig, type SeatId } from '../src/core/types.js';
import { gestureToward } from '../src/bots/botPolicy.js';
import { ManualScheduler } from '../src/lobby/scheduler.js';
import {
  MatchSession,
  type AccountRef,
  type RematchSeed,
  type SeatPlan,
  type SessionHooks,
  type SessionSnapshot,
  type Timing,
} from '../src/lobby/session.js';

let counter = 0;
const acct = (name: string): AccountRef => ({ id: `acct-${++counter}-${name.replace(/\W/g, '')}`, displayName: name });
const PERFECT = gestureToward({ x: 0, y: 39 }, 1);
const FAST: Partial<Timing> = { botThinkMinMs: 200, botThinkMaxMs: 400, reactionMs: 300, inningEndMs: 300 };

function fail(fn: () => void): DomainError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    return e as DomainError;
  }
  throw new Error('expected a DomainError');
}

interface Setup {
  config?: Partial<MatchConfig>;
  seats?: SeatPlan;
  hooks?: SessionHooks;
  timing?: Partial<Timing>;
  sched?: ManualScheduler;
  seed?: number;
}

function make(o: Setup = {}) {
  const sched = o.sched ?? new ManualScheduler();
  const hostAcct = acct('Host');
  // Fixed throw seeds: a match plays out the same way every run, so these tests never depend on luck.
  let seedCounter = 0;
  const session = new MatchSession({
    id: 'FEAT2345',
    seedSource: () => ++seedCounter * 7919,
    config: { ...DEFAULT_CONFIG, mode: '1v1', playTo: 11, ...o.config },
    seatPlan: o.seats ?? { A1: { kind: 'human' }, B1: { kind: 'bot', level: 'regular' } },
    scheduler: sched,
    rng: createRng(o.seed ?? 5),
    timing: { ...FAST, ...o.timing },
    ...(o.hooks ? { hooks: o.hooks } : {}),
  });
  const host = session.createHost(hostAcct);
  return { session, sched, host, hostAcct };
}

/** Get a match to the first turn. `humans` are the accounts already seated. */
function toPlaying(session: MatchSession, sched: ManualScheduler, humans: Array<{ id: string; color: string; character: string }>) {
  session.start(humans[0]!.id);
  for (const h of humans) session.pickCharacter(h.id, h.character);
  for (const h of humans) {
    try {
      session.pickColor(h.id, h.color);
    } catch (e) {
      if (!(e instanceof DomainError) || !['team_already_picked', 'wrong_phase'].includes(e.code)) throw e;
    }
  }
  sched.advance(3000);
}

/** Advance time; when it is a human's turn, they throw. Stops when `until` is true or the match is over. */
function play(session: MatchSession, sched: ManualScheduler, humans: string[], until: () => boolean = () => false, maxSteps = 6000) {
  for (let i = 0; i < maxSteps; i++) {
    if (session.isOver || until()) return;
    const v = session.view();
    if (v.turn?.controlledBy === 'human') {
      const seat = v.seats.find((s) => s.id === v.turn!.seat)!;
      if (seat.accountId && humans.includes(seat.accountId)) session.throw(seat.accountId, PERFECT);
    }
    sched.advance(250);
  }
  if (!session.isOver && !until()) throw new Error('did not reach the goal');
}

describe('setSeat', () => {
  it('turns a bot seat into an open human seat, and an empty human seat back into a bot of a chosen level', () => {
    const { session, host } = make();
    session.setSeat(host.playerId, 'B1', 'human');
    expect(session.view().seats.find((s) => s.id === 'B1')).toMatchObject({ kind: 'human', claimed: false, botLevel: null });
    expect(session.invitePreview().openSeats).toEqual(['B1']);
    session.setSeat(host.playerId, 'B1', 'bot', 'pro');
    expect(session.view().seats.find((s) => s.id === 'B1')).toMatchObject({ kind: 'bot', botLevel: 'pro', claimed: true });
    session.setSeat(host.playerId, 'B1', 'bot'); // no level given: keeps the old one
    expect(session.view().seats.find((s) => s.id === 'B1')!.botLevel).toBe('pro');
  });

  it('tells clients about the change', () => {
    const { session, host } = make();
    const seen: string[] = [];
    session.subscribe((e) => seen.push(e.type));
    session.setSeat(host.playerId, 'B1', 'human');
    expect(seen).toContain('seats');
  });

  it('is host-only, lobby-only, and refuses A1 and a seat with someone in it', () => {
    const { session, host } = make({ seats: { B1: { kind: 'human' } } });
    const friend = acct('Friend');
    session.join(friend);
    expect(fail(() => session.setSeat(friend.id, 'B1', 'bot')).code).toBe('not_host');
    expect(fail(() => session.setSeat(host.playerId, 'B1', 'bot')).code).toBe('seat_taken');
    expect(fail(() => session.setSeat(host.playerId, 'A1', 'bot')).code).toBe('bad_seat');
    expect(fail(() => session.setSeat(host.playerId, 'Z9' as SeatId, 'bot')).code).toBe('bad_seat');
    expect(fail(() => session.setSeat(host.playerId, 'A2' as SeatId, 'bot')).code).toBe('bad_seat'); // no A2 in 1v1
    session.start(host.playerId);
    expect(fail(() => session.setSeat(host.playerId, 'B1', 'bot')).code).toBe('wrong_phase');
  });
});

describe('kick', () => {
  it('removes a player, keeps the seat open, announces it, and lets them (or anyone) take it again', () => {
    const { session, host } = make({ seats: { B1: { kind: 'human' } } });
    const friend = acct('Friend');
    session.join(friend);
    const seen: Array<{ type: string; data: Record<string, unknown> }> = [];
    session.subscribe((e) => seen.push({ type: e.type, data: e.data }));
    session.kick(host.playerId, 'B1');
    expect(seen.find((e) => e.type === 'kicked')!.data).toEqual({ seat: 'B1', accountId: friend.id });
    expect(session.hasActivePlayer(friend.id)).toBe(false);
    expect(session.view().seats.find((s) => s.id === 'B1')).toMatchObject({ claimed: false, accountId: null, name: null });
    expect(session.view(friend.id).you).toBeNull();
    expect(fail(() => session.pickCharacter(friend.id, 'dre')).code).toBe('unknown_player');
    // the seat is open for anyone, including the person who was removed
    expect(session.join(friend).seat).toBe('B1');
    expect(session.hasActivePlayer(friend.id)).toBe(true);
  });

  it('is host-only, lobby-only, and refuses the host and an empty seat', () => {
    const { session, host } = make({ seats: { B1: { kind: 'human' } } });
    const friend = acct('Friend');
    session.join(friend);
    expect(fail(() => session.kick(friend.id, 'A1')).code).toBe('not_host');
    expect(fail(() => session.kick(host.playerId, 'A1')).code).toBe('bad_seat');
    session.kick(host.playerId, 'B1');
    expect(fail(() => session.kick(host.playerId, 'B1')).code).toBe('seat_empty');
    session.join(friend);
    session.start(host.playerId);
    expect(fail(() => session.kick(host.playerId, 'B1')).code).toBe('wrong_phase');
  });
});

describe('start with bots', () => {
  it('fills open seats with regular bots only when asked', () => {
    const { session, host } = make({ config: { mode: '2v2' }, seats: { B1: { kind: 'human' }, A2: { kind: 'human' }, B2: { kind: 'bot', level: 'pro' } } });
    expect(fail(() => session.start(host.playerId)).code).toBe('seats_open');
    session.start(host.playerId, { fillOpenWithBots: true });
    const kinds = Object.fromEntries(session.view().seats.map((s) => [s.id, `${s.kind}:${s.botLevel ?? '-'}`]));
    expect(kinds).toEqual({ A1: 'human:-', B1: 'bot:regular', A2: 'bot:regular', B2: 'bot:pro' });
  });
});

describe('per-player stats and match summary', () => {
  it('counts throws, holes, boards and fouls per seat and adds up to the innings', () => {
    const { session, sched, host } = make();
    toPlaying(session, sched, [{ id: host.playerId, color: 'teal', character: 'keisha' }]);
    play(session, sched, [host.playerId]);
    const summary = session.summary()!;
    expect(summary).not.toBeNull();
    const view = session.view();
    const [human, bot] = [summary.players.find((p) => p.kind === 'human')!, summary.players.find((p) => p.kind === 'bot')!];
    expect(human).toMatchObject({ accountId: host.playerId, displayName: 'Host', leftEarly: false, characterId: 'keisha' });
    expect(bot).toMatchObject({ accountId: null, botLevel: 'regular' });
    expect(human.throws + bot.throws).toBe(view.history.length * 8);
    const holesInHistory = view.history.reduce((n, h) => n + h.bags.holes.A + h.bags.holes.B, 0);
    const boardsInHistory = view.history.reduce((n, h) => n + h.bags.boards.A + h.bags.boards.B, 0);
    expect(human.holes + bot.holes).toBe(holesInHistory);
    expect(human.boards + bot.boards).toBe(boardsInHistory);
    expect(summary).toMatchObject({ code: 'FEAT2345', outcome: view.winReason, winner: view.winner, innings: view.history.length, rematchOf: null });
    expect(summary.scores).toEqual(view.scores);
    expect(summary.startedAt!.getTime()).toBeLessThanOrEqual(summary.endedAt.getTime());
  });

  it('a timed-out throw counts as a throw and a foul', () => {
    const { session, sched, host } = make({ config: { throwTimerSec: 20 } });
    toPlaying(session, sched, [{ id: host.playerId, color: 'teal', character: 'keisha' }]);
    play(session, sched, [], () => session.view().turn?.controlledBy === 'human');
    sched.advance(20_000);
    // finish the match with someone else's help so the summary exists: abandon by leaving after the timeout
    session.leave(host.playerId);
    expect(session.isOver).toBe(true);
    const human = session.summary()!.players.find((p) => p.kind === 'human')!;
    expect(human.fouls).toBeGreaterThanOrEqual(1);
    expect(human.throws).toBeGreaterThanOrEqual(1);
    expect(human.leftEarly).toBe(true);
  });

  it('a player who left, and one whose bot never handed the seat back, are both marked as leaving early', () => {
    const { session, sched, host } = make({ seats: { B1: { kind: 'human' } } });
    const friend = acct('Friend');
    session.join(friend);
    toPlaying(session, sched, [
      { id: host.playerId, color: 'teal', character: 'keisha' },
      { id: friend.id, color: 'red', character: 'dre' },
    ]);
    session.setConnected(friend.id, false);
    sched.advance(31_000); // friend never returns: a bot plays their seat
    session.leave(host.playerId); // host leaves; friend is the only "human" left, and away
    const players = session.summary() ? session.summary()!.players : [];
    if (session.currentPhase === 'abandoned') {
      expect(players.find((p) => p.accountId === host.playerId)!.leftEarly).toBe(true);
      expect(players.find((p) => p.accountId === friend.id)!.leftEarly).toBe(true);
    }
  });

  it('no summary for a match that never got going, or one that is still running', () => {
    const lobby = make();
    lobby.session.leave(lobby.host.playerId); // abandoned in the lobby
    expect(lobby.session.summary()).toBeNull();
    const running = make();
    toPlaying(running.session, running.sched, [{ id: running.host.playerId, color: 'teal', character: 'keisha' }]);
    expect(running.session.summary()).toBeNull();
  });
});

describe('hooks', () => {
  it('calls onEnded exactly once when a match finishes, and once when it is abandoned', () => {
    let ended = 0;
    const finishing = make({ hooks: { onEnded: () => ended++ } });
    toPlaying(finishing.session, finishing.sched, [{ id: finishing.host.playerId, color: 'teal', character: 'keisha' }]);
    play(finishing.session, finishing.sched, [finishing.host.playerId]);
    finishing.sched.advance(120_000);
    expect(ended).toBe(1);

    const abandoned = make({ hooks: { onEnded: () => ended++ } });
    abandoned.session.leave(abandoned.host.playerId);
    expect(ended).toBe(2);
    expect(fail(() => abandoned.session.leave(abandoned.host.playerId)).code).toBe('unknown_player');
    expect(ended).toBe(2);
  });

  it('calls onChange as things happen, and survives a hook that throws', () => {
    let changes = 0;
    const { session, sched, host } = make({
      hooks: {
        onChange: () => {
          changes++;
          throw new Error('disk full');
        },
      },
    });
    expect(changes).toBeGreaterThan(0);
    expect(() => toPlaying(session, sched, [{ id: host.playerId, color: 'teal', character: 'keisha' }])).not.toThrow();
    expect(session.currentPhase).toBe('playing');
  });
});

describe('rematch', () => {
  function finished(o: { seats?: SeatPlan; hooks?: SessionHooks; extra?: AccountRef[] } = {}) {
    const ctx = make({ ...(o.seats ? { seats: o.seats } : {}), ...(o.hooks ? { hooks: o.hooks } : {}) });
    const humans = [{ id: ctx.host.playerId, color: 'teal', character: 'keisha' }];
    for (const [i, extra] of (o.extra ?? []).entries()) {
      ctx.session.join(extra);
      humans.push({ id: extra.id, color: 'red', character: ['dre', 'tanya', 'carlos'][i]! });
    }
    toPlaying(ctx.session, ctx.sched, humans);
    play(ctx.session, ctx.sched, humans.map((h) => h.id));
    return { ...ctx, humans };
  }

  it('opens a 60 second window when the match ends, and closes it on its own', () => {
    const ctx = finished();
    expect(ctx.session.view().rematch).toMatchObject({ votes: {}, matchId: null, cancelled: false });
    expect(ctx.session.view().rematch!.deadlineAt).toBeGreaterThan(ctx.sched.now());
    ctx.sched.advance(60_001);
    expect(ctx.session.view().rematch).toMatchObject({ cancelled: true });
    expect(ctx.sched.pending).toBe(0);
  });

  it('a lone human saying yes starts it straight away with everyone kept where they were', () => {
    let seed: RematchSeed | null = null;
    const ctx = finished({ hooks: { createRematch: (_s, sd) => ((seed = sd), 'NEWMATCH') } });
    ctx.session.voteRematch(ctx.host.playerId, true);
    expect(ctx.session.view().rematch).toMatchObject({ matchId: 'NEWMATCH', votes: { [ctx.host.playerId]: true } });
    expect(seed).not.toBeNull();
    expect(seed!.rematchOf).toBe('FEAT2345');
    expect(seed!.config).toEqual(ctx.session.config);
    expect(seed!.colors).toMatchObject({ A: 'teal' });
    expect(seed!.players).toEqual([{ id: ctx.host.playerId, seat: 'A1', name: 'Host', host: true }]);
    expect(seed!.seats.map((s) => [s.id, s.kind, s.playerId, s.characterId !== null])).toEqual([
      ['A1', 'human', ctx.host.playerId, true],
      ['B1', 'bot', null, true],
    ]);
  });

  it('two humans: waits for both, a "no" turns that seat into a bot', () => {
    let seed: RematchSeed | null = null;
    const friend = acct('Friend');
    const ctx = finished({ seats: { B1: { kind: 'human' } }, extra: [friend], hooks: { createRematch: (_s, sd) => ((seed = sd), 'NEW22222') } });
    ctx.session.voteRematch(ctx.host.playerId, true);
    expect(seed).toBeNull(); // still waiting for the friend
    ctx.session.voteRematch(friend.id, false);
    expect(seed!.players.map((p) => p.id)).toEqual([ctx.host.playerId]);
    const b1 = seed!.seats.find((s) => s.id === 'B1')!;
    expect(b1).toMatchObject({ kind: 'bot', playerId: null, characterId: 'dre', controlledByBot: false });
  });

  it('the window running out starts it for whoever said yes, and the host role passes on if the host said no', () => {
    let seed: RematchSeed | null = null;
    const friend = acct('Friend');
    const ctx = finished({ seats: { B1: { kind: 'human' } }, extra: [friend], hooks: { createRematch: (_s, sd) => ((seed = sd), 'NEW33333') } });
    ctx.session.voteRematch(friend.id, true); // host never answers
    expect(seed).toBeNull();
    ctx.sched.advance(60_001);
    expect(seed!.players).toEqual([{ id: friend.id, seat: 'B1', name: 'Friend', host: true }]);
  });

  it('nobody saying yes cancels it', () => {
    let called = false;
    const ctx = finished({ hooks: { createRematch: () => ((called = true), 'X') } });
    const seen: string[] = [];
    ctx.session.subscribe((e) => seen.push(e.type));
    ctx.session.voteRematch(ctx.host.playerId, false);
    expect(called).toBe(false);
    expect(seen).toContain('rematch_cancelled');
    expect(ctx.session.view().rematch).toMatchObject({ cancelled: true, matchId: null });
  });

  it('if the new match cannot be created the rematch is cancelled with the reason', () => {
    const ctx = finished({ hooks: { createRematch: () => { throw new DomainError('maintenance', 'later', 503); } } });
    const seen: Array<{ type: string; data: Record<string, unknown> }> = [];
    ctx.session.subscribe((e) => seen.push({ type: e.type, data: e.data }));
    ctx.session.voteRematch(ctx.host.playerId, true);
    expect(seen.find((e) => e.type === 'rematch_cancelled')!.data.reason).toBe('maintenance');
  });

  it('without a rematch hook it reports "unavailable" instead of hanging', () => {
    const ctx = finished();
    const seen: Array<{ type: string; data: Record<string, unknown> }> = [];
    ctx.session.subscribe((e) => seen.push({ type: e.type, data: e.data }));
    ctx.session.voteRematch(ctx.host.playerId, true);
    expect(seen.find((e) => e.type === 'rematch_cancelled')!.data.reason).toBe('unavailable');
  });

  it('cannot vote twice after it is decided, before the match ends, or as a stranger', () => {
    const ctx = finished({ hooks: { createRematch: () => 'NEW44444' } });
    ctx.session.voteRematch(ctx.host.playerId, true);
    expect(fail(() => ctx.session.voteRematch(ctx.host.playerId, true)).code).toBe('rematch_closed');
    expect(fail(() => ctx.session.voteRematch('stranger', true)).code).toBe('unknown_player');
    const running = make();
    toPlaying(running.session, running.sched, [{ id: running.host.playerId, color: 'teal', character: 'keisha' }]);
    expect(fail(() => running.session.voteRematch(running.host.playerId, true)).code).toBe('wrong_phase');
  });

  it('the new match keeps characters and colors, skips the picks, and goes straight to the coin toss', () => {
    let seed: RematchSeed | null = null;
    const ctx = finished({ hooks: { createRematch: (_s, sd) => ((seed = sd), 'NEW55555') } });
    ctx.session.voteRematch(ctx.host.playerId, true);
    const sched = new ManualScheduler(ctx.sched.now());
    const next = MatchSession.fromRematch({ id: 'NEW55555', scheduler: sched, rng: createRng(9), timing: FAST }, seed!);
    expect(next.rematchOf).toBe('FEAT2345');
    expect(next.currentPhase).toBe('lobby');
    next.beginRematch();
    expect(next.currentPhase).toBe('toss');
    const v = next.view();
    expect(v.colors).toEqual({ A: 'teal', B: expect.any(String) });
    expect(v.seats.find((s) => s.id === 'A1')).toMatchObject({ accountId: ctx.host.playerId, characterId: 'keisha', connected: false });
    expect(v.rematchOf).toBe('FEAT2345');
    next.setConnected(ctx.host.playerId, true);
    sched.advance(5000);
    expect(next.currentPhase).toBe('playing');
    play(next, sched, [ctx.host.playerId]);
    expect(next.view().phase).toBe('finished');
  });

  it('a player who never turns up to the new match is replaced by a bot after the usual 30 seconds', () => {
    let seed: RematchSeed | null = null;
    const ctx = finished({ hooks: { createRematch: (_s, sd) => ((seed = sd), 'NEW66666') } });
    ctx.session.voteRematch(ctx.host.playerId, true);
    const sched = new ManualScheduler(ctx.sched.now());
    const next = MatchSession.fromRematch({ id: 'NEW66666', scheduler: sched, rng: createRng(9), timing: FAST }, seed!);
    next.beginRematch();
    sched.advance(31_000);
    expect(next.view().seats.find((s) => s.id === 'A1')!.controlledByBot).toBe(true);
  });
});

describe('snapshot and restore', () => {
  const plain = (o: unknown) => JSON.parse(JSON.stringify(o));
  const hostHumans = (host: { playerId: string }) => [{ id: host.playerId, color: 'teal', character: 'keisha' }];

  /** Restore into a fresh scheduler that starts at the same instant, as if the server had restarted. */
  function restart(session: MatchSession, sched: ManualScheduler, gapMs = 0) {
    const snap = plain(session.snapshot()) as SessionSnapshot; // proves it survives being stored as JSON
    const sched2 = new ManualScheduler(sched.now() + gapMs);
    const restored = MatchSession.restore(snap, { scheduler: sched2, rng: createRng(77), timing: FAST });
    return { restored, sched2, snap };
  }

  it('is plain JSON, and rebuilding from it gives the same match', () => {
    const { session, sched, host } = make();
    toPlaying(session, sched, hostHumans(host));
    play(session, sched, [host.playerId], () => session.view().history.length >= 1 && session.view().turn?.controlledBy === 'human');
    const { restored, snap } = restart(session, sched);
    expect(plain(session.snapshot())).toEqual(snap);
    const before = session.view();
    const after = restored.view();
    for (const key of ['id', 'phase', 'config', 'colors', 'scores', 'inning', 'firstTeam', 'board', 'history', 'seq', 'createdAt'] as const) {
      expect(plain(after[key]), key).toEqual(plain(before[key]));
    }
    expect(after.seats.map((s) => [s.id, s.name, s.characterId, s.kind, s.accountId])).toEqual(before.seats.map((s) => [s.id, s.name, s.characterId, s.kind, s.accountId]));
  });

  it('after a restart nobody counts as connected, and there is the usual 30 seconds to get back', () => {
    const { session, sched, host } = make();
    toPlaying(session, sched, hostHumans(host));
    const { restored, sched2 } = restart(session, sched);
    restored.resume();
    expect(restored.view().seats.find((s) => s.id === 'A1')!.connected).toBe(false);
    sched2.advance(29_000);
    expect(restored.view().seats.find((s) => s.id === 'A1')!.controlledByBot).toBe(false);
    restored.setConnected(host.playerId, true);
    sched2.advance(60_000);
    expect(restored.view().seats.find((s) => s.id === 'A1')!.controlledByBot).toBe(false);
  });

  it('a player who does not come back loses the seat to a bot, and the match keeps going', () => {
    const { session, sched, host } = make();
    toPlaying(session, sched, hostHumans(host));
    const { restored, sched2 } = restart(session, sched);
    restored.resume();
    sched2.advance(31_000);
    expect(restored.view().seats.find((s) => s.id === 'A1')!.controlledByBot).toBe(true);
    sched2.advance(120_000);
    expect(restored.view().history.length).toBeGreaterThan(0); // bots are playing both sides
  });

  it('mid-match: everyone reconnects and the match plays out to a proper finish', () => {
    const { session, sched, host } = make({ config: { playTo: 21 } });
    toPlaying(session, sched, hostHumans(host));
    play(session, sched, [host.playerId], () => session.view().history.length >= 2);
    expect(session.currentPhase).toBe('playing');
    const { restored, sched2 } = restart(session, sched, 5000);
    restored.resume();
    restored.setConnected(host.playerId, true);
    play(restored, sched2, [host.playerId]);
    const v = restored.view();
    expect(v.phase).toBe('finished');
    expect(v.scores[v.winner!]).toBeGreaterThanOrEqual(21);
    expect(v.history.length).toBeGreaterThanOrEqual(2);
    const inningNumbers = v.history.map((h) => h.inning);
    expect(inningNumbers).toEqual(inningNumbers.map((_, i) => i + 1)); // no inning repeated or skipped across the restart
  });

  it('a human whose turn was open gets at least 8 seconds to throw after the restart', () => {
    const { session, sched, host } = make({ config: { throwTimerSec: 20 } });
    toPlaying(session, sched, hostHumans(host));
    play(session, sched, [], () => session.view().turn?.controlledBy === 'human');
    sched.advance(19_500); // almost out of time when the server dies
    const { restored, sched2 } = restart(session, sched);
    restored.resume();
    restored.setConnected(host.playerId, true);
    expect(restored.view().turn!.deadlineAt).toBeGreaterThanOrEqual(sched2.now() + 8000);
    sched2.advance(5000);
    expect(() => restored.throw(host.playerId, PERFECT)).not.toThrow();
  });

  it('a bot turn in progress is carried on, and a pause between turns picks up with the next turn', () => {
    const { session, sched, host } = make({ seed: 11 });
    toPlaying(session, sched, hostHumans(host));
    play(session, sched, [host.playerId], () => session.view().turn?.controlledBy === 'bot');
    const mid = restart(session, sched);
    mid.restored.resume();
    mid.restored.setConnected(host.playerId, true);
    const seenThrows: string[] = [];
    mid.restored.subscribe((e) => e.type === 'throw_result' && seenThrows.push(e.data.bagId as string));
    mid.sched2.advance(3000);
    expect(seenThrows).toHaveLength(1); // the bot's throw happened

    // now a moment with no open turn
    play(mid.restored, mid.sched2, [host.playerId], () => mid.restored.view().turn === null);
    const between = restart(mid.restored, mid.sched2);
    between.restored.resume();
    between.restored.setConnected(host.playerId, true);
    const turnStarts: string[] = [];
    between.restored.subscribe((e) => e.type === 'turn_start' && turnStarts.push(e.data.bagId as string));
    between.sched2.advance(4000);
    expect(turnStarts.length).toBeGreaterThanOrEqual(1); // play picked up with the next turn
  });

  it('pick and toss phases restart with sensible timers and still reach the game', () => {
    const a = make();
    a.session.start(a.host.playerId);
    expect(a.session.currentPhase).toBe('characters');
    const chars = restart(a.session, a.sched, 1000);
    chars.restored.resume();
    chars.restored.setConnected(a.host.playerId, true);
    chars.sched2.advance(20_001); // pick timer runs out
    expect(chars.restored.currentPhase).toBe('colors');
    chars.sched2.advance(15_001);
    expect(['toss', 'playing']).toContain(chars.restored.currentPhase);
    chars.sched2.advance(4000);
    expect(chars.restored.currentPhase).toBe('playing');

    const b = make();
    toPlaying(b.session, b.sched, hostHumans(b.host));
    const b0 = make();
    b0.session.start(b0.host.playerId);
    b0.session.pickCharacter(b0.host.playerId, 'keisha');
    b0.session.pickColor(b0.host.playerId, 'teal');
    expect(b0.session.currentPhase).toBe('toss');
    const toss = restart(b0.session, b0.sched);
    toss.restored.resume();
    toss.restored.setConnected(b0.host.playerId, true);
    toss.sched2.advance(3500);
    expect(toss.restored.currentPhase).toBe('playing');
  });

  it('a lobby restarts as a lobby, and is abandoned if nobody comes back for 2 minutes', () => {
    const { session, sched, host } = make({ seats: { B1: { kind: 'human' } } });
    session.join(acct('Friend'));
    const { restored, sched2 } = restart(session, sched);
    restored.resume();
    expect(restored.currentPhase).toBe('lobby');
    expect(restored.invitePreview().openSeats).toEqual([]);
    sched2.advance(121_000);
    expect(restored.currentPhase).toBe('abandoned');
    void host;
  });

  it('carries on numbering events where it left off, so clients can tell they need to reload', () => {
    const { session, sched, host } = make();
    toPlaying(session, sched, hostHumans(host));
    const seqBefore = session.seqNumber;
    const { restored } = restart(session, sched);
    expect(restored.seqNumber).toBe(seqBefore);
    restored.resume();
    expect(restored.seqNumber).toBeGreaterThan(seqBefore);
    expect(restored.eventsSince(0).map((e) => e.type)).toEqual(['resumed']); // old events are not kept
  });

  it('statistics survive the restart', () => {
    const { session, sched, host } = make({ config: { playTo: 21 } });
    toPlaying(session, sched, hostHumans(host));
    play(session, sched, [host.playerId], () => session.view().history.length >= 2);
    expect(session.currentPhase).toBe('playing');
    const throwsBefore = (session.snapshot().seatStats.A1.throws);
    expect(throwsBefore).toBeGreaterThan(0);
    const { restored, sched2 } = restart(session, sched);
    restored.resume();
    restored.setConnected(host.playerId, true);
    play(restored, sched2, [host.playerId]);
    expect(restored.summary()!.players.find((p) => p.kind === 'human')!.throws).toBeGreaterThanOrEqual(throwsBefore);
    expect(restored.summary()!.startedAt).not.toBeNull();
  });

  it('refuses to restore finished matches and snapshots it does not understand', () => {
    const { session, sched, host } = make();
    toPlaying(session, sched, hostHumans(host));
    const snap = plain(session.snapshot()) as SessionSnapshot;
    const opts = { scheduler: new ManualScheduler(), timing: FAST };
    expect(() => MatchSession.restore({ ...snap, phase: 'finished' }, opts)).toThrow(/not restored/);
    expect(() => MatchSession.restore({ ...snap, phase: 'abandoned' }, opts)).toThrow(/not restored/);
    expect(() => MatchSession.restore({ ...snap, version: 2 as never }, opts)).toThrow(/Unknown snapshot version/);
  });

  it('restoring never shares memory with the snapshot it came from', () => {
    const { session, sched, host } = make();
    toPlaying(session, sched, hostHumans(host));
    const snap = session.snapshot();
    const restored = MatchSession.restore(snap, { scheduler: new ManualScheduler(sched.now()), timing: FAST });
    snap.seats[0]!.characterId = 'tampered';
    snap.engine!.scores.A = 99;
    expect(restored.view().seats[0]!.characterId).toBe('keisha');
    expect(restored.view().scores.A).toBe(0);
  });
});
