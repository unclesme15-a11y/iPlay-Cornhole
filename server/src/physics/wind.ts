import { createRng, gaussian, type Rng } from '../core/rng.js';
import type { WindSetting } from '../core/types.js';

/**
 * Wind for an outdoor cookout.
 *
 * The wind belongs to the field, not the player. `towardDeg` is the way it blows, measured from the
 * point of view of someone standing at end 0 looking at end 1: 0 = straight down the pitch toward
 * end 1, 90 = to their right, 180 = back into their face, 270 = to their left.
 *
 * Because players swap ends, the same wind is a tailwind for one end and a headwind for the other,
 * and a right-to-left crosswind becomes left-to-right. That is how it works in a real backyard,
 * and it keeps things fair: both teams throw into the same conditions from the same end.
 */
export interface Wind {
  mph: number;
  towardDeg: number;
  /** How much single throws can differ from the shown wind (0 = steady, 0.35 = very gusty). */
  gustiness: number;
}

export type WindLevel = WindSetting;
export const WIND_LEVELS: readonly WindLevel[] = ['off', 'light', 'breezy', 'gusty'];

/** Speed range (mph) and gustiness for each setting on the Match Setup screen. */
export const WIND_PRESETS: Record<WindLevel, { min: number; max: number; gustiness: number }> = {
  off: { min: 0, max: 0, gustiness: 0 },
  light: { min: 1, max: 5, gustiness: 0.1 },
  breezy: { min: 3, max: 10, gustiness: 0.15 },
  gusty: { min: 8, max: 16, gustiness: 0.3 },
};

export const CALM: Wind = { mph: 0, towardDeg: 0, gustiness: 0 };

/** The wind as the thrower feels it. */
export interface RelativeWind {
  mph: number;
  /** Which way it blows as seen by the thrower: 0 = toward the board (helping), 90 = to their right, 180 = in their face. */
  towardDeg: number;
  /** mph pushing the bag to the thrower's right (negative = to the left). */
  cross: number;
  /** mph carrying the bag further (negative = holding it up short). */
  along: number;
}

// --- how much the wind moves a bag -------------------------------------------------------------
/** Inches a 1 mph crosswind moves a bag sideways on a standard (arc 0.5) throw. */
export const CROSS_IN_PER_MPH = 0.6;
/** Inches a 1 mph tailwind adds to the distance (a headwind takes it away) on a standard throw. */
export const ALONG_IN_PER_MPH = 0.35;

/**
 * Longer in the air, more wind. A flat slider spends little time in the air; a high airmail lob
 * hangs up there and gets pushed around the most.
 */
export const airtimeFactor = (arc: number): number => 0.5 + 0.8 * arc;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const norm = (deg: number): number => ((deg % 360) + 360) % 360;

/** The wind from the point of view of someone throwing from `fromEnd`. */
export function relativeWind(wind: Wind, fromEnd: 0 | 1): RelativeWind {
  const toward = norm(wind.towardDeg + (fromEnd === 1 ? 180 : 0));
  const rad = (toward * Math.PI) / 180;
  return {
    mph: round1(wind.mph),
    towardDeg: Math.round(toward),
    cross: round1(wind.mph * Math.sin(rad)),
    along: round1(wind.mph * Math.cos(rad)),
  };
}

/** Inches the wind moves the landing spot: `x` to the thrower's right, `y` further down the board. */
export function windDrift(arc: number, rel: Pick<RelativeWind, 'cross' | 'along'>): { x: number; y: number } {
  const f = airtimeFactor(arc);
  return { x: rel.cross * CROSS_IN_PER_MPH * f, y: rel.along * ALONG_IN_PER_MPH * f };
}

/** A throw feels the shown wind plus a gust. Deterministic for the throw's random stream. */
export function gustedWind(rel: RelativeWind, gustiness: number, rng: Rng): { cross: number; along: number } {
  if (gustiness <= 0 || rel.mph === 0) return { cross: rel.cross, along: rel.along };
  const speed = Math.max(0, 1 + Math.max(-2.5, Math.min(2.5, gaussian(rng))) * gustiness);
  const swing = Math.max(-2.5, Math.min(2.5, gaussian(rng))) * gustiness * 0.35; // radians of direction wobble
  const cos = Math.cos(swing);
  const sin = Math.sin(swing);
  return {
    cross: (rel.cross * cos + rel.along * sin) * speed,
    along: (rel.along * cos - rel.cross * sin) * speed,
  };
}

/** Fresh wind for the start of a match. */
export function rollWind(level: WindLevel, seed: number): Wind {
  const p = WIND_PRESETS[level];
  if (level === 'off') return { ...CALM };
  const rng = createRng(seed);
  return {
    mph: round1(p.min + (p.max - p.min) * rng()),
    towardDeg: Math.round(rng() * 360) % 360,
    gustiness: p.gustiness,
  };
}

/** The wind drifts a little between innings: the direction swings a bit, the speed rises or falls. */
export function shiftWind(prev: Wind, level: WindLevel, seed: number): Wind {
  if (level === 'off') return { ...CALM };
  const p = WIND_PRESETS[level];
  const rng = createRng(seed);
  const mph = Math.min(p.max, Math.max(p.min, prev.mph + gaussian(rng) * 1.5));
  return { mph: round1(mph), towardDeg: norm(Math.round(prev.towardDeg + gaussian(rng) * 25)), gustiness: p.gustiness };
}
