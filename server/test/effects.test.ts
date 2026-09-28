import { describe, expect, it } from 'vitest';
import { BOARD } from '../src/core/constants.js';
import { gestureToward } from '../src/bots/botPolicy.js';
import { simulateThrow } from '../src/physics/throwSim.js';
import { LED_BOARD, SOUNDS, cuesForThrow, scoreCue, victoryCue } from '../src/presentation/effects.js';

const colors = { A: '#1D4ED8', B: '#E0218A' };
const ctx = (team: 'A' | 'B' = 'A') => ({ targetEnd: 1 as const, teamColorHex: colors, teamOfBag: () => team });

function throwAt(target: { x: number; y: number }, arc: number, board: Array<{ id: string; x: number; y: number }> = [], seed = 1) {
  return simulateThrow({ gesture: gestureToward(target, arc), bagId: 'T', boardBags: board, distanceIn: 324, seed, wobble: 0 });
}

describe('cornhole cues (game-show sound + LED flash)', () => {
  it('a bag dropping in fires the ring-in sound and LED flash at the exact moment it drops', () => {
    const sim = throwAt({ x: 0, y: BOARD.holeCenterYIn }, 1);
    const cues = cuesForThrow(sim, ctx('A'));
    const hit = cues.find((c) => c.sound === 'cornhole_hit')!;
    expect(hit).toBeDefined();
    expect(hit.atMs).toBe(sim.holeEvents[0]!.tMs);
    expect(hit.reason).toBe('hole');
    expect(hit.led).toEqual({
      pattern: 'flash_burst',
      durationMs: LED_BOARD.cornhole.durationMs,
      boardEnd: 1,
      colors: ['#FFFFFF', '#1D4ED8'],
    });
  });

  it("the flash uses the SCORING team's colour, not the thrower's", () => {
    const sim = throwAt({ x: 0, y: BOARD.holeCenterYIn }, 1);
    expect(cuesForThrow(sim, ctx('B')).find((c) => c.led)!.led!.colors).toEqual(['#FFFFFF', '#E0218A']);
  });

  it('the cue follows the bag: a direct drop fires at touchdown, a slide-in fires after the slide', () => {
    const direct = throwAt({ x: 0, y: BOARD.holeCenterYIn }, 1);
    const slid = throwAt({ x: 0, y: BOARD.holeCenterYIn }, 0);
    const d = cuesForThrow(direct, ctx()).find((c) => c.sound === 'cornhole_hit')!;
    const s = cuesForThrow(slid, ctx()).find((c) => c.sound === 'cornhole_hit')!;
    expect(d.atMs).toBe(direct.flightMs);
    expect(s.atMs).toBeGreaterThan(slid.flightMs); // still sliding when it lands on the board
    expect(s.atMs).toBe(slid.holeEvents[0]!.tMs);
  });

  it('a bag knocked in by a later throw also flashes, at the knock-in moment', () => {
    const sim = throwAt({ x: 0, y: 32 }, 0, [{ id: 'B', x: 0, y: 36 }]);
    expect(sim.updates.B).toBe('hole');
    const flashes = cuesForThrow(sim, { ...ctx(), teamOfBag: (id) => (id === 'B' ? 'B' : 'A') }).filter((c) => c.led);
    expect(flashes).toHaveLength(1);
    expect(flashes[0]!.bagId).toBe('B');
    expect(flashes[0]!.led!.colors[1]).toBe('#E0218A');
  });

  it('a bag that stays on the board only thuds; the lights do not flash', () => {
    const sim = throwAt({ x: 0, y: 15 }, 1);
    const cues = cuesForThrow(sim, ctx());
    expect(cues).toEqual([{ atMs: sim.flightMs, reason: 'landing', bagId: 'T', sound: 'bag_thud' }]);
  });

  it('a bag that misses the board thuds on the grass; no flash', () => {
    const sim = simulateThrow({ gesture: { power: 0.05, aim: 0, arc: 0.5, spin: 0 }, bagId: 'T', boardBags: [], distanceIn: 324, seed: 1, wobble: 0 });
    const cues = cuesForThrow(sim, ctx());
    expect(cues).toEqual([{ atMs: sim.flightMs, reason: 'foul', bagId: 'T', sound: 'ground_thud' }]);
  });

  it('cues are in time order and every referenced sound exists in the catalog', () => {
    for (let seed = 0; seed < 200; seed++) {
      const sim = simulateThrow({
        gesture: { power: 0.4 + (seed % 10) * 0.03, aim: ((seed % 7) - 3) * 0.05, arc: (seed % 5) / 4, spin: 0 },
        bagId: 'T',
        boardBags: [{ id: 'B', x: 0, y: 34 }],
        distanceIn: 324,
        seed,
      });
      const cues = cuesForThrow(sim, ctx());
      for (let i = 1; i < cues.length; i++) expect(cues[i]!.atMs).toBeGreaterThanOrEqual(cues[i - 1]!.atMs);
      for (const c of cues) if (c.sound) expect(SOUNDS.some((s) => s.id === c.sound)).toBe(true);
    }
  });
});

describe('score and victory cues', () => {
  it('score pulse uses the team colour on the board that was thrown at', () => {
    expect(scoreCue(1, '#1D4ED8')).toEqual({ pattern: 'score_pulse', durationMs: 1200, boardEnd: 1, colors: ['#1D4ED8'] });
  });
  it('victory chase alternates the winning team colour with white', () => {
    expect(victoryCue(0, '#E0218A')).toMatchObject({ pattern: 'victory', boardEnd: 0, colors: ['#E0218A', '#FFFFFF'] });
  });
});

describe('LED board layout', () => {
  it('has both side rails, a front edge and a hole ring; running lights are cyan', () => {
    expect(LED_BOARD.strips.map((s) => s.place).sort()).toEqual(['front-edge', 'hole-ring', 'left-side', 'right-side']);
    expect(LED_BOARD.idle.color).toBe('#00E5FF');
    expect(LED_BOARD.strips.find((s) => s.id === 'rail-left')!.leds).toBe(LED_BOARD.strips.find((s) => s.id === 'rail-right')!.leds);
  });
  it('the cornhole flash is a fast strobe long enough to notice', () => {
    expect(LED_BOARD.cornhole.flashRateHz).toBeGreaterThanOrEqual(6);
    expect(LED_BOARD.cornhole.durationMs).toBeGreaterThanOrEqual(1200);
  });
});
