import { BAG, BOARD } from '../core/constants.js';
import { createRng, gaussian } from '../core/rng.js';
import type { BagStatus, FoulReason } from '../core/types.js';

/**
 * Server-authoritative bag physics.
 *
 * Board frame (inches): x is lateral (0 = centre line, +right), y runs from the FRONT edge of the
 * board (y = 0) to the back edge (y = 48). The hole is at (0, 39). The thrower stands at
 * y = -distanceIn (the other board's front edge) and throws toward +y.
 *
 * The phone only ever sends a gesture. The server turns it into a landing point (plus a little
 * wobble), then simulates the slide and any bag-on-bag collisions. Results are deterministic for a
 * given seed so every client replays the same landing.
 */

export interface ThrowGesture {
  /** 0 = far too short, ~0.6 = the hole, 1 = far too long. */
  power: number;
  /** -1..1 lateral aim. +/-0.5 is the board edge. */
  aim: number;
  /** 0 = flat skimmer that slides a long way, 1 = high lob that sticks. */
  arc: number;
  /** -1..1 sideways drift during the slide. */
  spin: number;
  leftHanded?: boolean;
}

export function isValidGesture(g: ThrowGesture): boolean {
  const ok = (v: number, lo: number, hi: number): boolean => Number.isFinite(v) && v >= lo && v <= hi;
  return ok(g.power, 0, 1) && ok(g.aim, -1, 1) && ok(g.arc, 0, 1) && ok(g.spin, -1, 1);
}

export interface BoardBag {
  id: string;
  x: number;
  y: number;
}

export interface ThrowInput {
  gesture: ThrowGesture;
  bagId: string;
  /** Bags currently resting on the target board (not in the hole, not removed). */
  boardBags: readonly BoardBag[];
  distanceIn: number;
  seed: number;
  /** Multiplier on the server's random wobble. 1 = human default, 0 = perfectly repeatable. */
  wobble?: number;
}

export interface FlightSample {
  /** Milliseconds since release. */
  t: number;
  x: number;
  y: number;
  z: number;
}

export interface SlideFrame {
  /** Milliseconds since the bag first touched the board. Only bags that moved appear. */
  t: number;
  bags: Record<string, [x: number, y: number]>;
}

export interface HoleEvent {
  bagId: string;
  /** Milliseconds since release: when the bag drops into the hole. Trigger sound + LEDs here. */
  tMs: number;
  cause: 'direct' | 'slide' | 'knocked';
}

export interface ThrowSimResult {
  bagId: string;
  status: BagStatus;
  foul?: FoulReason;
  /** Status changes for other bags that were already on the board. */
  updates: Record<string, BagStatus>;
  landing: { x: number; y: number };
  /** Resting positions of every bag still on the board (including this one, if it stayed). */
  resting: Record<string, { x: number; y: number }>;
  flight: FlightSample[];
  slide: SlideFrame[];
  holeEvents: HoleEvent[];
  flightMs: number;
  durationMs: number;
}

// --- tuning constants -------------------------------------------------------------------------
export const POWER_MIN_Y = -48;
export const POWER_MAX_Y = 96;
export const AIM_TO_X = 24;
const SLIDE_V_FLAT = 110; // in/s for arc 0
const SLIDE_V_LOB = 20; // in/s for arc 1
/** Friction plus the uphill tilt of the board. */
const DECEL = 200; // in/s^2
const STOP_SPEED = 1.5;
const HOLE_FALL_RADIUS = BOARD.holeRadiusIn - 0.2;
const HOLE_SKIP_SPEED = 85; // a bag sliding faster than this skates over the hole
const RESTITUTION = 0.2;
const DT = 1 / 120;
const FRAME_EVERY = 4; // steps per recorded slide frame (30 Hz)
const MAX_SLIDE_S = 6;
const WOBBLE_X = 1.4;
const WOBBLE_Y = 2.6;
const RELEASE_HEIGHT = 40;

export const slideSpeed = (arc: number): number => SLIDE_V_FLAT + (SLIDE_V_LOB - SLIDE_V_FLAT) * arc;
export const slideDistance = (arc: number): number => slideSpeed(arc) ** 2 / (2 * DECEL);
export const spinAngle = (spin: number): number => spin * 0.1;

/** Where the bag first touches down for a gesture, before wobble. */
export function nominalLanding(g: ThrowGesture): { x: number; y: number } {
  return {
    x: g.aim * AIM_TO_X,
    y: POWER_MIN_Y + (POWER_MAX_Y - POWER_MIN_Y) * g.power,
  };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

interface Body {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean; // still on the board
}

export function boardHeightAt(y: number): number {
  const clamped = Math.min(Math.max(y, 0), BOARD.lengthIn);
  return BOARD.frontHeightIn + ((BOARD.backHeightIn - BOARD.frontHeightIn) * clamped) / BOARD.lengthIn;
}

const onBoard = (x: number, y: number): boolean =>
  Math.abs(x) <= BOARD.widthIn / 2 && y >= 0 && y <= BOARD.lengthIn;

const holeDistance = (x: number, y: number): number => Math.hypot(x, y - BOARD.holeCenterYIn);

export function simulateThrow(input: ThrowInput): ThrowSimResult {
  const { gesture: g, bagId, distanceIn } = input;
  if (!isValidGesture(g)) throw new RangeError('invalid throw gesture');
  const rng = createRng(input.seed);
  const wobble = input.wobble ?? 1;

  const nominal = nominalLanding(g);
  const lx = nominal.x + gaussian(rng) * WOBBLE_X * wobble;
  const ly = nominal.y + gaussian(rng) * WOBBLE_Y * wobble;
  const landing = { x: round2(lx), y: round2(ly) };

  // ---- flight ----
  const flightMs = Math.round((0.55 + 0.45 * g.arc + 0.15 * g.power) * 1000);
  const originX = g.leftHanded ? -28 : 28;
  const originY = -distanceIn;
  const landsOnBoard = onBoard(lx, ly);
  const zLand = landsOnBoard ? boardHeightAt(ly) : 0;
  const peak = 8 + 82 * g.arc;
  const flight: FlightSample[] = [];
  const samples = Math.max(2, Math.round(flightMs / (1000 / 30)));
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    flight.push({
      t: Math.round(u * flightMs),
      x: round2(originX + (lx - originX) * u),
      y: round2(originY + (ly - originY) * u),
      z: round2(RELEASE_HEIGHT * (1 - u) + zLand * u + 4 * peak * u * (1 - u)),
    });
  }

  const base = {
    bagId,
    landing,
    flight,
    flightMs,
  };

  // Missed the board entirely (or hit the ground first): foul, bag removed, nothing else moves.
  if (!landsOnBoard) {
    return {
      ...base,
      status: 'ground',
      foul: 'missed_board',
      updates: {},
      resting: restingOf(input.boardBags.map((b) => ({ id: b.id, x: b.x, y: b.y }))),
      slide: [],
      holeEvents: [],
      durationMs: flightMs,
    };
  }

  // Straight into the hole from the air.
  if (holeDistance(lx, ly) < HOLE_FALL_RADIUS) {
    return {
      ...base,
      status: 'hole',
      updates: {},
      resting: restingOf(input.boardBags.map((b) => ({ id: b.id, x: b.x, y: b.y }))),
      slide: [],
      holeEvents: [{ bagId, tMs: flightMs, cause: 'direct' }],
      durationMs: flightMs,
    };
  }

  // ---- slide ----
  const bodies: Body[] = input.boardBags.map((b) => ({ id: b.id, x: b.x, y: b.y, vx: 0, vy: 0, alive: true }));
  const speed0 = slideSpeed(g.arc) * (1 + Math.max(-2, Math.min(2, gaussian(rng))) * 0.05 * wobble);
  const heading = spinAngle(g.spin);
  const thrown: Body = {
    id: bagId,
    x: lx,
    y: ly,
    vx: Math.sin(heading) * speed0,
    vy: Math.cos(heading) * speed0,
    alive: true,
  };
  bodies.push(thrown);

  const slide: SlideFrame[] = [];
  const holeEvents: HoleEvent[] = [];
  const updates: Record<string, BagStatus> = {};
  let thrownStatus: BagStatus = 'board';
  let thrownFoul: FoulReason | undefined;
  const lastRecorded = new Map<string, [number, number]>(bodies.map((b) => [b.id, [round2(b.x), round2(b.y)]]));

  const record = (tSec: number): void => {
    const moved: Record<string, [number, number]> = {};
    for (const b of bodies) {
      const cur: [number, number] = [round2(b.x), round2(b.y)];
      const prev = lastRecorded.get(b.id);
      if (!prev || prev[0] !== cur[0] || prev[1] !== cur[1]) {
        moved[b.id] = cur;
        lastRecorded.set(b.id, cur);
      }
    }
    if (Object.keys(moved).length > 0) slide.push({ t: Math.round(tSec * 1000), bags: moved });
  };

  const fail = (b: Body, status: 'hole' | 'ground', tSec: number): void => {
    b.alive = false;
    b.vx = b.vy = 0;
    if (status === 'hole') {
      b.x = 0;
      b.y = BOARD.holeCenterYIn;
    }
    if (b.id === bagId) {
      thrownStatus = status;
      if (status === 'ground') thrownFoul = 'missed_board';
    } else {
      updates[b.id] = status;
    }
    if (status === 'hole') {
      holeEvents.push({
        bagId: b.id,
        tMs: flightMs + Math.round(tSec * 1000),
        cause: b.id === bagId ? 'slide' : 'knocked',
      });
    }
  };

  let step = 0;
  const maxSteps = Math.round(MAX_SLIDE_S / DT);
  let tSec = 0;
  for (; step < maxSteps; step++) {
    tSec = step * DT;
    let anyMoving = false;

    for (const b of bodies) {
      if (!b.alive) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) {
        if (sp <= STOP_SPEED) {
          b.vx = b.vy = 0;
        } else {
          const ns = Math.max(0, sp - DECEL * DT);
          b.vx *= ns / sp;
          b.vy *= ns / sp;
          b.x += b.vx * DT;
          b.y += b.vy * DT;
          anyMoving = true;
        }
      }
    }

    // bag-on-bag collisions
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!;
      if (!a.alive) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const c = bodies[j]!;
        if (!c.alive) continue;
        let dx = c.x - a.x;
        let dy = c.y - a.y;
        let d = Math.hypot(dx, dy);
        const minD = BAG.radiusIn * 2;
        if (d >= minD) continue;
        if (d < 1e-6) {
          const sp = Math.hypot(a.vx, a.vy) || 1;
          dx = a.vx / sp;
          dy = a.vy / sp || 1;
          d = 1;
        }
        const nx = dx / d;
        const ny = dy / d;
        const rv = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (rv < 0) {
          const j2 = (-(1 + RESTITUTION) * rv) / 2;
          a.vx -= j2 * nx;
          a.vy -= j2 * ny;
          c.vx += j2 * nx;
          c.vy += j2 * ny;
        }
        const push = (minD - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        c.x += nx * push;
        c.y += ny * push;
        anyMoving = true;
      }
    }

    // hole and edges
    for (const b of bodies) {
      if (!b.alive) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (holeDistance(b.x, b.y) < HOLE_FALL_RADIUS && sp <= HOLE_SKIP_SPEED) {
        fail(b, 'hole', tSec);
        anyMoving = true;
      } else if (!onBoard(b.x, b.y)) {
        fail(b, 'ground', tSec);
        anyMoving = true;
      }
    }

    if (step % FRAME_EVERY === 0) record(tSec);
    if (!anyMoving && !bodies.some((b) => b.alive && (b.vx !== 0 || b.vy !== 0))) break;
  }
  record(tSec);

  const resting: Record<string, { x: number; y: number }> = {};
  for (const b of bodies) if (b.alive) resting[b.id] = { x: round2(b.x), y: round2(b.y) };

  const durationMs = flightMs + Math.round(tSec * 1000);
  const result: ThrowSimResult = {
    ...base,
    status: thrownStatus,
    updates,
    resting,
    slide,
    holeEvents,
    durationMs,
  };
  if (thrownFoul) result.foul = thrownFoul;
  return result;
}

function restingOf(bags: BoardBag[]): Record<string, { x: number; y: number }> {
  return Object.fromEntries(bags.map((b) => [b.id, { x: b.x, y: b.y }]));
}
