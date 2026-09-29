import { z } from 'zod';
import { AIM_TO_X, POWER_MAX_Y, POWER_MIN_Y, type ThrowGesture } from './throwSim.js';

/**
 * How the player let go of the bag, as the phone measured the flick. The phone does not decide what
 * a crooked flick means: the server does, so every phone plays the same and the feel can be tuned
 * without an app update.
 *
 * Line up (aim) and pull back (power) set where the bag SHOULD go. The release decides how well you
 * actually threw it:
 *
 * - a flick that leans left or right of straight up pushes or pulls the bag that way
 * - a lazy, slow flick comes up short ("short-armed it")
 * - holding the pull too long makes the arm shaky, so the throw scatters more
 * - bending the flick puts spin on the bag, which drifts it sideways as it slides
 */
export interface ReleaseInput {
  /** Degrees the flick leaned from straight up the screen. Negative = left, positive = right. */
  angleDeg: number;
  /** Flick speed in screen heights per second. */
  speed: number;
  /** How long the bag was held pulled back before the flick, in milliseconds. */
  holdMs: number;
  /** How much the flick bent: -1 (hard curl left) to 1 (hard curl right). */
  curve: number;
}

export const releaseSchema = z
  .object({
    angleDeg: z.number().finite().min(-60).max(60),
    speed: z.number().finite().min(0).max(30),
    holdMs: z.number().finite().min(0).max(60_000),
    curve: z.number().finite().min(-1).max(1),
  })
  .strict();

// --- how forgiving the release is ------------------------------------------------------------------
/** A flick within this many degrees of straight counts as straight. Keeps casual play friendly. */
export const STRAIGHT_DEG = 3;
/** Inches the bag is pushed sideways for every degree the flick leans beyond STRAIGHT_DEG. */
export const PUSH_IN_PER_DEG = 0.55;
/** Flicks slower than this (screen heights per second) lose distance. */
export const MIN_FLICK_SPEED = 1.5;
/** Inches short for each unit of speed below MIN_FLICK_SPEED. */
export const SHORT_IN_PER_SPEED = 9;
/** Holding the pull longer than this starts to make the arm shake. */
export const STEADY_HOLD_MS = 2500;
/** Every this many extra milliseconds adds 1x to the natural scatter, up to MAX_SHAKE. */
export const SHAKE_PER_MS = 4000;
export const MAX_SHAKE = 2.5;

export interface ReleaseEffect {
  /** Inches the release moved the bag sideways (positive = to the thrower's right). */
  pushIn: number;
  /** Inches the release took off the distance (0 or negative). */
  shortIn: number;
  /** Multiplier on the natural scatter (1 = steady). */
  shake: number;
  /** Spin the bag got from the flick's bend. */
  spin: number;
  /** A short word for the results screen. */
  verdict: 'pure' | 'pushed' | 'pulled' | 'short-armed' | 'shaky';
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round1 = (v: number): number => Math.round(v * 10) / 10 || 0; // `|| 0` turns -0 into 0

export function releaseEffect(r: ReleaseInput): ReleaseEffect {
  const lean = Math.sign(r.angleDeg) * Math.max(0, Math.abs(r.angleDeg) - STRAIGHT_DEG);
  const pushIn = round1(lean * PUSH_IN_PER_DEG);
  const shortIn = round1(-Math.max(0, MIN_FLICK_SPEED - r.speed) * SHORT_IN_PER_SPEED);
  const shake = round1(Math.min(MAX_SHAKE, 1 + Math.max(0, r.holdMs - STEADY_HOLD_MS) / SHAKE_PER_MS));
  let verdict: ReleaseEffect['verdict'] = 'pure';
  if (shortIn <= -3) verdict = 'short-armed';
  else if (Math.abs(pushIn) >= 2) verdict = pushIn > 0 ? 'pushed' : 'pulled';
  else if (shake >= 1.5) verdict = 'shaky';
  return { pushIn, shortIn, shake, spin: clamp(r.curve, -1, 1), verdict };
}

/** Folds the release into the gesture. Returns the gesture the physics should use and the scatter multiplier. */
export function applyRelease(g: ThrowGesture, r: ReleaseInput): { gesture: ThrowGesture; wobble: number; effect: ReleaseEffect } {
  const effect = releaseEffect(r);
  const gesture: ThrowGesture = {
    ...g,
    aim: clamp(g.aim + effect.pushIn / AIM_TO_X, -1, 1),
    power: clamp(g.power + effect.shortIn / (POWER_MAX_Y - POWER_MIN_Y), 0, 1),
    spin: effect.spin,
  };
  return { gesture, wobble: effect.shake, effect };
}
