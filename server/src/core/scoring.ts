import { POINTS } from './constants.js';
import type { BagRecord, TeamId } from './types.js';

export interface InningTally {
  points: Record<TeamId, number>;
  holes: Record<TeamId, number>;
  boards: Record<TeamId, number>;
  /** Team that scores after cancellation, or null for a wash. */
  scoringTeam: TeamId | null;
  scored: number;
}

/** Raw points for the bags currently resting in play. Removed (`ground`) bags score 0. */
export function rawPoints(bags: readonly BagRecord[]): Pick<InningTally, 'points' | 'holes' | 'boards'> {
  const holes: Record<TeamId, number> = { A: 0, B: 0 };
  const boards: Record<TeamId, number> = { A: 0, B: 0 };
  for (const bag of bags) {
    if (bag.status === 'hole') holes[bag.team]++;
    else if (bag.status === 'board') boards[bag.team]++;
  }
  return {
    holes,
    boards,
    points: {
      A: holes.A * POINTS.hole + boards.A * POINTS.board,
      B: holes.B * POINTS.hole + boards.B * POINTS.board,
    },
  };
}

/** Cancellation scoring: only the team with more points scores, and only the difference. */
export function tallyInning(bags: readonly BagRecord[]): InningTally {
  const raw = rawPoints(bags);
  const diff = raw.points.A - raw.points.B;
  return {
    ...raw,
    scoringTeam: diff === 0 ? null : diff > 0 ? 'A' : 'B',
    scored: Math.abs(diff),
  };
}

export function otherTeam(team: TeamId): TeamId {
  return team === 'A' ? 'B' : 'A';
}
