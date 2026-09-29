import { BAGS_PER_INNING, BAGS_PER_PLAYER, BUST_TO, SKUNK_SCORE } from './constants.js';
import { DomainError } from './errors.js';
import { otherTeam, tallyInning } from './scoring.js';
import type {
  BagRecord,
  BagStatus,
  EngineEvent,
  FoulReason,
  InningResult,
  MatchConfig,
  MatchState,
  NextThrow,
  SeatId,
  TeamId,
  ThrowOutcome,
} from './types.js';

const STATUSES: readonly BagStatus[] = ['hole', 'board', 'ground'];

/** Seat that throws for `team` from `end` (0 = near, 1 = far). */
export function seatFor(mode: MatchConfig['mode'], team: TeamId, end: 0 | 1): SeatId {
  if (mode === '1v1') return `${team}1` as SeatId;
  return `${team}${end === 0 ? 1 : 2}` as SeatId;
}

export function seatsFor(mode: MatchConfig['mode']): SeatId[] {
  return mode === '1v1' ? ['A1', 'B1'] : ['A1', 'B1', 'A2', 'B2'];
}

/**
 * Pure, deterministic match state machine for regulation cornhole.
 * It knows nothing about physics, timers, or networking: callers feed it the
 * outcome of each throw and it applies the rules.
 *
 * Every mutating method returns the events it produced. State is plain JSON so a
 * match can be persisted with `snapshot()` and rebuilt with `MatchEngine.restore()`.
 */
export class MatchEngine {
  private state: MatchState;

  constructor(config: MatchConfig, firstTeam: TeamId) {
    this.state = {
      config: { ...config },
      scores: { A: 0, B: 0 },
      inning: 1,
      firstTeam,
      throwsThisInning: 0,
      bags: [],
      phase: 'in_progress',
      winner: null,
      winReason: null,
      history: [],
    };
  }

  static restore(state: MatchState): MatchEngine {
    const engine = new MatchEngine(state.config, state.firstTeam);
    engine.state = structuredClone(state);
    return engine;
  }

  snapshot(): MatchState {
    return structuredClone(this.state);
  }

  get config(): MatchConfig {
    return this.state.config;
  }
  get scores(): Readonly<Record<TeamId, number>> {
    return this.state.scores;
  }
  get finished(): boolean {
    return this.state.phase === 'finished';
  }
  get winner(): TeamId | null {
    return this.state.winner;
  }

  /** Bags currently resting on the board this inning (in play or in the hole). */
  get bags(): readonly BagRecord[] {
    return this.state.bags;
  }

  /** Which end throws this inning. Ends alternate every inning, starting at the near end. */
  fromEnd(inning = this.state.inning): 0 | 1 {
    return ((inning - 1) % 2) as 0 | 1;
  }

  /** Who throws next, or null if the match is over. */
  next(): NextThrow | null {
    if (this.finished) return null;
    const s = this.state;
    const team = s.throwsThisInning % 2 === 0 ? s.firstTeam : otherTeam(s.firstTeam);
    const fromEnd = this.fromEnd();
    const seat = seatFor(s.config.mode, team, fromEnd);
    const bagNumber = Math.floor(s.throwsThisInning / 2) + 1;
    return {
      seat,
      team,
      bagId: `${seat}-i${s.inning}-b${bagNumber}`,
      inning: s.inning,
      fromEnd,
      throwNumber: s.throwsThisInning + 1,
      bagsLeft: { A: this.bagsLeftFor('A'), B: this.bagsLeftFor('B') },
    };
  }

  private bagsLeftFor(team: TeamId): number {
    const s = this.state;
    const firstThrows = Math.ceil(s.throwsThisInning / 2);
    const secondThrows = Math.floor(s.throwsThisInning / 2);
    const thrown = team === s.firstTeam ? firstThrows : secondThrows;
    return BAGS_PER_INNING / 2 - thrown;
  }

  /** Bags each player throws per inning. */
  static readonly bagsPerPlayer = BAGS_PER_PLAYER;

  /** Points each team would earn if the inning ended right now. */
  provisional(): ReturnType<typeof tallyInning> {
    return tallyInning(this.state.bags);
  }

  /**
   * Apply the physical result of the next throw.
   * `seat` must be the seat the engine expects, and `outcome.bagId` must be its next bag.
   */
  recordThrow(seat: SeatId, outcome: ThrowOutcome): EngineEvent[] {
    const upcoming = this.requireNext();
    if (seat !== upcoming.seat) {
      throw new DomainError('not_your_turn', `It is ${upcoming.seat}'s throw, not ${seat}'s`, 409);
    }
    if (outcome.bagId !== upcoming.bagId) {
      throw new DomainError('wrong_bag', `Expected bag ${upcoming.bagId}, got ${outcome.bagId}`, 409);
    }
    if (!STATUSES.includes(outcome.status)) {
      throw new DomainError('bad_status', `Unknown bag status ${String(outcome.status)}`);
    }
    if (outcome.status === 'ground' && !outcome.foul) {
      throw new DomainError('bad_status', 'A bag on the ground must carry a foul reason');
    }
    // Validate every update before mutating anything.
    for (const [id, status] of Object.entries(outcome.updates)) {
      const target = this.state.bags.find((b) => b.id === id);
      if (!target) throw new DomainError('unknown_bag', `Update for unknown bag ${id}`);
      if (!STATUSES.includes(status)) throw new DomainError('bad_status', `Unknown bag status ${String(status)}`);
      if (target.status !== 'board' && status !== target.status) {
        throw new DomainError('bad_update', `Bag ${id} is already ${target.status} and cannot change`);
      }
      if (id === outcome.bagId) throw new DomainError('bad_update', 'A throw cannot update its own bag as a side effect');
    }

    const events: EngineEvent[] = [];
    for (const [id, status] of Object.entries(outcome.updates)) {
      const target = this.state.bags.find((b) => b.id === id)!;
      target.status = status;
      if (status === 'ground') target.foul = 'knocked_off';
    }
    const bag: BagRecord = { id: upcoming.bagId, team: upcoming.team, seat: upcoming.seat, status: outcome.status };
    if (outcome.foul) bag.foul = outcome.foul;
    this.state.bags.push(bag);
    this.state.throwsThisInning++;

    events.push({
      type: 'bag_thrown',
      bagId: bag.id,
      seat: bag.seat,
      team: bag.team,
      status: bag.status,
      ...(bag.foul ? { foul: bag.foul } : {}),
      updates: { ...outcome.updates },
    });

    if (this.state.throwsThisInning === BAGS_PER_INNING) events.push(...this.completeInning());
    return events;
  }

  /** The throw timer ran out: the bag is a foul (scores 0) and play moves on. */
  foulTimeout(seat: SeatId): EngineEvent[] {
    const upcoming = this.requireNext();
    return this.recordThrow(seat, {
      bagId: upcoming.bagId,
      status: 'ground',
      foul: 'timer' satisfies FoulReason,
      updates: {},
    });
  }

  /** A whole team gives up. The other team wins. */
  forfeit(team: TeamId): EngineEvent[] {
    if (this.finished) throw new DomainError('match_finished', 'The match is already over', 409);
    const winner = otherTeam(team);
    this.state.phase = 'finished';
    this.state.winner = winner;
    this.state.winReason = 'forfeit';
    return [{ type: 'match_complete', winner, reason: 'forfeit', scores: { ...this.state.scores } }];
  }

  private requireNext(): NextThrow {
    const upcoming = this.next();
    if (!upcoming) throw new DomainError('match_finished', 'The match is already over', 409);
    return upcoming;
  }

  private completeInning(): EngineEvent[] {
    const s = this.state;
    const tally = tallyInning(s.bags);
    let busted: TeamId | null = null;

    if (tally.scoringTeam) s.scores[tally.scoringTeam] += tally.scored;

    const target = s.config.playTo;
    if (s.config.bust && tally.scoringTeam && s.scores[tally.scoringTeam] > target) {
      s.scores[tally.scoringTeam] = BUST_TO[target];
      busted = tally.scoringTeam;
    }

    const result: InningResult = {
      inning: s.inning,
      fromEnd: this.fromEnd(),
      firstTeam: s.firstTeam,
      points: tally.points,
      scoringTeam: tally.scoringTeam,
      scored: tally.scored,
      bags: { holes: tally.holes, boards: tally.boards },
      finalBags: s.bags.map((b) => ({ seat: b.seat, team: b.team, status: b.status })),
      scoreAfter: { ...s.scores },
      busted,
    };
    s.history.push(result);
    const events: EngineEvent[] = [{ type: 'inning_complete', result }];

    const verdict = this.checkWinner();
    if (verdict) {
      s.phase = 'finished';
      s.winner = verdict.winner;
      s.winReason = verdict.reason;
      events.push({ type: 'match_complete', winner: verdict.winner, reason: verdict.reason, scores: { ...s.scores } });
      return events;
    }

    // Next inning: the team that scored throws first; after a wash the same team goes first again.
    if (tally.scoringTeam) s.firstTeam = tally.scoringTeam;
    s.inning++;
    s.throwsThisInning = 0;
    s.bags = [];
    return events;
  }

  private checkWinner(): { winner: TeamId; reason: 'score' | 'skunk' } | null {
    const { scores, config } = this.state;
    const target = config.playTo;
    for (const team of ['A', 'B'] as const) {
      const reached = config.bust ? scores[team] === target : scores[team] >= target;
      if (reached) return { winner: team, reason: 'score' };
    }
    if (config.skunk) {
      for (const team of ['A', 'B'] as const) {
        if (scores[team] >= SKUNK_SCORE && scores[otherTeam(team)] === 0) return { winner: team, reason: 'skunk' };
      }
    }
    return null;
  }
}
