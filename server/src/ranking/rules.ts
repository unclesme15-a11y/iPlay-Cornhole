import type { MatchConfig } from '../core/types.js';
import type { RankedMode } from './ratings.js';

/** Ranked play has one fixed rule set so everybody's rating means the same thing. */
export const rankedConfig = (mode: RankedMode): MatchConfig => ({
  mode: mode === 'singles' ? '1v1' : '2v2',
  playTo: 21,
  bust: false,
  skunk: false,
  distance: 'regulation',
  throwTimerSec: 20,
  boardCam: true,
  tutorial: false,
});

/** How long a player who walks out of a ranked match must wait before queueing again. */
export const FORFEIT_COOLDOWN_MS = 10 * 60_000;
