import { describe, expect, it } from 'vitest';
import { BOARD } from '../src/core/constants.js';
import { createRng } from '../src/core/rng.js';
import { decideThrow, gestureToward, type BotLevel } from '../src/bots/botPolicy.js';
import { THROWING_GUIDE } from '../src/physics/guide.js';
import { applyRelease, releaseEffect } from '../src/physics/release.js';
import { simulateThrow, type ThrowGesture } from '../src/physics/throwSim.js';
import { airtimeFactor, gustedWind, relativeWind, rollWind, shiftWind, windDrift, type RelativeWind } from '../src/physics/wind.js';

const HOLE = { x: 0, y: BOARD.holeCenterYIn };
const wind = (cross: number, along = 0): RelativeWind => ({ mph: Math.hypot(cross, along), towardDeg: 0, cross, along });
const land = (g: ThrowGesture, w?: RelativeWind, gustiness = 0, seed = 7) =>
  simulateThrow({ gesture: g, bagId: 'A1-1', boardBags: [], distanceIn: 324, seed, wobble: 0, ...(w ? { wind: w, gustiness } : {}) });

describe('wind as the thrower feels it', () => {
  it('flips when the players swap ends: a tailwind at one end is a headwind at the other', () => {
    const w = { mph: 10, towardDeg: 0, gustiness: 0 };
    expect(relativeWind(w, 0)).toMatchObject({ along: 10, cross: 0 });
    expect(relativeWind(w, 1)).toMatchObject({ along: -10, towardDeg: 180 });
  });
  it('a crosswind that pushes right from one end pushes left from the other', () => {
    const w = { mph: 8, towardDeg: 90, gustiness: 0 };
    expect(relativeWind(w, 0).cross).toBe(8);
    expect(relativeWind(w, 1).cross).toBe(-8);
    expect(relativeWind(w, 0).along).toBeCloseTo(0);
  });
});

describe('how far the wind moves a bag', () => {
  it('moves a standard toss about one hole-width in 10 mph of crosswind', () => {
    const d = windDrift(0.55, wind(10));
    expect(d.x / (BOARD.holeRadiusIn * 2)).toBeGreaterThan(0.8);
    expect(d.x / (BOARD.holeRadiusIn * 2)).toBeLessThan(1.2);
  });
  it('moves a high airmail more than a flat slider', () => {
    expect(windDrift(0.9, wind(10)).x).toBeGreaterThan(windDrift(0.25, wind(10)).x * 1.5);
    expect(airtimeFactor(1)).toBeGreaterThan(airtimeFactor(0));
  });
  it('a tailwind carries long and a headwind holds it up short', () => {
    expect(windDrift(0.55, wind(0, 10)).y).toBeGreaterThan(0);
    expect(windDrift(0.55, wind(0, -10)).y).toBeLessThan(0);
  });
  it('is applied in the physics: same gesture, calm vs windy', () => {
    const g = gestureToward(HOLE, 0.9);
    const calm = land(g);
    const windy = land(g, wind(10));
    expect(calm.status).toBe('hole');
    expect(windy.landing.x - calm.landing.x).toBeCloseTo(windDrift(0.9, wind(10)).x, 1);
    expect(windy.wind).toMatchObject({ cross: 10, along: 0 });
    expect(windy.status).not.toBe('hole'); // 10 mph blows a perfect calm-day airmail out of the hole
  });
  it('aiming off into the wind puts it back in', () => {
    const d = windDrift(0.9, wind(10));
    const g = gestureToward({ x: HOLE.x - d.x, y: HOLE.y - d.y }, 0.9);
    expect(land(g, wind(10)).status).toBe('hole');
  });
  it('bends the flight path: the bag drifts more at the end than at the start', () => {
    const r = land(gestureToward(HOLE, 0.9), wind(10));
    const calm = land(gestureToward(HOLE, 0.9));
    const mid = Math.floor(r.flight.length / 2);
    const early = r.flight[mid]!.x - calm.flight[mid]!.x;
    const late = r.flight[r.flight.length - 1]!.x - calm.flight[calm.flight.length - 1]!.x;
    expect(late).toBeGreaterThan(early * 2);
  });
  it('a throw with no wind comes out exactly as it did before wind existed', () => {
    const g = gestureToward(HOLE, 0.5);
    const a = simulateThrow({ gesture: g, bagId: 'x', boardBags: [], distanceIn: 324, seed: 99 });
    const b = simulateThrow({ gesture: g, bagId: 'x', boardBags: [], distanceIn: 324, seed: 99, wind: wind(0), gustiness: 0.3 });
    expect(b.landing).toEqual(a.landing);
    expect(b.resting).toEqual(a.resting);
  });
});

describe('gusts', () => {
  it('make single throws differ from the shown wind, but stay repeatable for a seed', () => {
    const rel = wind(10);
    const seen = new Set<number>();
    for (let s = 1; s <= 30; s++) seen.add(Math.round(gustedWind(rel, 0.3, createRng(s)).cross * 10));
    expect(seen.size).toBeGreaterThan(10);
    expect(gustedWind(rel, 0.3, createRng(5))).toEqual(gustedWind(rel, 0.3, createRng(5)));
  });
  it('average out to the shown wind', () => {
    const rng = createRng(3);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += gustedWind(wind(10), 0.3, rng).cross;
    expect(sum / 4000).toBeGreaterThan(9.3);
    expect(sum / 4000).toBeLessThan(10.3);
  });
  it('do nothing on a steady day', () => {
    expect(gustedWind(wind(6, 2), 0, createRng(1))).toEqual({ cross: 6, along: 2 });
  });
});

describe('match wind settings', () => {
  it('stays inside each setting\'s range and drifts only a little between innings', () => {
    for (const level of ['light', 'breezy', 'gusty'] as const) {
      let w = rollWind(level, 11);
      for (let i = 0; i < 50; i++) {
        const next = shiftWind(w, level, 100 + i);
        const turn = Math.abs(((next.towardDeg - w.towardDeg + 540) % 360) - 180);
        expect(turn).toBeLessThan(120);
        w = next;
        expect(w.mph).toBeGreaterThanOrEqual({ light: 1, breezy: 3, gusty: 8 }[level]);
        expect(w.mph).toBeLessThanOrEqual({ light: 5, breezy: 10, gusty: 16 }[level]);
      }
    }
    expect(rollWind('off', 1).mph).toBe(0);
  });
});

describe('the release (the flick)', () => {
  const clean = { angleDeg: 0, speed: 3, holdMs: 800, curve: 0 };
  it('a clean, brisk, straight flick changes nothing', () => {
    expect(releaseEffect(clean)).toEqual({ pushIn: 0, shortIn: 0, shake: 1, spin: 0, verdict: 'pure' });
    expect(releaseEffect({ ...clean, angleDeg: 2.5 }).pushIn).toBe(0); // within the forgiving zone
  });
  it('a flick leaning right pushes the bag right, leaning left pulls it left', () => {
    expect(releaseEffect({ ...clean, angleDeg: 10 })).toMatchObject({ pushIn: 3.9, verdict: 'pushed' });
    expect(releaseEffect({ ...clean, angleDeg: -10 })).toMatchObject({ pushIn: -3.9, verdict: 'pulled' });
  });
  it('a lazy flick comes up short', () => {
    expect(releaseEffect({ ...clean, speed: 0.5 })).toMatchObject({ shortIn: -9, verdict: 'short-armed' });
  });
  it('holding the pull too long makes the arm shaky', () => {
    expect(releaseEffect({ ...clean, holdMs: 6500 })).toMatchObject({ shake: 2, verdict: 'shaky' });
    expect(releaseEffect({ ...clean, holdMs: 60_000 }).shake).toBe(2.5);
  });
  it('bending the flick puts spin on the bag', () => {
    expect(releaseEffect({ ...clean, curve: -0.6 }).spin).toBe(-0.6);
  });
  it('is folded into the gesture the physics uses', () => {
    const aimed = gestureToward(HOLE, 0.9);
    const straight = applyRelease(aimed, clean);
    expect(straight.gesture).toEqual({ ...aimed, spin: 0 });
    const pushed = applyRelease(aimed, { ...clean, angleDeg: 10 });
    expect(land(pushed.gesture).landing.x).toBeCloseTo(3.9, 1);
    expect(land(straight.gesture).status).toBe('hole');
  });
});

describe('bots read the wind by skill', () => {
  const holeRate = (level: BotLevel, w?: RelativeWind) => {
    const rng = createRng(42);
    let holes = 0;
    const n = 1500;
    for (let i = 0; i < n; i++) {
      const d = decideThrow({ level, team: 'A', boardBags: [], bagsLeft: 4, points: { A: 0, B: 0 }, rng, ...(w ? { wind: { cross: w.cross, along: w.along } } : {}) });
      const r = simulateThrow({ gesture: d.gesture, bagId: 'b', boardBags: [], distanceIn: 324, seed: i + 1, ...(w ? { wind: w, gustiness: 0.15 } : {}) });
      if (r.status === 'hole') holes++;
    }
    return holes / n;
  };
  it('a pro barely notices a 10 mph crosswind; a rookie falls apart', () => {
    const w = wind(10);
    const proCalm = holeRate('pro');
    const proWindy = holeRate('pro', w);
    const rookieCalm = holeRate('rookie');
    const rookieWindy = holeRate('rookie', w);
    expect(proWindy).toBeGreaterThan(proCalm * 0.75);
    expect(rookieWindy).toBeLessThan(rookieCalm * 0.85);
  });
});

describe('the guide the phone draws from', () => {
  it('has the shot picker, the hole-mark rule of thumb and the release numbers', () => {
    expect(THROWING_GUIDE.shots.map((s) => s.id)).toEqual(['slide', 'standard', 'airmail']);
    expect(THROWING_GUIDE.holeMarkIn).toBe(6);
    const marks = THROWING_GUIDE.wind.holeMarksPer10MphCross;
    expect(marks.slide!).toBeLessThan(marks.standard!);
    expect(marks.standard!).toBeLessThan(marks.airmail!);
    expect(THROWING_GUIDE.release.straightDeg).toBe(3);
  });
});
