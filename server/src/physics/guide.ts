import { BOARD } from '../core/constants.js';
import {
  MAX_SHAKE,
  MIN_FLICK_SPEED,
  PUSH_IN_PER_DEG,
  SHAKE_PER_MS,
  SHORT_IN_PER_SPEED,
  STEADY_HOLD_MS,
  STRAIGHT_DEG,
} from './release.js';
import { AIM_TO_X, POWER_MAX_Y, POWER_MIN_Y, slideDistance } from './throwSim.js';
import { ALONG_IN_PER_MPH, CROSS_IN_PER_MPH, WIND_PRESETS, airtimeFactor } from './wind.js';

/** The three shots on the shot picker, as arcs. The phone may also allow anything in between. */
export const SHOTS = [
  { id: 'slide', name: 'Slider', arc: 0.25, note: 'Low and flat. Lands short and slides up. Least bothered by wind.' },
  { id: 'standard', name: 'Standard', arc: 0.55, note: 'The everyday toss. Lands mid-board and slides a little.' },
  { id: 'airmail', name: 'Airmail', arc: 0.9, note: 'High lob that sticks where it lands. Hangs in the air, so the wind moves it most.' },
] as const;

/**
 * Everything the phone needs so its aim line, landing ring and "hole marks" match the server's
 * physics exactly. Served in GET /api/meta as `throwing`.
 */
export const THROWING_GUIDE = {
  gesture: {
    /** aim -1..1; landing x (inches from the centre line) = aim * aimToX. */
    aimToX: AIM_TO_X,
    /** power 0..1; calm landing y (inches from the board's front edge) = powerMinY + (powerMaxY - powerMinY) * power. */
    powerMinY: POWER_MIN_Y,
    powerMaxY: POWER_MAX_Y,
  },
  shots: SHOTS.map((s) => ({ ...s, slideIn: Math.round(slideDistance(s.arc) * 10) / 10 })),
  /** One "hole mark" on the landing ring = the hole's width. */
  holeMarkIn: BOARD.holeRadiusIn * 2,
  wind: {
    crossInPerMph: CROSS_IN_PER_MPH,
    alongInPerMph: ALONG_IN_PER_MPH,
    /** drift = mph * inPerMph * (airtimeBase + airtimeSlope * arc) */
    airtimeBase: airtimeFactor(0),
    airtimeSlope: airtimeFactor(1) - airtimeFactor(0),
    presets: WIND_PRESETS,
    /**
     * The rule of thumb for the tutorial: how many hole-widths to aim off for 10 mph of pure crosswind.
     */
    holeMarksPer10MphCross: Object.fromEntries(
      SHOTS.map((s) => [s.id, Math.round(((10 * CROSS_IN_PER_MPH * airtimeFactor(s.arc)) / (BOARD.holeRadiusIn * 2)) * 10) / 10]),
    ),
  },
  release: {
    straightDeg: STRAIGHT_DEG,
    pushInPerDeg: PUSH_IN_PER_DEG,
    minFlickSpeed: MIN_FLICK_SPEED,
    shortInPerSpeed: SHORT_IN_PER_SPEED,
    steadyHoldMs: STEADY_HOLD_MS,
    shakePerMs: SHAKE_PER_MS,
    maxShake: MAX_SHAKE,
  },
} as const;
