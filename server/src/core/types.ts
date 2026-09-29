import type { TargetScore } from './constants.js';

export type TeamId = 'A' | 'B';
export type SeatId = 'A1' | 'B1' | 'A2' | 'B2';
export type MatchMode = '1v1' | '2v2';
export type Distance = 'regulation' | 'backyard';

/** Where a bag is resting. `ground` means removed (foul, or knocked off). */
export type BagStatus = 'hole' | 'board' | 'ground';
export type FoulReason = 'timer' | 'missed_board' | 'knocked_off';

export interface MatchConfig {
  mode: MatchMode;
  playTo: TargetScore;
  /** House rule: going over the target drops the team back (see BUST_TO). */
  bust: boolean;
  /** House rule: leading 11-0 at the end of an inning wins. */
  skunk: boolean;
  distance: Distance;
  /** Seconds per throw, or null for no timer. */
  throwTimerSec: 20 | null;
  boardCam: boolean;
  tutorial: boolean;
}

export const DEFAULT_CONFIG: MatchConfig = {
  mode: '2v2',
  playTo: 21,
  bust: false,
  skunk: false,
  distance: 'regulation',
  throwTimerSec: 20,
  boardCam: true,
  tutorial: false,
};

export interface BagRecord {
  id: string;
  team: TeamId;
  seat: SeatId;
  status: BagStatus;
  foul?: FoulReason;
}

/** The result of one physical throw, as the engine needs it. */
export interface ThrowOutcome {
  bagId: string;
  status: BagStatus;
  foul?: FoulReason;
  /** Status changes for OTHER bags already on the board caused by this throw. */
  updates: Record<string, BagStatus>;
}

export interface InningResult {
  inning: number;
  /** Which end the bags were thrown from (0 = near end, 1 = far end). */
  fromEnd: 0 | 1;
  firstTeam: TeamId;
  points: Record<TeamId, number>;
  /** Team that scored, or null for a wash. */
  scoringTeam: TeamId | null;
  scored: number;
  bags: { holes: Record<TeamId, number>; boards: Record<TeamId, number> };
  /** Where every bag finished, so per-player stats can be counted. */
  finalBags: Array<{ seat: SeatId; team: TeamId; status: BagStatus }>;
  scoreAfter: Record<TeamId, number>;
  busted: TeamId | null;
}

export type WinReason = 'score' | 'skunk' | 'forfeit';

export interface MatchState {
  config: MatchConfig;
  scores: Record<TeamId, number>;
  inning: number;
  firstTeam: TeamId;
  /** Number of bags thrown so far this inning (0..8). */
  throwsThisInning: number;
  bags: BagRecord[];
  phase: 'in_progress' | 'finished';
  winner: TeamId | null;
  winReason: WinReason | null;
  history: InningResult[];
}

export interface NextThrow {
  seat: SeatId;
  team: TeamId;
  bagId: string;
  inning: number;
  fromEnd: 0 | 1;
  /** 1-based index of this bag within the inning (1..8). */
  throwNumber: number;
  bagsLeft: Record<TeamId, number>;
}

export type EngineEvent =
  | { type: 'bag_thrown'; bagId: string; seat: SeatId; team: TeamId; status: BagStatus; foul?: FoulReason; updates: Record<string, BagStatus> }
  | { type: 'inning_complete'; result: InningResult }
  | { type: 'match_complete'; winner: TeamId; reason: WinReason; scores: Record<TeamId, number> };
