import { describe, expect, it } from 'vitest';
import { DISTANCE_IN } from '../src/core/constants.js';
import { createRng } from '../src/core/rng.js';
import { BOT_LEVELS, decideThrow, gestureToward, type BotLevel } from '../src/bots/botPolicy.js';
import { isValidGesture, simulateThrow } from '../src/physics/throwSim.js';

function rates(level: BotLevel, n = 4000) {
  const rng = createRng(7);
  let hole = 0;
  let board = 0;
  let off = 0;
  for (let i = 0; i < n; i++) {
    const d = decideThrow({ level, team: 'A', boardBags: [], bagsLeft: 4, points: { A: 0, B: 0 }, rng });
    const r = simulateThrow({ gesture: d.gesture, bagId: 'T', boardBags: [], distanceIn: DISTANCE_IN.regulation, seed: i });
    if (r.status === 'hole') hole++;
    else if (r.status === 'board') board++;
    else off++;
  }
  return { hole: hole / n, board: board / n, off: off / n };
}

describe('bot skill levels (through the real physics)', () => {
  const rookie = rates('rookie');
  const regular = rates('regular');
  const pro = rates('pro');

  it('hole rate lands in the documented range for each level', () => {
    expect(rookie.hole).toBeGreaterThan(0.05);
    expect(rookie.hole).toBeLessThan(0.14);
    expect(regular.hole).toBeGreaterThan(0.18);
    expect(regular.hole).toBeLessThan(0.3);
    expect(pro.hole).toBeGreaterThan(0.38);
    expect(pro.hole).toBeLessThan(0.54);
  });

  it('better bots make more holes and fewer misses', () => {
    expect(rookie.hole).toBeLessThan(regular.hole);
    expect(regular.hole).toBeLessThan(pro.hole);
    expect(rookie.off).toBeGreaterThan(regular.off);
    expect(regular.off).toBeGreaterThan(pro.off);
  });

  it('rates sum to 1', () => {
    for (const r of [rookie, regular, pro]) expect(r.hole + r.board + r.off).toBeCloseTo(1, 6);
  });
});

describe('bot decisions', () => {
  const noBags = { boardBags: [], points: { A: 0, B: 0 } };

  it('always returns a valid gesture', () => {
    const rng = createRng(1);
    for (const level of BOT_LEVELS) {
      for (let i = 0; i < 500; i++) {
        const d = decideThrow({ level, team: 'B', bagsLeft: 1 + (i % 4), rng, boardBags: [], points: { A: i % 7, B: i % 5 } });
        expect(isValidGesture(d.gesture)).toBe(true);
      }
    }
  });

  it('is deterministic for the same rng seed', () => {
    const a = decideThrow({ level: 'pro', team: 'A', bagsLeft: 3, rng: createRng(5), ...noBags });
    const b = decideThrow({ level: 'pro', team: 'A', bagsLeft: 3, rng: createRng(5), ...noBags });
    expect(a).toEqual(b);
  });

  it('a regular/pro bot that is ahead with few bags left sometimes blocks the hole', () => {
    const rng = createRng(3);
    let blocks = 0;
    for (let i = 0; i < 300; i++) {
      const d = decideThrow({ level: 'pro', team: 'A', bagsLeft: 1, rng, boardBags: [], points: { A: 7, B: 1 } });
      if (d.intent === 'block') blocks++;
    }
    expect(blocks).toBeGreaterThan(100);
    expect(blocks).toBeLessThan(260);
  });

  it('a rookie never blocks, and nobody blocks when behind or when the hole is already covered', () => {
    const rng = createRng(4);
    for (let i = 0; i < 300; i++) {
      expect(decideThrow({ level: 'rookie', team: 'A', bagsLeft: 1, rng, boardBags: [], points: { A: 9, B: 0 } }).intent).not.toBe('block');
      expect(decideThrow({ level: 'pro', team: 'A', bagsLeft: 1, rng, boardBags: [], points: { A: 0, B: 5 } }).intent).not.toBe('block');
      expect(
        decideThrow({ level: 'pro', team: 'A', bagsLeft: 1, rng, boardBags: [{ id: 'x', team: 'B', x: 0, y: 36 }], points: { A: 7, B: 0 } }).intent,
      ).not.toBe('block');
    }
  });

  it('gestureToward compensates for the slide so a flat throw comes to rest on target', () => {
    for (const arc of [0, 0.3, 0.6, 1]) {
      const r = simulateThrow({
        gesture: gestureToward({ x: 6, y: 40 }, arc),
        bagId: 'T',
        boardBags: [],
        distanceIn: 324,
        seed: 1,
        wobble: 0,
      });
      expect(r.status).toBe('board');
      expect(Math.abs(r.resting.T!.y - 40)).toBeLessThan(2.5);
      expect(Math.abs(r.resting.T!.x - 6)).toBeLessThan(0.6);
    }
  });
});
