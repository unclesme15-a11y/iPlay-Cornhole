import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng.js';
import { DEFAULT_CONFIG, type MatchConfig, type TeamId } from '../src/core/types.js';
import { decideThrow, type BotLevel } from '../src/bots/botPolicy.js';
import { ManualScheduler } from '../src/lobby/scheduler.js';
import { MatchSession, type SeatPlan } from '../src/lobby/session.js';

/**
 * Plays whole matches through the real session code. The "human" seat is driven by the same bot
 * policy at a chosen skill level, so every path a real match takes (picks, toss, turns, timers,
 * innings, scoring, finish) runs end to end.
 */
function playMatch(opts: { seed: number; config: Partial<MatchConfig>; seats: SeatPlan; humanLevel: BotLevel }) {
  const sched = new ManualScheduler();
  const rng = createRng(opts.seed);
  let throwSeed = opts.seed * 100_003;
  const session = new MatchSession({
    seedSource: () => (throwSeed += 7919),
    id: `SOAK${opts.seed}`,
    config: { ...DEFAULT_CONFIG, ...opts.config },
    seatPlan: opts.seats,
    scheduler: sched,
    rng,
  });
  const host = session.createHost({ id: 'soak-host', displayName: 'Host' });
  session.start(host.playerId);
  session.pickCharacter(host.playerId, 'keisha');
  session.pickColor(host.playerId, 'teal');
  sched.advance(3000);

  let steps = 0;
  while (!session.isOver) {
    if (++steps > 20_000) throw new Error(`match ${opts.seed} did not finish`);
    const view = session.view(host.playerId);
    if (view.turn && view.turn.controlledBy === 'human') {
      const board = view.board
        .filter((b) => b.status === 'board' && b.x !== null && b.y !== null)
        .map((b) => ({ id: b.id, team: b.team, x: b.x!, y: b.y! }));
      const points = { A: 0, B: 0 };
      const d = decideThrow({ level: opts.humanLevel, team: view.turn.team, boardBags: board, bagsLeft: view.turn.bagsLeft[view.turn.team], points, rng, wind: view.turn.wind });
      session.throw(host.playerId, d.gesture);
    }
    sched.advance(700);
  }
  return { session, sched, view: session.view(host.playerId) };
}

// These play hundreds of whole matches, so they get a generous limit for when the whole suite runs at once.
const SOAK_TIMEOUT = 180_000;

describe('soak: full matches through the real session', () => {
  it('300 mixed matches all finish cleanly with a consistent result', () => {
    const rng = createRng(2026);
    let totalInnings = 0;
    const winReasons: Record<string, number> = {};
    for (let i = 0; i < 300; i++) {
      const mode = rng() < 0.5 ? '1v1' : '2v2';
      const playTo = ([11, 15, 21] as const)[Math.floor(rng() * 3)]!;
      const levels: BotLevel[] = ['rookie', 'regular', 'pro'];
      const lvl = () => levels[Math.floor(rng() * 3)]!;
      const seats: SeatPlan = { B1: { kind: 'bot', level: lvl() }, ...(mode === '2v2' ? { A2: { kind: 'bot', level: lvl() }, B2: { kind: 'bot', level: lvl() } } : {}) };
      const { session, sched, view } = playMatch({
        seed: i + 1,
        config: { mode, playTo, bust: rng() < 0.3, skunk: rng() < 0.3, distance: rng() < 0.5 ? 'regulation' : 'backyard' },
        seats,
        humanLevel: lvl(),
      });
      expect(view.phase).toBe('finished');
      expect(['A', 'B']).toContain(view.winner);
      const w = view.winner as TeamId;
      // the winner reached the target (or won by skunk), and history adds up
      if (view.winReason === 'score') expect(view.scores[w]).toBeGreaterThanOrEqual(playTo);
      if (view.winReason === 'skunk') expect(view.scores[w]).toBeGreaterThanOrEqual(11);
      expect(view.history.at(-1)!.scoreAfter).toEqual(view.scores);
      for (const inning of view.history) {
        expect(inning.scored).toBeLessThanOrEqual(12);
        expect(inning.scored).toBe(Math.abs(inning.points.A - inning.points.B));
      }
      // ends alternate: odd innings from end 0, even from end 1
      view.history.forEach((h, idx) => expect(h.fromEnd).toBe(idx % 2));
      sched.advance(61_000); // let the rematch window close
      expect(sched.pending).toBe(0);
      totalInnings += view.history.length;
      winReasons[view.winReason ?? 'none'] = (winReasons[view.winReason ?? 'none'] ?? 0) + 1;
      session.dispose();
    }
    const avg = totalInnings / 300;
    if (process.env.SOAK_LOG) console.log('avg innings', avg.toFixed(1), 'win reasons', JSON.stringify(winReasons));
    // A real game to 21 between average players runs roughly 5-15 innings; guard against absurd extremes.
    expect(avg).toBeGreaterThan(2);
    expect(avg).toBeLessThan(25);
    expect(winReasons.score).toBeGreaterThan(0);
  }, SOAK_TIMEOUT);

  it('skill matters: a Pro beats a Rookie in most 1v1 matches to 21', () => {
    let proWins = 0;
    const N = 120;
    for (let i = 0; i < N; i++) {
      const { view } = playMatch({
        seed: 5000 + i,
        config: { mode: '1v1', playTo: 21 },
        seats: { B1: { kind: 'bot', level: 'rookie' } },
        humanLevel: 'pro',
      });
      if (view.winner === 'A') proWins++;
    }
    if (process.env.SOAK_LOG) console.log('pro beats rookie', ((proWins / N) * 100).toFixed(0) + '%');
    expect(proWins / N).toBeGreaterThan(0.85);
  }, SOAK_TIMEOUT);

  it('equal skill is close to a coin flip (no built-in side advantage)', () => {
    let aWins = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const { view } = playMatch({
        seed: 9000 + i,
        config: { mode: '1v1', playTo: 21 },
        seats: { B1: { kind: 'bot', level: 'regular' } },
        humanLevel: 'regular',
      });
      if (view.winner === 'A') aWins++;
    }
    if (process.env.SOAK_LOG) console.log('team A wins at equal skill', ((aWins / N) * 100).toFixed(0) + '%');
    expect(aWins / N).toBeGreaterThan(0.38);
    expect(aWins / N).toBeLessThan(0.62);
  }, SOAK_TIMEOUT);
});
