import { describe, expect, it } from 'vitest';
import { BAG, BOARD, DISTANCE_IN } from '../src/core/constants.js';
import { createRng } from '../src/core/rng.js';
import {
  isValidGesture,
  simulateThrow,
  slideDistance,
  type BoardBag,
  type ThrowGesture,
  type ThrowInput,
} from '../src/physics/throwSim.js';
import { gestureToward } from '../src/bots/botPolicy.js';

const HOLE_Y = BOARD.holeCenterYIn;

function sim(over: Partial<ThrowInput> & { gesture: ThrowGesture }) {
  return simulateThrow({
    bagId: 'T',
    boardBags: [],
    distanceIn: DISTANCE_IN.regulation,
    seed: 1,
    wobble: 0,
    ...over,
  });
}

describe('gesture validation', () => {
  it('accepts in-range numbers and rejects NaN/Infinity/out-of-range', () => {
    expect(isValidGesture({ power: 0.5, aim: 0, arc: 0.5, spin: 0 })).toBe(true);
    expect(isValidGesture({ power: NaN, aim: 0, arc: 0.5, spin: 0 })).toBe(false);
    expect(isValidGesture({ power: 1.01, aim: 0, arc: 0.5, spin: 0 })).toBe(false);
    expect(isValidGesture({ power: 0.5, aim: -1.1, arc: 0.5, spin: 0 })).toBe(false);
    expect(isValidGesture({ power: 0.5, aim: 0, arc: Infinity, spin: 0 })).toBe(false);
  });

  it('simulateThrow throws RangeError on an invalid gesture', () => {
    expect(() => sim({ gesture: { power: 2, aim: 0, arc: 0, spin: 0 } })).toThrow(RangeError);
  });
});

describe('landing outcomes', () => {
  it('a perfect lob into the hole drops in directly, and the hole event is at the end of the flight', () => {
    const r = sim({ gesture: gestureToward({ x: 0, y: HOLE_Y }, 1) });
    expect(r.status).toBe('hole');
    expect(r.holeEvents).toEqual([{ bagId: 'T', tMs: r.flightMs, cause: 'direct' }]);
    expect(r.resting.T).toBeUndefined();
  });

  it('a flat skimmer aimed short of the hole slides in', () => {
    const r = sim({ gesture: gestureToward({ x: 0, y: HOLE_Y }, 0) });
    expect(r.status).toBe('hole');
    expect(r.holeEvents[0]).toMatchObject({ bagId: 'T', cause: 'slide' });
    expect(r.holeEvents[0]!.tMs).toBeGreaterThan(r.flightMs);
  });

  it('a lob to the middle of the board stays on the board', () => {
    const r = sim({ gesture: gestureToward({ x: 0, y: 20 }, 1) });
    expect(r.status).toBe('board');
    expect(r.resting.T!.y).toBeGreaterThan(18);
    expect(r.resting.T!.y).toBeLessThan(23);
  });

  it.each([
    ['too short', { power: 0.1, aim: 0, arc: 0.8, spin: 0 }],
    ['too long', { power: 0.98, aim: 0, arc: 0.8, spin: 0 }],
    ['too far left', { power: 0.5, aim: -0.9, arc: 0.8, spin: 0 }],
    ['too far right', { power: 0.5, aim: 0.9, arc: 0.8, spin: 0 }],
  ])('%s is a foul: bag removed, nothing else moves', (_name, gesture) => {
    const other: BoardBag = { id: 'X', x: 3, y: 20 };
    const r = sim({ gesture, boardBags: [other] });
    expect(r.status).toBe('ground');
    expect(r.foul).toBe('missed_board');
    expect(r.updates).toEqual({});
    expect(r.resting).toEqual({ X: { x: 3, y: 20 } });
    expect(r.durationMs).toBe(r.flightMs);
  });

  it('a bag sliding off the back edge is removed', () => {
    // lands at y = 20, flat, off-centre (so it misses the hole), and slides 30 in: past the 48 in back edge
    const r = sim({ gesture: { power: (20 + 48) / 144, aim: 8 / 24, arc: 0, spin: 0 } });
    expect(r.status).toBe('ground');
    expect(r.foul).toBe('missed_board');
    expect(r.resting.T).toBeUndefined();
  });
});

describe('bag-on-bag physics', () => {
  it('pushes a bag in front of the hole into the hole', () => {
    const blocker: BoardBag = { id: 'B', x: 0, y: 36 };
    const r = sim({
      gesture: gestureToward({ x: 0, y: 32 }, 0), // slides ~30in starting at y≈2 → hits blocker
      boardBags: [blocker],
    });
    expect(r.updates.B).toBe('hole');
    expect(r.holeEvents.find((e) => e.bagId === 'B')).toMatchObject({ cause: 'knocked' });
    expect(r.status).toBe('board');
  });

  it('knocks a bag off the back edge', () => {
    const r = sim({
      gesture: { power: (28 + 48) / 144, aim: 0, arc: 0, spin: 0 },
      boardBags: [{ id: 'B', x: 0, y: 46 }],
    });
    expect(r.updates.B).toBe('ground');
    expect(r.resting.B).toBeUndefined();
  });

  it('a lob landing beside a bag does not move it', () => {
    const r = sim({
      gesture: gestureToward({ x: 8, y: 15 }, 1),
      boardBags: [{ id: 'B', x: -8, y: 15 }],
    });
    expect(r.updates).toEqual({});
    expect(r.resting.B).toEqual({ x: -8, y: 15 });
  });

  it('a bag in the hole cannot be hit: it is not part of the board bags', () => {
    const r = sim({ gesture: gestureToward({ x: 0, y: 20 }, 1), boardBags: [] });
    expect(Object.keys(r.updates)).toHaveLength(0);
  });
});

describe('determinism and safety', () => {
  const g: ThrowGesture = { power: 0.58, aim: 0.02, arc: 0.7, spin: 0.1 };

  it('same seed and inputs give an identical result', () => {
    const a = simulateThrow({ gesture: g, bagId: 'T', boardBags: [{ id: 'B', x: 2, y: 30 }], distanceIn: 324, seed: 99 });
    const b = simulateThrow({ gesture: g, bagId: 'T', boardBags: [{ id: 'B', x: 2, y: 30 }], distanceIn: 324, seed: 99 });
    expect(a).toEqual(b);
  });

  it('different seeds give different wobble', () => {
    const landings = new Set<number>();
    for (let s = 0; s < 20; s++) {
      landings.add(simulateThrow({ gesture: g, bagId: 'T', boardBags: [], distanceIn: 324, seed: s }).landing.y);
    }
    expect(landings.size).toBeGreaterThan(15);
  });

  it('wobble 0 is perfectly repeatable across seeds', () => {
    const a = sim({ gesture: g, seed: 1 });
    const b = sim({ gesture: g, seed: 2 });
    expect(a.landing).toEqual(b.landing);
  });

  it('flight starts at the release point, ends at the landing, and stays above the ground', () => {
    const r = sim({ gesture: g });
    const first = r.flight[0]!;
    const last = r.flight.at(-1)!;
    expect(first.t).toBe(0);
    expect(first.y).toBe(-DISTANCE_IN.regulation);
    expect(last.t).toBe(r.flightMs);
    expect(last.x).toBeCloseTo(r.landing.x, 1);
    expect(last.y).toBeCloseTo(r.landing.y, 1);
    expect(r.flight.every((p) => p.z >= 0)).toBe(true);
    expect(Math.max(...r.flight.map((p) => p.z))).toBeGreaterThan(40);
  });

  it('backyard distance only changes where the flight starts', () => {
    const reg = sim({ gesture: g, distanceIn: DISTANCE_IN.regulation });
    const yard = sim({ gesture: g, distanceIn: DISTANCE_IN.backyard });
    expect(yard.landing).toEqual(reg.landing);
    expect(yard.flight[0]!.y).toBe(-DISTANCE_IN.backyard);
  });

  it('left-handed throws start on the other side', () => {
    const r = sim({ gesture: { ...g, leftHanded: true } });
    const rr = sim({ gesture: g });
    expect(Math.sign(r.flight[0]!.x)).toBe(-Math.sign(rr.flight[0]!.x));
  });

  it('slide distance shrinks as arc grows', () => {
    expect(slideDistance(0)).toBeGreaterThan(slideDistance(0.5));
    expect(slideDistance(0.5)).toBeGreaterThan(slideDistance(1));
    expect(slideDistance(1)).toBeLessThan(2);
  });

  it('5000 random throws onto random boards: invariants hold', () => {
    const rng = createRng(2024);
    let worstGap = Infinity;
    for (let n = 0; n < 5000; n++) {
      const count = Math.floor(rng() * 8);
      const bagsOnBoard: BoardBag[] = [];
      for (let i = 0; i < count; i++) {
        // place without overlap
        for (let attempt = 0; attempt < 20; attempt++) {
          const c = { id: `b${i}`, x: (rng() - 0.5) * 20, y: 3 + rng() * 42 };
          const inHole = Math.hypot(c.x, c.y - HOLE_Y) < 4;
          if (!inHole && bagsOnBoard.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= BAG.radiusIn * 2)) {
            bagsOnBoard.push(c);
            break;
          }
        }
      }
      const gesture: ThrowGesture = {
        power: 0.2 + rng() * 0.7,
        aim: (rng() - 0.5) * 1.2,
        arc: rng(),
        spin: (rng() - 0.5) * 2,
      };
      const r = simulateThrow({ gesture, bagId: 'T', boardBags: bagsOnBoard, distanceIn: 324, seed: n });

      // duration bounded
      expect(r.durationMs).toBeLessThanOrEqual(r.flightMs + 6100);
      // updates only reference bags that were on the board
      for (const id of Object.keys(r.updates)) expect(bagsOnBoard.some((b) => b.id === id)).toBe(true);
      // resting membership matches statuses
      const expectedResting = new Set(bagsOnBoard.filter((b) => !r.updates[b.id]).map((b) => b.id));
      if (r.status === 'board') expectedResting.add('T');
      expect(new Set(Object.keys(r.resting))).toEqual(expectedResting);
      // everything resting is on the board and nothing overlaps badly
      const rest = Object.entries(r.resting);
      for (const [, p] of rest) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(BOARD.widthIn / 2 + 0.01);
        expect(p.y).toBeGreaterThanOrEqual(-0.01);
        expect(p.y).toBeLessThanOrEqual(BOARD.lengthIn + 0.01);
      }
      let minGap = Infinity;
      for (let i = 0; i < rest.length; i++)
        for (let j = i + 1; j < rest.length; j++) {
          const a = rest[i]![1];
          const b = rest[j]![1];
          minGap = Math.min(minGap, Math.hypot(a.x - b.x, a.y - b.y));
        }
      worstGap = Math.min(worstGap, minGap);
      // ground foul has a reason; hole has none
      if (r.status === 'ground') expect(r.foul).toBe('missed_board');
      else expect(r.foul).toBeUndefined();
      // every hole event belongs to a bag that ended in the hole
      for (const e of r.holeEvents) {
        const inHole = e.bagId === 'T' ? r.status === 'hole' : r.updates[e.bagId] === 'hole';
        expect(inHole).toBe(true);
        expect(e.tMs).toBeGreaterThanOrEqual(r.flightMs);
      }
      // slide frames are in time order
      for (let i = 1; i < r.slide.length; i++) expect(r.slide[i]!.t).toBeGreaterThanOrEqual(r.slide[i - 1]!.t);
    }
    // bags are 6 in wide; after collision resolution they may squash a little but never stack
    expect(worstGap).toBeGreaterThan(5);
  });
});
