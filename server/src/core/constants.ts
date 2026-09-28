/** Regulation cornhole dimensions and iPlay catalog data. All lengths are in inches. */

export const BOARD = {
  widthIn: 24,
  lengthIn: 48,
  holeRadiusIn: 3,
  /** Hole centre, measured from the FRONT edge of the board (9 in from the back edge). */
  holeCenterYIn: 39,
  frontHeightIn: 3.5,
  backHeightIn: 12,
} as const;

export const BAG = {
  sizeIn: 6,
  /** Bags are simulated as discs; the disc radius matches half the bag width. */
  radiusIn: 3,
} as const;

/** Distance between the FRONT edges of the two boards. */
export const DISTANCE_IN = {
  regulation: 324, // 27 ft
  backyard: 252, // 21 ft
} as const;

export const BAGS_PER_PLAYER = 4;
export const BAGS_PER_INNING = 8;

export const POINTS = { hole: 3, board: 1 } as const;

export const TARGET_SCORES = [11, 15, 21] as const;
export type TargetScore = (typeof TARGET_SCORES)[number];

/** Score a team drops to when it busts (house rule), keyed by target score. */
export const BUST_TO: Record<TargetScore, number> = { 11: 7, 15: 11, 21: 15 };

/** Skunk rule: a team leading by this score to 0 wins immediately. */
export const SKUNK_SCORE = 11;

export const THROW_TIMER_OPTIONS = [20, null] as const;

export const COLOR_PICK_TIMER_MS = 15_000;
export const CHARACTER_PICK_TIMER_MS = 20_000;
export const RECONNECT_GRACE_MS = 30_000;
/** A match with no connected human for this long is abandoned. */
export const ABANDON_AFTER_MS = 120_000;

export interface BagColor {
  id: string;
  name: string;
  hex: string;
}

/** 12 team bag colours. Order is display order on the pick screen. */
export const BAG_COLORS: readonly BagColor[] = [
  { id: 'black', name: 'Black', hex: '#1B1B1B' },
  { id: 'white', name: 'White', hex: '#F4F4F2' },
  { id: 'red', name: 'Red', hex: '#C8102E' },
  { id: 'orange', name: 'Orange', hex: '#FF6A13' },
  { id: 'yellow', name: 'Yellow', hex: '#FFD100' },
  { id: 'kelly-green', name: 'Kelly Green', hex: '#009A44' },
  { id: 'royal-blue', name: 'Royal Blue', hex: '#1D4ED8' },
  { id: 'sky-blue', name: 'Sky Blue', hex: '#6CC5F0' },
  { id: 'purple', name: 'Purple', hex: '#6B2C91' },
  { id: 'hot-pink', name: 'Hot Pink', hex: '#E0218A' },
  { id: 'teal', name: 'Teal', hex: '#00A5A8' },
  { id: 'maroon', name: 'Maroon', hex: '#6D1A2A' },
];

export interface CharacterInfo {
  id: string;
  name: string;
  gender: 'female' | 'male';
  age: number;
}

/** The 8 video characters (4 women, 4 men, ages 30-50). See docs/characters.md. */
export const CHARACTERS: readonly CharacterInfo[] = [
  { id: 'keisha', name: 'Keisha', gender: 'female', age: 34 },
  { id: 'tanya', name: 'Tanya', gender: 'female', age: 46 },
  { id: 'marisol', name: 'Marisol', gender: 'female', age: 38 },
  { id: 'jenna', name: 'Jenna', gender: 'female', age: 42 },
  { id: 'dre', name: 'Dre', gender: 'male', age: 36 },
  { id: 'big-mike', name: 'Big Mike', gender: 'male', age: 48 },
  { id: 'carlos', name: 'Carlos', gender: 'male', age: 41 },
  { id: 'travis', name: 'Travis', gender: 'male', age: 33 },
];

export const MAX_DISPLAY_NAME_LENGTH = 24;
