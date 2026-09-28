import type { TeamId } from '../core/types.js';
import type { ThrowSimResult } from '../physics/throwSim.js';

/**
 * The custom iPlay LED board and its sounds, as data. The client draws the lights and plays the
 * sounds; the server decides WHEN (a bag drops into the hole at an exact millisecond) and sends a
 * cue for it. Everything here is exported to assets/board/led-board.json for the Unity client.
 */

export const IPLAY_CYAN = '#00E5FF';

export interface LedStrip {
  id: string;
  kind: 'rail' | 'edge' | 'ring';
  /** LEDs on the strip (60 LEDs/metre addressable strip). */
  leds: number;
  /** Where the strip runs on the board, for the client's layout. */
  place: 'left-side' | 'right-side' | 'front-edge' | 'hole-ring';
  /** Direction the idle chase travels along this strip. */
  chase: 'front-to-back' | 'back-to-front' | 'clockwise';
}

export const LED_BOARD = {
  /** Board is 24 x 48 in; 48 in = 1.22 m => 73 LEDs on each side rail at 60/m. */
  strips: [
    { id: 'rail-left', kind: 'rail', leds: 73, place: 'left-side', chase: 'front-to-back' },
    { id: 'rail-right', kind: 'rail', leds: 73, place: 'right-side', chase: 'front-to-back' },
    { id: 'front-edge', kind: 'edge', leds: 37, place: 'front-edge', chase: 'clockwise' },
    { id: 'hole-ring', kind: 'ring', leds: 24, place: 'hole-ring', chase: 'clockwise' },
  ] satisfies LedStrip[],
  idle: {
    pattern: 'chase',
    color: IPLAY_CYAN,
    /** Lit LEDs travelling down both side rails. */
    tailLength: 9,
    speedLedsPerSec: 38,
    brightness: 0.55,
  },
  /** Plays the instant a bag drops into the hole. Doubles as the "ring-in" flash. */
  cornhole: {
    pattern: 'flash_burst',
    durationMs: 1800,
    /**
     * Full on/off cycles per second. Kept at 3 or below: strobing faster than three flashes a second
     * can trigger seizures in people with photosensitive epilepsy (WCAG 2.3.1).
     */
    flashRateHz: 3,
    /** Alternates between these; 'team' is replaced with the scoring team's bag colour. */
    colors: ['#FFFFFF', 'team'],
    holeRing: { pattern: 'pulse', color: '#FFC400', rateHz: 1 },
    brightness: 1,
    /** For players who turn on "reduce motion" or "reduce flashing": one soft glow, no strobe. */
    reducedMotion: { pattern: 'steady_glow', durationMs: 1800, pulseHz: 0.5, color: 'team' },
  },
  scorePulse: { pattern: 'pulse', durationMs: 1200, colors: ['team'], brightness: 0.9 },
  victory: { pattern: 'chase_burst', durationMs: 4000, colors: ['team', '#FFFFFF'], speedLedsPerSec: 140 },
} as const;

export type SoundId = 'cornhole_hit' | 'bag_thud' | 'ground_thud';

export interface SoundInfo {
  id: SoundId;
  file: string;
  description: string;
}

export const SOUNDS: readonly SoundInfo[] = [
  {
    id: 'cornhole_hit',
    file: 'assets/audio/cornhole-hit.wav',
    description: 'Game-show ring-in: buzzer punch into a bright two-note bell. Plays when a bag goes in the hole.',
  },
  { id: 'bag_thud', file: 'assets/audio/bag-thud.wav', description: 'Bag landing on the board.' },
  { id: 'ground_thud', file: 'assets/audio/ground-thud.wav', description: 'Bag hitting the grass (foul).' },
];

export type LedPattern = 'flash_burst' | 'score_pulse' | 'victory';

export interface LedCue {
  pattern: LedPattern;
  durationMs: number;
  /** 0 = near board, 1 = far board. */
  boardEnd: 0 | 1;
  /** Hex colours with any 'team' placeholder already resolved. */
  colors: string[];
}

export interface PresentationCue {
  /** Milliseconds after the bag was released. */
  atMs: number;
  reason: 'hole' | 'landing' | 'foul';
  bagId?: string;
  sound?: SoundId;
  led?: LedCue;
}

const resolveColors = (colors: readonly string[], teamHex: string): string[] =>
  colors.map((c) => (c === 'team' ? teamHex : c));

/**
 * Cues for one throw, in time order.
 * - A bag dropping into the hole (thrown directly, slid in, or knocked in by a later bag) fires the
 *   ring-in sound and the LED flash burst at that exact moment.
 * - A bag that stays on the board gets a soft thud at touchdown; a bag that hits the grass gets a
 *   duller one. Neither flashes the lights.
 */
export function cuesForThrow(
  sim: ThrowSimResult,
  ctx: { targetEnd: 0 | 1; teamColorHex: Record<TeamId, string>; teamOfBag: (bagId: string) => TeamId },
): PresentationCue[] {
  const cues: PresentationCue[] = [];

  if (sim.status === 'ground' && sim.foul === 'missed_board' && sim.slide.length === 0) {
    cues.push({ atMs: sim.flightMs, reason: 'foul', bagId: sim.bagId, sound: 'ground_thud' });
  } else if (sim.status === 'board') {
    cues.push({ atMs: sim.flightMs, reason: 'landing', bagId: sim.bagId, sound: 'bag_thud' });
  }

  for (const event of sim.holeEvents) {
    const team = ctx.teamOfBag(event.bagId);
    cues.push({
      atMs: event.tMs,
      reason: 'hole',
      bagId: event.bagId,
      sound: 'cornhole_hit',
      led: {
        pattern: 'flash_burst',
        durationMs: LED_BOARD.cornhole.durationMs,
        boardEnd: ctx.targetEnd,
        colors: resolveColors(LED_BOARD.cornhole.colors, ctx.teamColorHex[team]),
      },
    });
  }
  return cues.sort((a, b) => a.atMs - b.atMs);
}

export function scoreCue(boardEnd: 0 | 1, teamHex: string): LedCue {
  return {
    pattern: 'score_pulse',
    durationMs: LED_BOARD.scorePulse.durationMs,
    boardEnd,
    colors: resolveColors(LED_BOARD.scorePulse.colors, teamHex),
  };
}

export function victoryCue(boardEnd: 0 | 1, teamHex: string): LedCue {
  return {
    pattern: 'victory',
    durationMs: LED_BOARD.victory.durationMs,
    boardEnd,
    colors: resolveColors(LED_BOARD.victory.colors, teamHex),
  };
}
