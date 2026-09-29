import { BOARD } from '../core/constants.js';
import { gaussian, type Rng } from '../core/rng.js';
import type { TeamId } from '../core/types.js';
import {
  AIM_TO_X,
  POWER_MAX_Y,
  POWER_MIN_Y,
  slideDistance,
  type ThrowGesture,
} from '../physics/throwSim.js';
import { windDrift, type RelativeWind } from '../physics/wind.js';

export type BotLevel = 'rookie' | 'regular' | 'pro';
export const BOT_LEVELS: readonly BotLevel[] = ['rookie', 'regular', 'pro'];

/** Standard deviation of the bot's aiming error, in inches of landing position (before server wobble). */
export const BOT_ERROR_IN: Record<BotLevel, { x: number; y: number }> = {
  rookie: { x: 5.5, y: 10.0 },
  regular: { x: 3.3, y: 6.0 },
  pro: { x: 2.0, y: 3.6 },
};

/** Chance of a wild throw (aiming error multiplied by SLIP_FACTOR). Real players are steady, then sometimes not. */
export const BOT_SLIP_CHANCE: Record<BotLevel, number> = { rookie: 0.22, regular: 0.1, pro: 0.04 };
const SLIP_FACTOR = 3;

/** How well each level reads the wind: the share of the drift it aims off for. */
export const BOT_WIND_READ: Record<BotLevel, number> = { rookie: 0.3, regular: 0.75, pro: 0.95 };

export interface BotBagView {
  id: string;
  team: TeamId;
  x: number;
  y: number;
}

export interface BotContext {
  level: BotLevel;
  team: TeamId;
  /** Bags on the target board that are still in play (not in the hole). */
  boardBags: readonly BotBagView[];
  /** How many bags this team still has to throw this inning, counting the one about to be thrown. */
  bagsLeft: number;
  /** Points each team would score if the inning ended now (raw, before cancellation). */
  points: Record<TeamId, number>;
  rng: Rng;
  /** The wind as this bot feels it. Omit for calm. */
  wind?: Pick<RelativeWind, 'cross' | 'along'>;
}

export type BotIntent = 'hole' | 'slide-hole' | 'block';

export interface BotDecision {
  gesture: ThrowGesture;
  intent: BotIntent;
  target: { x: number; y: number };
}

const HOLE: { x: number; y: number } = { x: 0, y: BOARD.holeCenterYIn };
const BLOCK: { x: number; y: number } = { x: 0, y: 30.5 };

/** A perfect gesture that lands (or slides to rest) at `target` with the given arc. */
export function gestureToward(target: { x: number; y: number }, arc: number): ThrowGesture {
  const slide = slideDistance(arc);
  const landY = target.y - slide;
  const power = (landY - POWER_MIN_Y) / (POWER_MAX_Y - POWER_MIN_Y);
  const aim = target.x / AIM_TO_X;
  return { power: clamp01(power), aim: clamp(aim, -1, 1), arc, spin: 0 };
}

/** Decide what to throw. Uses the same gesture format a human sends, plus skill-based aiming error. */
export function decideThrow(ctx: BotContext): BotDecision {
  const { level, rng } = ctx;
  const ahead = ctx.points[ctx.team] - ctx.points[ctx.team === 'A' ? 'B' : 'A'];
  const holeCovered = ctx.boardBags.some((b) => Math.hypot(b.x - HOLE.x, b.y - HOLE.y) < 6.5);

  let intent: BotIntent = 'hole';
  let target = HOLE;
  let arc = 0.85;

  if (level !== 'rookie' && ahead >= 3 && ctx.bagsLeft <= 2 && !holeCovered && rng() < 0.6) {
    intent = 'block';
    target = BLOCK;
    arc = 0.95;
  } else if (level === 'pro' && rng() < 0.5) {
    intent = 'slide-hole';
    arc = 0.35 + rng() * 0.15;
  } else if (level === 'regular' && rng() < 0.25) {
    intent = 'slide-hole';
    arc = 0.4 + rng() * 0.1;
  }

  // Aim off into the wind, as much as this bot understands it.
  const drift = ctx.wind ? windDrift(arc, ctx.wind) : { x: 0, y: 0 };
  const read = BOT_WIND_READ[level];
  const perfect = gestureToward({ x: target.x - drift.x * read, y: target.y - drift.y * read }, arc);
  const base = BOT_ERROR_IN[level];
  const k = rng() < BOT_SLIP_CHANCE[level] ? SLIP_FACTOR : 1;
  const err = { x: base.x * k, y: base.y * k };
  const gesture: ThrowGesture = {
    power: clamp01(perfect.power + (gaussian(rng) * err.y) / (POWER_MAX_Y - POWER_MIN_Y)),
    aim: clamp(perfect.aim + (gaussian(rng) * err.x) / AIM_TO_X, -1, 1),
    arc: perfect.arc,
    spin: 0,
  };
  return { gesture, intent, target };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);
