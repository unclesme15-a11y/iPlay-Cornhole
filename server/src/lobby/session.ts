import {
  ABANDON_AFTER_MS,
  BAG_COLORS,
  CHARACTER_PICK_TIMER_MS,
  CHARACTERS,
  COLOR_PICK_TIMER_MS,
  DISTANCE_IN,
  RECONNECT_GRACE_MS,
} from '../core/constants.js';
import { DomainError } from '../core/errors.js';
import { MatchEngine, seatsFor } from '../core/match.js';
import { createRng, pick, randomInt, secureRng, secureSeed, type Rng } from '../core/rng.js';
import type {
  EngineEvent,
  InningResult,
  MatchConfig,
  MatchState,
  SeatId,
  TeamId,
  WinReason,
} from '../core/types.js';
import type { MatchSummary, PlayerSummary } from '../accounts/history.js';
import type { RankedMode, RatingUpdate } from '../ranking/ratings.js';
import { decideThrow, type BotLevel } from '../bots/botPolicy.js';
import { isValidGesture, simulateThrow, type ThrowGesture, type ThrowSimResult } from '../physics/throwSim.js';
import { CALM, relativeWind, rollWind, shiftWind, type RelativeWind, type Wind, type WindLevel } from '../physics/wind.js';
import { applyRelease, type ReleaseEffect, type ReleaseInput } from '../physics/release.js';
import { cuesForThrow, scoreCue, victoryCue, type LedCue, type PresentationCue } from '../presentation/effects.js';
import type { Scheduler } from './scheduler.js';

export type Phase = 'lobby' | 'characters' | 'colors' | 'toss' | 'playing' | 'finished' | 'abandoned';

export type SeatPlan = Partial<Record<SeatId, { kind: 'human' | 'bot'; level?: BotLevel }>>;

export interface SeatState {
  id: SeatId;
  team: TeamId;
  /** Which end this seat stands at for the first inning (0 = near). Ends swap every inning. */
  startEnd: 0 | 1;
  kind: 'human' | 'bot';
  botLevel: BotLevel;
  playerId: string | null;
  name: string | null;
  characterId: string | null;
  /** A human seat that a bot is currently playing for (disconnect or leave). */
  controlledByBot: boolean;
}

/** The bit of an account a match needs. Players are identified by account id everywhere. */
export interface AccountRef {
  id: string;
  displayName: string;
}

interface Player {
  id: string;
  seat: SeatId;
  name: string;
  connected: boolean;
  host: boolean;
  left: boolean;
}

interface SeatStats {
  throws: number;
  holes: number;
  boards: number;
  fouls: number;
}

const zeroStats = (): SeatStats => ({ throws: 0, holes: 0, boards: 0, fouls: 0 });

/** Bumped when the wire format changes in a way old apps cannot read. */
export const PROTOCOL_VERSION = 2;

interface RematchState {
  deadlineAt: number;
  votes: Record<string, boolean>;
  matchId: string | null;
  cancelled: boolean;
}

/** Everything needed to seat the same people (and bots) in a new match. */
export interface RematchSeed {
  config: MatchConfig;
  rematchOf: string;
  seats: SeatState[];
  players: Array<{ id: string; seat: SeatId; name: string; host: boolean }>;
  colors: Partial<Record<TeamId, string>>;
}

/** How a session tells the outside world about itself. All optional. */
export interface SessionHooks {
  /** Something about the match changed (used to save it). */
  onChange?: (session: MatchSession) => void;
  /** The match finished or was abandoned. Called once. */
  onEnded?: (session: MatchSession) => void;
  /** Start a rematch. Returns the new match's id, or throws a DomainError if it can't be made. */
  createRematch?: (session: MatchSession, seed: RematchSeed) => string;
  /** A player's connection dropped while the match was being played (not at a server restart). */
  onPlayerAway?: (session: MatchSession, playerId: string) => void;
}

/** Plain JSON copy of a live match, enough to bring it back after a server restart. */
export interface SessionSnapshot {
  version: 1;
  id: string;
  createdAt: number;
  startedAt: number | null;
  rematchOf: string | null;
  config: MatchConfig;
  phase: Phase;
  phaseDeadline: number | null;
  seats: SeatState[];
  players: Array<{ id: string; seat: SeatId; name: string; host: boolean; left: boolean }>;
  colors: Partial<Record<TeamId, string>>;
  engine: MatchState | null;
  positions: Array<[string, { x: number; y: number }]>;
  turn: Turn | null;
  seq: number;
  seatStats: Record<SeatId, SeatStats>;
  lastActivity: number;
  ranked?: RankedMode | null;
  wind?: Wind;
  windInning?: number;
  idleStreak?: Record<SeatId, number>;
}

export interface SessionEvent {
  seq: number;
  at: number;
  type: string;
  data: Record<string, unknown>;
}

export interface SessionOptions {
  id: string;
  config: MatchConfig;
  seatPlan?: SeatPlan;
  scheduler: Scheduler;
  /** Injectable randomness for tests. Production uses cryptographic randomness. */
  rng?: Rng;
  seedSource?: () => number;
  timing?: Partial<Timing>;
  hooks?: SessionHooks;
  createdAt?: number;
  rematchOf?: string | null;
  /** Ranked matches: everyone is human, the rules are fixed, leaving forfeits, and there is no rematch. */
  ranked?: RankedMode | null;
}

export interface Timing {
  botThinkMinMs: number;
  botThinkMaxMs: number;
  tossMs: number;
  /** Pause after a throw finishes landing, before the next turn opens. */
  reactionMs: number;
  /** Extra pause when an inning ends (bags are swept, scores shown). */
  inningEndMs: number;
  characterPickMs: number;
  colorPickMs: number;
  reconnectGraceMs: number;
  abandonAfterMs: number;
  /** How long players have to say yes to a rematch. */
  rematchWindowMs: number;
  /** Coin-toss pause at the start of a rematch (players must switch to the new match). */
  rematchTossMs: number;
}

const DEFAULT_TIMING: Timing = {
  botThinkMinMs: 1000,
  botThinkMaxMs: 2400,
  tossMs: 3000,
  reactionMs: 1800,
  inningEndMs: 2600,
  characterPickMs: CHARACTER_PICK_TIMER_MS,
  colorPickMs: COLOR_PICK_TIMER_MS,
  reconnectGraceMs: RECONNECT_GRACE_MS,
  abandonAfterMs: ABANDON_AFTER_MS,
  rematchWindowMs: 60_000,
  rematchTossMs: 5000,
};

const SEAT_TEAM: Record<SeatId, TeamId> = { A1: 'A', B1: 'B', A2: 'A', B2: 'B' };
const SEAT_END: Record<SeatId, 0 | 1> = { A1: 0, B1: 0, A2: 1, B2: 1 };
const EVENT_LOG_LIMIT = 500;
/** This many throws in a row that time out means the player has stopped playing. */
export const IDLE_TIMEOUTS_LIMIT = 3;

export interface Turn {
  seat: SeatId;
  team: TeamId;
  bagId: string;
  controlledBy: 'human' | 'bot';
  deadlineAt: number | null;
}

export interface MatchView {
  id: string;
  protocol: number;
  seq: number;
  createdAt: number;
  rematchOf: string | null;
  phase: Phase;
  config: MatchConfig;
  seats: Array<{
    id: SeatId;
    team: TeamId;
    startEnd: 0 | 1;
    kind: 'human' | 'bot';
    botLevel: BotLevel | null;
    name: string | null;
    claimed: boolean;
    connected: boolean;
    accountId: string | null;
    characterId: string | null;
    controlledByBot: boolean;
  }>;
  colors: Partial<Record<TeamId, string>>;
  deadlineAt: number | null;
  scores: Record<TeamId, number>;
  inning: number;
  firstTeam: TeamId | null;
  turn: (Omit<Turn, 'controlledBy'> & { controlledBy: 'human' | 'bot'; fromEnd: 0 | 1; targetEnd: 0 | 1; throwNumber: number; bagsLeft: Record<TeamId, number>; wind: RelativeWind }) | null;
  board: Array<{ id: string; team: TeamId; status: 'board' | 'hole'; x: number | null; y: number | null }>;
  history: InningResult[];
  winner: TeamId | null;
  winReason: WinReason | 'abandoned' | null;
  rematch: { deadlineAt: number; votes: Record<string, boolean>; matchId: string | null; cancelled: boolean } | null;
  /** The field's wind right now (null before play). The turn has the same wind from the thrower's point of view. */
  wind: Wind | null;
  /** 'singles' or 'teams' for a ranked match, otherwise null. */
  ranked: RankedMode | null;
  /** Ranked only, once the result is saved: how each player's rating moved (null until then). */
  ratings: { voided: boolean; you: RatingUpdate | null; players: RatingUpdate[] } | null;
  you: { playerId: string; seat: SeatId; team: TeamId; host: boolean } | null;
}

export interface Seated {
  playerId: string;
  seat: SeatId;
}

/** Small summary for the "join this match" screen. Safe to show to anyone holding the code. */
export interface InvitePreview {
  code: string;
  hostName: string | null;
  mode: MatchConfig['mode'];
  playTo: MatchConfig['playTo'];
  phase: Phase;
  openSeats: SeatId[];
  canJoin: boolean;
}

export class MatchSession {
  readonly id: string;
  readonly config: MatchConfig;
  private readonly sched: Scheduler;
  private readonly rng: Rng;
  private readonly seed: () => number;
  private readonly timing: Timing;

  private phase: Phase = 'lobby';
  private seats: SeatState[];
  private players = new Map<string, Player>();
  private colors: Partial<Record<TeamId, string>> = {};
  private phaseDeadline: number | null = null;
  private engine: MatchEngine | null = null;
  private turn: Turn | null = null;
  private positions = new Map<string, { x: number; y: number }>();
  private log: SessionEvent[] = [];
  private seq = 0;
  private listeners = new Set<(event: SessionEvent) => void>();
  private timers = new Map<string, () => void>();
  private finalReason: WinReason | 'abandoned' | null = null;
  private readonly hooks: SessionHooks;
  private seatStats: Record<SeatId, SeatStats>;
  private rematch: RematchState | null = null;
  private ended = false;
  private wind: Wind = { ...CALM };
  /** Throws in a row that ran out the clock, per seat. Three means the player has walked away from the game. */
  private idleStreak: Record<SeatId, number> = { A1: 0, B1: 0, A2: 0, B2: 0 };
  /** The inning the current wind was set for (0 = not yet). */
  private windInning = 0;

  readonly createdAt: number;
  readonly rematchOf: string | null;
  readonly ranked: RankedMode | null;
  /** Ranked only: the account that walked out (left or timed out). They wait before queueing again. */
  forfeitedBy: string | null = null;
  private ratingResult: { voided: boolean; updates: RatingUpdate[] } | null = null;
  startedAt: number | null = null;
  lastActivity: number;

  constructor(opts: SessionOptions) {
    this.id = opts.id;
    this.config = opts.config;
    this.sched = opts.scheduler;
    this.rng = opts.rng ?? secureRng();
    this.seed = opts.seedSource ?? secureSeed;
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
    this.hooks = opts.hooks ?? {};
    this.createdAt = opts.createdAt ?? this.sched.now();
    this.rematchOf = opts.rematchOf ?? null;
    this.ranked = opts.ranked ?? null;
    this.lastActivity = this.sched.now();
    this.seatStats = { A1: zeroStats(), B1: zeroStats(), A2: zeroStats(), B2: zeroStats() };

    const plan = opts.seatPlan ?? {};
    this.seats = seatsFor(opts.config.mode).map((id) => {
      const wanted = plan[id];
      const isHost = id === 'A1';
      const kind = isHost ? 'human' : (wanted?.kind ?? 'bot');
      return {
        id,
        team: SEAT_TEAM[id],
        startEnd: SEAT_END[id],
        kind,
        botLevel: wanted?.level ?? 'regular',
        playerId: null,
        name: null,
        characterId: null,
        controlledByBot: false,
      } satisfies SeatState;
    });
  }

  // ------------------------------------------------------------------ lobby

  /** Seat the host in A1. Called once right after construction. */
  createHost(account: AccountRef): Seated {
    return this.claim('A1', account, true);
  }

  /**
   * A ranked match: every seat is a human who was found by the matchmaker, and the picks start at once.
   * Nobody is connected yet; anyone who does not show up in time forfeits.
   */
  static createRanked(
    opts: Omit<SessionOptions, 'config' | 'seatPlan' | 'ranked'> & { mode: RankedMode; config: MatchConfig },
    assignments: Array<{ account: AccountRef; seat: SeatId }>,
  ): MatchSession {
    const plan: SeatPlan = {};
    for (const a of assignments) plan[a.seat] = { kind: 'human' };
    const { mode, ...rest } = opts;
    const session = new MatchSession({ ...rest, seatPlan: plan, ranked: mode });
    for (const a of assignments) {
      session.claim(a.seat, a.account, a.seat === 'A1');
      session.players.get(a.account.id)!.connected = false;
    }
    return session;
  }

  /** Ranked only: start the picks and the no-show clock. */
  startRanked(): void {
    if (!this.ranked) throw new DomainError('not_ranked', 'This is not a ranked match', 409);
    this.requirePhase('lobby');
    this.touch();
    for (const p of this.players.values()) this.armGrace(p);
    this.enterCharacters();
  }

  /** The matchmaker's result: how ratings moved. Shown on the results screen. */
  applyRatings(result: { voided: boolean; updates: RatingUpdate[] }): void {
    if (!this.ranked || this.ratingResult) return;
    this.ratingResult = result;
    this.emit('ratings_updated', { voided: result.voided, updates: result.updates });
  }

  /** Take a seat. If this account already has one in this match, that seat is returned again. */
  join(account: AccountRef, seatId?: SeatId): Seated {
    const existing = this.players.get(account.id);
    if (existing && !existing.left) return { playerId: existing.id, seat: existing.seat };
    this.requirePhase('lobby');
    const open = this.seats.filter((s) => s.kind === 'human' && !s.playerId);
    if (open.length === 0) throw new DomainError('match_full', 'No open human seats', 409);
    let seat: SeatState | undefined;
    if (seatId) {
      seat = this.seats.find((s) => s.id === seatId);
      if (!seat) throw new DomainError('bad_seat', `No seat ${seatId} in a ${this.config.mode} match`);
      if (seat.kind !== 'human') throw new DomainError('seat_is_bot', `${seatId} is a bot seat`, 409);
      if (seat.playerId) throw new DomainError('seat_taken', `${seatId} is already taken`, 409);
    } else {
      seat = open[0]!;
    }
    return this.claim(seat.id, account, false);
  }

  private claim(seatId: SeatId, account: AccountRef, host: boolean): Seated {
    const seat = this.seat(seatId);
    this.players.set(account.id, {
      id: account.id,
      seat: seatId,
      name: account.displayName,
      connected: true,
      host,
      left: false,
    });
    seat.playerId = account.id;
    seat.name = account.displayName;
    this.touch();
    this.emit('seats', { seats: this.seatsView() });
    return { playerId: account.id, seat: seatId };
  }

  /**
   * Host closes the lobby and starts the pick phases.
   * With `fillOpenWithBots`, seats nobody has taken yet are given to bots instead of waiting.
   */
  start(playerId: string, opts: { fillOpenWithBots?: boolean } = {}): void {
    const player = this.requirePlayer(playerId);
    this.requirePhase('lobby');
    if (!player.host) throw new DomainError('not_host', 'Only the host can start the match', 403);
    const open = this.seats.filter((s) => s.kind === 'human' && !s.playerId);
    if (open.length > 0) {
      if (!opts.fillOpenWithBots) {
        throw new DomainError('seats_open', `Waiting for players to fill ${open.map((s) => s.id).join(', ')}`, 409);
      }
      for (const seat of open) seat.kind = 'bot';
      this.emit('seats', { seats: this.seatsView() });
    }
    this.touch();
    this.enterCharacters();
  }

  /**
   * Host changes an empty seat while the lobby is open: make it a human seat (so a friend can take
   * it from an invite) or a bot of a given skill. A seat someone is sitting in can't be changed
   * (kick them first), and the host's own seat is always a human.
   */
  setSeat(playerId: string, seatId: SeatId, kind: 'human' | 'bot', level?: BotLevel): void {
    const host = this.requirePlayer(playerId);
    this.requirePhase('lobby');
    if (!host.host) throw new DomainError('not_host', 'Only the host can change seats', 403);
    const seat = this.seats.find((s) => s.id === seatId);
    if (!seat) throw new DomainError('bad_seat', `No seat ${seatId} in a ${this.config.mode} match`);
    if (seatId === 'A1') throw new DomainError('bad_seat', 'The host always sits in A1', 400);
    if (seat.playerId) throw new DomainError('seat_taken', `${seatId} has a player in it. Remove them first.`, 409);
    seat.kind = kind;
    if (kind === 'bot' && level) seat.botLevel = level;
    this.touch();
    this.emit('seats', { seats: this.seatsView() });
  }

  /** Host removes someone from the lobby. Their seat stays open for someone else. */
  kick(playerId: string, seatId: SeatId): void {
    const host = this.requirePlayer(playerId);
    this.requirePhase('lobby');
    if (!host.host) throw new DomainError('not_host', 'Only the host can remove players', 403);
    const seat = this.seats.find((s) => s.id === seatId);
    if (!seat) throw new DomainError('bad_seat', `No seat ${seatId} in a ${this.config.mode} match`);
    const target = seat.playerId ? this.players.get(seat.playerId) : undefined;
    if (!target || target.left) throw new DomainError('seat_empty', `Nobody is in ${seatId}`, 409);
    if (target.host) throw new DomainError('bad_seat', "You can't remove yourself. Leave the match instead.", 400);
    target.left = true;
    this.clearTimer(`grace:${target.id}`);
    seat.playerId = null;
    seat.name = null;
    this.touch();
    this.emit('kicked', { seat: seatId, accountId: target.id });
    this.emit('seats', { seats: this.seatsView() });
  }

  // ------------------------------------------------------------ character pick

  private enterCharacters(): void {
    this.phase = 'characters';
    this.phaseDeadline = this.sched.now() + this.timing.characterPickMs;
    this.emit('phase', { phase: this.phase, deadlineAt: this.phaseDeadline });
    this.setTimer('phase', this.timing.characterPickMs, () => this.finishCharacters());
    this.maybeFinishCharacters();
  }

  pickCharacter(playerId: string, characterId: string): void {
    const player = this.requirePlayer(playerId);
    this.requirePhase('characters');
    if (!CHARACTERS.some((c) => c.id === characterId)) {
      throw new DomainError('bad_character', `Unknown character ${characterId}`);
    }
    const seat = this.seat(player.seat);
    if (seat.characterId === characterId) return;
    const holder = this.seats.find((s) => s.characterId === characterId);
    if (holder) throw new DomainError('character_taken', `${characterId} is already taken`, 409);
    seat.characterId = characterId;
    this.touch();
    this.emit('character_picked', { seat: seat.id, characterId, auto: false });
    this.maybeFinishCharacters();
  }

  private maybeFinishCharacters(): void {
    const waiting = this.seats.some((s) => s.kind === 'human' && !s.controlledByBot && !s.characterId);
    if (!waiting) this.finishCharacters();
  }

  private finishCharacters(): void {
    if (this.phase !== 'characters') return;
    this.clearTimer('phase');
    // Anyone who did not pick gets a random free character (humans first, then bots).
    const ordered = [...this.seats].sort((a, b) => Number(a.kind === 'bot') - Number(b.kind === 'bot'));
    for (const seat of ordered) {
      if (seat.characterId) continue;
      const free = CHARACTERS.filter((c) => !this.seats.some((s) => s.characterId === c.id));
      const chosen = pick(this.rng, free);
      seat.characterId = chosen.id;
      this.emit('character_picked', { seat: seat.id, characterId: chosen.id, auto: true });
    }
    this.enterColors();
  }

  // ---------------------------------------------------------------- colour pick

  private teamHasHuman(team: TeamId): boolean {
    return this.seats.some((s) => s.team === team && s.kind === 'human' && !s.controlledByBot);
  }

  private enterColors(): void {
    this.phase = 'colors';
    this.phaseDeadline = this.sched.now() + this.timing.colorPickMs;
    this.emit('phase', { phase: this.phase, deadlineAt: this.phaseDeadline });
    this.setTimer('phase', this.timing.colorPickMs, () => this.finishColors());
    this.maybeFinishColors();
  }

  /** First come, first served. A team can pick once, and no two teams can share a colour. */
  pickColor(playerId: string, colorId: string): void {
    const player = this.requirePlayer(playerId);
    this.requirePhase('colors');
    if (!BAG_COLORS.some((c) => c.id === colorId)) throw new DomainError('bad_color', `Unknown colour ${colorId}`);
    const team = SEAT_TEAM[player.seat];
    if (this.colors[team]) throw new DomainError('team_already_picked', 'Your team already has a colour', 409);
    const owner = (Object.entries(this.colors) as Array<[TeamId, string]>).find(([, id]) => id === colorId);
    if (owner) throw new DomainError('color_taken', `${colorId} was taken by Team ${owner[0]}`, 409);
    this.colors[team] = colorId;
    this.touch();
    this.emit('color_picked', { team, colorId, auto: false });
    this.maybeFinishColors();
  }

  private maybeFinishColors(): void {
    const waiting = (['A', 'B'] as const).some((t) => this.teamHasHuman(t) && !this.colors[t]);
    if (!waiting) this.finishColors();
  }

  private finishColors(): void {
    if (this.phase !== 'colors') return;
    this.clearTimer('phase');
    // Teams that ran out the clock get a random free colour; all-bot teams pick last.
    const humanTeams = (['A', 'B'] as const).filter((t) => this.teamHasHuman(t));
    const botTeams = (['A', 'B'] as const).filter((t) => !this.teamHasHuman(t));
    for (const team of [...humanTeams, ...botTeams]) {
      if (this.colors[team]) continue;
      const free = BAG_COLORS.filter((c) => !Object.values(this.colors).includes(c.id));
      const chosen = pick(this.rng, free);
      this.colors[team] = chosen.id;
      this.emit('color_picked', { team, colorId: chosen.id, auto: true });
    }
    this.enterToss();
  }

  // ------------------------------------------------------------------ coin toss

  private enterToss(tossMs = this.timing.tossMs): void {
    this.phase = 'toss';
    this.phaseDeadline = null;
    const firstTeam: TeamId = this.rng() < 0.5 ? 'A' : 'B';
    this.engine = new MatchEngine(this.config, firstTeam);
    this.emit('phase', { phase: this.phase, deadlineAt: null });
    this.emit('coin_toss', { firstTeam });
    this.setTimer('phase', tossMs, () => this.startPlaying());
  }

  private get windLevel(): WindLevel {
    return this.config.tutorial ? 'off' : (this.config.wind ?? 'breezy');
  }

  /** New wind at the start of play; after that it drifts a little each inning. */
  private updateWind(inning: number): void {
    if (inning === this.windInning) return;
    this.wind = this.windInning === 0 ? rollWind(this.windLevel, this.seed()) : shiftWind(this.wind, this.windLevel, this.seed());
    this.windInning = inning;
    this.emit('wind', { wind: this.wind, inning });
  }

  private startPlaying(): void {
    this.phase = 'playing';
    this.startedAt ??= this.sched.now();
    this.emit('phase', { phase: this.phase, deadlineAt: null });
    this.beginTurn();
  }

  // -------------------------------------------------------------------- turns

  private beginTurn(): void {
    const engine = this.engine;
    if (!engine || this.phase !== 'playing') return;
    const next = engine.next();
    if (!next) return;
    this.updateWind(next.inning);
    const seat = this.seat(next.seat);
    const controlledBy: 'human' | 'bot' = seat.kind === 'bot' || seat.controlledByBot ? 'bot' : 'human';
    const timerSec = this.config.throwTimerSec;
    const deadlineAt = controlledBy === 'human' && timerSec ? this.sched.now() + timerSec * 1000 : null;
    this.turn = { seat: next.seat, team: next.team, bagId: next.bagId, controlledBy, deadlineAt };
    this.emit('turn_start', {
      seat: next.seat,
      team: next.team,
      bagId: next.bagId,
      inning: next.inning,
      fromEnd: next.fromEnd,
      targetEnd: 1 - next.fromEnd,
      throwNumber: next.throwNumber,
      bagsLeft: next.bagsLeft,
      controlledBy,
      deadlineAt,
      wind: relativeWind(this.wind, next.fromEnd),
    });
    if (controlledBy === 'bot') this.scheduleBotThrow();
    else if (deadlineAt) this.setTimer('turn', timerSec! * 1000, () => this.onThrowTimeout());
  }

  private scheduleBotThrow(): void {
    const think = randomInt(this.rng, this.timing.botThinkMinMs, this.timing.botThinkMaxMs);
    this.setTimer('turn', think, () => this.botThrow());
  }

  private botThrow(): void {
    const engine = this.engine;
    const turn = this.turn;
    if (!engine || !turn || turn.controlledBy !== 'bot') return;
    const seat = this.seat(turn.seat);
    const boardBags = engine.bags
      .filter((b) => b.status === 'board')
      .map((b) => ({ id: b.id, team: b.team, ...(this.positions.get(b.id) ?? { x: 0, y: 24 }) }));
    const provisional = engine.provisional();
    const decision = decideThrow({
      level: seat.botLevel,
      team: turn.team,
      boardBags,
      bagsLeft: engine.next()!.bagsLeft[turn.team],
      points: provisional.points,
      rng: this.rng,
      wind: relativeWind(this.wind, engine.next()!.fromEnd),
    });
    this.performThrow(turn, decision.gesture);
  }

  /** A human throws. The phone sends only the gesture; the server decides everything else. */
  throw(playerId: string, gesture: ThrowGesture, release?: ReleaseInput): void {
    const player = this.requirePlayer(playerId);
    this.requirePhase('playing');
    const turn = this.turn;
    if (!turn || turn.seat !== player.seat || turn.controlledBy !== 'human') {
      throw new DomainError('not_your_turn', 'It is not your turn to throw', 409);
    }
    if (!isValidGesture(gesture)) throw new DomainError('bad_gesture', 'Throw values are out of range');
    this.touch();
    this.idleStreak[turn.seat] = 0;
    if (!release) {
      this.performThrow(turn, gesture);
      return;
    }
    const applied = applyRelease(gesture, release);
    this.performThrow(turn, applied.gesture, { wobble: applied.wobble, effect: applied.effect, aimed: gesture });
  }

  private onThrowTimeout(): void {
    const engine = this.engine;
    const turn = this.turn;
    if (!engine || !turn) return;
    this.turn = null;
    this.clearTimer('turn');
    const targetEnd = (1 - engine.next()!.fromEnd) as 0 | 1;
    const events = engine.foulTimeout(turn.seat);
    this.seatStats[turn.seat].throws++;
    this.seatStats[turn.seat].fouls++;
    this.emit('throw_timeout', { seat: turn.seat, bagId: turn.bagId });
    this.afterEngineEvents(targetEnd, events, 1200);
    // A player who lets the clock run out again and again has walked away from the game. They must not hold
    // everyone else up: a bot plays for them, or (ranked) they forfeit.
    const streak = ++this.idleStreak[turn.seat];
    if (streak >= IDLE_TIMEOUTS_LIMIT) {
      const seat = this.seat(turn.seat);
      const player = seat.kind === 'human' && seat.playerId ? this.players.get(seat.playerId) : undefined;
      if (player && !player.left && !seat.controlledByBot) this.takeOver(player, 'idle');
    }
  }

  private performThrow(turn: Turn, gesture: ThrowGesture, release?: { wobble: number; effect: ReleaseEffect; aimed: ThrowGesture }): void {
    const engine = this.engine!;
    this.turn = null;
    this.clearTimer('turn');

    const upcoming = engine.next()!;
    const boardBags = engine.bags
      .filter((b) => b.status === 'board')
      .map((b) => ({ id: b.id, ...(this.positions.get(b.id) ?? { x: 0, y: 24 }) }));
    const seed = this.seed();
    const sim: ThrowSimResult = simulateThrow({
      gesture,
      bagId: upcoming.bagId,
      boardBags,
      distanceIn: DISTANCE_IN[this.config.distance],
      seed,
      wind: relativeWind(this.wind, upcoming.fromEnd),
      gustiness: this.wind.gustiness,
      ...(release ? { wobble: release.wobble } : {}),
    });

    const teamOfBag = (id: string): TeamId => {
      const known = engine.bags.find((b) => b.id === id);
      return known ? known.team : upcoming.team;
    };
    const cues: PresentationCue[] = cuesForThrow(sim, {
      targetEnd: (1 - upcoming.fromEnd) as 0 | 1,
      teamColorHex: this.teamColorHex(),
      teamOfBag,
    });

    const events = engine.recordThrow(upcoming.seat, {
      bagId: sim.bagId,
      status: sim.status,
      ...(sim.foul ? { foul: sim.foul } : {}),
      updates: sim.updates,
    });

    this.positions = new Map(Object.entries(sim.resting).map(([id, p]) => [id, p]));
    this.seatStats[upcoming.seat].throws++;
    if (sim.status === 'ground') this.seatStats[upcoming.seat].fouls++;

    this.emit('throw_result', {
      seat: upcoming.seat,
      team: upcoming.team,
      bagId: sim.bagId,
      inning: upcoming.inning,
      fromEnd: upcoming.fromEnd,
      targetEnd: 1 - upcoming.fromEnd,
      gesture,
      seed,
      status: sim.status,
      foul: sim.foul ?? null,
      updates: sim.updates,
      landing: sim.landing,
      resting: sim.resting,
      flight: sim.flight,
      slide: sim.slide,
      holeEvents: sim.holeEvents,
      flightMs: sim.flightMs,
      durationMs: sim.durationMs,
      wind: sim.wind,
      /** What the flick did (null for bots and for phones that send no release). */
      release: release ? { ...release.effect, aimed: release.aimed } : null,
      cues,
    });
    this.afterEngineEvents((1 - upcoming.fromEnd) as 0 | 1, events, sim.durationMs + this.timing.reactionMs);
  }

  /** Publish inning/match results and schedule the next turn. `targetEnd` is the board that was thrown at. */
  private afterEngineEvents(targetEnd: 0 | 1, events: EngineEvent[], delayMs: number): void {
    let extra = 0;
    let finished = false;
    for (const event of events) {
      if (event.type === 'inning_complete') {
        extra = this.timing.inningEndMs;
        this.positions.clear();
        const r = event.result;
        for (const bag of r.finalBags) {
          if (bag.status === 'hole') this.seatStats[bag.seat].holes++;
          else if (bag.status === 'board') this.seatStats[bag.seat].boards++;
        }
        this.emit('inning_complete', { result: r });
        if (r.scoringTeam) {
          const led: LedCue = scoreCue(targetEnd, this.teamColorHex()[r.scoringTeam]);
          this.emit('score', { team: r.scoringTeam, points: r.scored, scores: r.scoreAfter, led });
        }
      } else if (event.type === 'match_complete') {
        finished = true;
        this.finalReason = event.reason;
        const led = victoryCue(targetEnd, this.teamColorHex()[event.winner]);
        this.phase = 'finished';
        this.emit('match_end', { winner: event.winner, reason: event.reason, scores: event.scores, led });
      }
    }
    if (finished) {
      this.clearAllTimers();
      this.emit('phase', { phase: this.phase, deadlineAt: null });
      if (!this.ranked) this.openRematch();
      this.finish();
      return;
    }
    this.setTimer('turn', delayMs + extra, () => this.beginTurn());
  }

  // ------------------------------------------------- connection and leaving

  /** Called by the realtime layer when a player's socket opens or closes. */
  setConnected(playerId: string, connected: boolean): void {
    const player = this.players.get(playerId);
    if (!player || player.left) return;
    if (player.connected === connected) return;
    player.connected = connected;
    this.touch();
    const key = `grace:${playerId}`;
    if (connected) {
      this.clearTimer(key);
      const seat = this.seat(player.seat);
      if (seat.controlledByBot) {
        seat.controlledByBot = false;
        this.idleStreak[seat.id] = 0;
        this.emit('seat_reclaimed', { seat: seat.id });
      }
    } else if (this.phase !== 'finished' && this.phase !== 'abandoned' && this.phase !== 'lobby') {
      this.armGrace(player);
      this.hooks.onPlayerAway?.(this, playerId);
    }
    this.emit('seats', { seats: this.seatsView() });
    this.checkAbandon();
  }

  /** Explicit leave. In the lobby the seat frees up; once picks begin a bot takes over at once. */
  leave(playerId: string): void {
    const player = this.requirePlayer(playerId);
    this.touch();
    if (this.phase === 'lobby') {
      const seat = this.seat(player.seat);
      player.left = true;
      if (player.host) {
        this.abandon('host_left');
        return;
      }
      seat.playerId = null;
      seat.name = null;
      this.emit('seats', { seats: this.seatsView() });
      return;
    }
    if (this.phase === 'finished') {
      if (this.rematch) this.voteRematch(playerId, false);
      return;
    }
    if (this.phase === 'abandoned') return;
    player.left = true;
    this.takeOver(player, 'left');
  }

  /** Start the reconnect clock for a player who is not connected: when it runs out a bot plays their seat. */
  private armGrace(player: Player): void {
    if (player.left || player.connected || this.isOver) return;
    this.setTimer(`grace:${player.id}`, this.timing.reconnectGraceMs, () => this.takeOver(player, 'disconnect'));
  }

  private takeOver(player: Player, reason: 'left' | 'disconnect' | 'idle'): void {
    if (this.phase === 'finished' || this.phase === 'abandoned') return;
    const seat = this.seat(player.seat);
    if (seat.controlledByBot) return;
    this.clearTimer(`grace:${player.id}`);
    if (this.ranked) {
      this.forfeitBy(player, reason);
      return;
    }
    seat.controlledByBot = true;
    this.emit('seat_takeover', { seat: seat.id, reason });
    this.emit('seats', { seats: this.seatsView() });

    if (this.phase === 'characters') this.maybeFinishCharacters();
    if (this.phase === 'colors') this.maybeFinishColors();
    // If it is this seat's turn right now, the bot throws instead of waiting out the clock.
    if (this.phase === 'playing' && this.turn && this.turn.seat === seat.id && this.turn.controlledBy === 'human') {
      this.turn.controlledBy = 'bot';
      this.turn.deadlineAt = null;
      this.emit('turn_control', { seat: seat.id, controlledBy: 'bot' });
      this.scheduleBotThrow();
    }
    this.checkAbandon();
  }

  /**
   * Ranked: nobody plays a walked-out seat for them. Their whole team loses. If the match had not
   * really started, it is cancelled instead (the results screen shows it as voided).
   */
  private forfeitBy(player: Player, reason: 'left' | 'disconnect' | 'idle'): void {
    const seat = this.seat(player.seat);
    seat.controlledByBot = true; // marks them as gone for good in the history
    this.forfeitedBy = player.id;
    this.emit('seat_forfeit', { seat: seat.id, reason });
    this.emit('seats', { seats: this.seatsView() });
    if (this.phase !== 'playing' || !this.engine) {
      this.abandon('forfeit_before_start');
      return;
    }
    this.turn = null;
    const events = this.engine.forfeit(seat.team);
    this.afterEngineEvents(0, events, 0);
  }

  private humansPresent(): boolean {
    return [...this.players.values()].some((p) => !p.left && p.connected);
  }

  private checkAbandon(): void {
    if (this.phase === 'finished' || this.phase === 'abandoned') return;
    const everyoneGone = ![...this.players.values()].some((p) => !p.left);
    if (everyoneGone && this.phase !== 'lobby') {
      this.abandon('all_left');
      return;
    }
    if (this.humansPresent()) this.clearTimer('abandon');
    else if (!this.timers.has('abandon')) {
      this.setTimer('abandon', this.timing.abandonAfterMs, () => this.abandon('no_players'));
    }
  }

  private abandon(reason: string): void {
    if (this.phase === 'finished' || this.phase === 'abandoned') return;
    this.phase = 'abandoned';
    this.finalReason = 'abandoned';
    this.clearAllTimers();
    this.turn = null;
    this.emit('match_abandoned', { reason });
    this.emit('phase', { phase: this.phase, deadlineAt: null });
    this.finish();
  }

  /** Tell the outside world the match is over. Only ever once. */
  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    try {
      this.hooks.onEnded?.(this);
    } catch {
      // saving results must never break the match
    }
  }

  // -------------------------------------------------------------------- views

  private teamColorHex(): Record<TeamId, string> {
    const hex = (team: TeamId): string => BAG_COLORS.find((c) => c.id === this.colors[team])?.hex ?? '#FFFFFF';
    return { A: hex('A'), B: hex('B') };
  }

  private seatsView(): MatchView['seats'] {
    return this.seats.map((s) => {
      const player = s.playerId ? this.players.get(s.playerId) : undefined;
      return {
        id: s.id,
        team: s.team,
        startEnd: s.startEnd,
        kind: s.kind,
        botLevel: s.kind === 'bot' || s.controlledByBot ? s.botLevel : null,
        name: s.name ?? (s.characterId ? (CHARACTERS.find((c) => c.id === s.characterId)?.name ?? null) : null),
        claimed: s.kind === 'bot' ? true : Boolean(s.playerId),
        connected: s.kind === 'bot' ? true : Boolean(player?.connected && !player.left),
        accountId: s.kind === 'human' ? s.playerId : null,
        characterId: s.characterId,
        controlledByBot: s.kind === 'bot' || s.controlledByBot,
      };
    });
  }

  view(playerId?: string): MatchView {
    const engine = this.engine;
    const snap = engine?.snapshot();
    const next = engine && !engine.finished ? engine.next() : null;
    const player = playerId ? this.players.get(playerId) : undefined;
    const turn = this.turn && next
      ? {
          seat: this.turn.seat,
          team: this.turn.team,
          bagId: this.turn.bagId,
          controlledBy: this.turn.controlledBy,
          deadlineAt: this.turn.deadlineAt,
          fromEnd: next.fromEnd,
          targetEnd: (1 - next.fromEnd) as 0 | 1,
          throwNumber: next.throwNumber,
          bagsLeft: next.bagsLeft,
          wind: relativeWind(this.wind, next.fromEnd),
        }
      : null;
    return {
      id: this.id,
      protocol: PROTOCOL_VERSION,
      seq: this.seq,
      createdAt: this.createdAt,
      rematchOf: this.rematchOf,
      phase: this.phase,
      config: this.config,
      seats: this.seatsView(),
      colors: { ...this.colors },
      deadlineAt: this.phaseDeadline,
      scores: snap ? { ...snap.scores } : { A: 0, B: 0 },
      inning: snap?.inning ?? 0,
      firstTeam: snap?.firstTeam ?? null,
      turn,
      board: (snap?.bags ?? [])
        .filter((b) => b.status !== 'ground')
        .map((b) => {
          const pos = b.status === 'board' ? this.positions.get(b.id) : undefined;
          return { id: b.id, team: b.team, status: b.status as 'board' | 'hole', x: pos?.x ?? null, y: pos?.y ?? null };
        }),
      history: snap?.history ?? [],
      winner: snap?.winner ?? null,
      winReason: this.phase === 'abandoned' ? 'abandoned' : (snap?.winReason ?? null),
      rematch: this.rematch ? { ...this.rematch, votes: { ...this.rematch.votes } } : null,
      wind: this.windInning > 0 ? { ...this.wind } : null,
      ranked: this.ranked,
      ratings: this.ratingResult
        ? {
            voided: this.ratingResult.voided,
            you: this.ratingResult.updates.find((u) => u.accountId === playerId) ?? null,
            players: this.ratingResult.updates,
          }
        : null,
      you: player && !player.left ? { playerId: player.id, seat: player.seat, team: SEAT_TEAM[player.seat], host: player.host } : null,
    };
  }

  eventsSince(seq: number): SessionEvent[] {
    return this.log.filter((e) => e.seq > seq);
  }

  /** Latest event number. A client whose `since` is higher than this missed a server restart and must reload the view. */
  get seqNumber(): number {
    return this.seq;
  }

  // ----------------------------------------------------------------- rematch

  private humansEligibleForRematch(): Player[] {
    return [...this.players.values()].filter((p) => !p.left && this.seat(p.seat).kind === 'human');
  }

  private openRematch(): void {
    if (this.rematch || this.phase !== 'finished') return;
    const deadlineAt = this.sched.now() + this.timing.rematchWindowMs;
    this.rematch = { deadlineAt, votes: {}, matchId: null, cancelled: false };
    this.setTimer('rematch', this.timing.rematchWindowMs, () => this.closeRematch());
    this.emit('rematch_update', { deadlineAt, votes: {} });
  }

  /** "Play again?" Every human answers yes or no. When all have answered (or the clock runs out) it starts. */
  voteRematch(playerId: string, accept: boolean): void {
    this.requirePlayer(playerId);
    this.requirePhase('finished');
    const state = this.rematch;
    if (!state) throw new DomainError('no_rematch', 'There is no rematch to vote on', 409);
    if (state.matchId || state.cancelled) throw new DomainError('rematch_closed', 'The rematch has already been decided', 409);
    state.votes[playerId] = accept;
    this.touch();
    this.emit('rematch_update', { deadlineAt: state.deadlineAt, votes: { ...state.votes } });
    const everyoneAnswered = this.humansEligibleForRematch().every((p) => p.id in state.votes);
    if (everyoneAnswered) this.closeRematch();
  }

  private closeRematch(): void {
    const state = this.rematch;
    if (!state || state.matchId || state.cancelled) return;
    this.clearTimer('rematch');
    const accepted = this.humansEligibleForRematch().filter((p) => state.votes[p.id] === true);
    if (accepted.length === 0) {
      state.cancelled = true;
      this.emit('rematch_cancelled', { reason: 'nobody_accepted' });
      return;
    }
    const create = this.hooks.createRematch;
    if (!create) {
      state.cancelled = true;
      this.emit('rematch_cancelled', { reason: 'unavailable' });
      return;
    }
    const acceptedIds = new Set(accepted.map((p) => p.id));
    const host = accepted.find((p) => p.host) ?? accepted[0]!;
    const seed: RematchSeed = {
      config: this.config,
      rematchOf: this.id,
      colors: { ...this.colors },
      players: accepted.map((p) => ({ id: p.id, seat: p.seat, name: p.name, host: p.id === host.id })),
      // A human who did not say yes is replaced by a bot; everyone keeps their character.
      seats: this.seats.map((seat) => ({
        ...seat,
        kind: seat.kind === 'human' && !(seat.playerId && acceptedIds.has(seat.playerId)) ? 'bot' : seat.kind,
        playerId: seat.playerId && acceptedIds.has(seat.playerId) ? seat.playerId : null,
        name: seat.playerId && acceptedIds.has(seat.playerId) ? seat.name : null,
        controlledByBot: false,
      })),
    };
    try {
      state.matchId = create(this, seed);
      this.emit('rematch_ready', { matchId: state.matchId });
    } catch (e) {
      state.cancelled = true;
      this.emit('rematch_cancelled', { reason: e instanceof DomainError ? e.code : 'unavailable' });
    }
  }

  /** Builds the follow-up match from a finished one. Call `beginRematch()` on it once it is registered. */
  static fromRematch(opts: Omit<SessionOptions, 'config' | 'seatPlan' | 'rematchOf'>, seed: RematchSeed): MatchSession {
    const session = new MatchSession({ ...opts, config: seed.config, rematchOf: seed.rematchOf });
    session.seats = seed.seats.map((seat) => ({ ...seat }));
    for (const p of seed.players) {
      session.players.set(p.id, { id: p.id, seat: p.seat, name: p.name, connected: false, host: p.host, left: false });
    }
    session.colors = { ...seed.colors };
    return session;
  }

  /** Skips the picks (everyone keeps their character and color) and goes straight to the coin toss. */
  beginRematch(): void {
    if (this.phase !== 'lobby') return;
    this.emit('seats', { seats: this.seatsView() });
    for (const p of this.players.values()) this.armGrace(p);
    this.enterToss(this.timing.rematchTossMs);
  }

  // ---------------------------------------------------------- saving and history

  /** Who is in this match and how they did. Null if it never got as far as playing. */
  summary(): MatchSummary | null {
    if (!this.ended || !this.startedAt) return null;
    const snap = this.engine?.snapshot();
    const players: PlayerSummary[] = this.seats.map((seat) => {
      const player = seat.playerId ? this.players.get(seat.playerId) : undefined;
      const human = seat.kind === 'human' && player !== undefined;
      const stats = this.seatStats[seat.id];
      return {
        seat: seat.id,
        team: seat.team,
        accountId: human ? player.id : null,
        displayName: human ? player.name : (CHARACTERS.find((c) => c.id === seat.characterId)?.name ?? 'Bot'),
        kind: human ? 'human' : 'bot',
        botLevel: human ? null : seat.botLevel,
        characterId: seat.characterId,
        // Gone for good: left on purpose, or dropped and never came back before the end.
        leftEarly: human && (player.left || seat.controlledByBot),
        throws: stats.throws,
        holes: stats.holes,
        boards: stats.boards,
        fouls: stats.fouls,
      };
    });
    return {
      code: this.id,
      config: this.config,
      createdAt: new Date(this.createdAt),
      startedAt: new Date(this.startedAt),
      endedAt: new Date(this.sched.now()),
      outcome: this.finalReason ?? 'abandoned',
      winner: snap?.winner ?? null,
      scores: snap ? { ...snap.scores } : { A: 0, B: 0 },
      innings: snap?.history.length ?? 0,
      rematchOf: this.rematchOf,
      ranked: this.ranked,
      players,
    };
  }

  /** A copy of the live match that can be saved and later restored. Only meaningful while it is running. */
  snapshot(): SessionSnapshot {
    return structuredClone({
      version: 1 as const,
      id: this.id,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      rematchOf: this.rematchOf,
      config: this.config,
      phase: this.phase,
      phaseDeadline: this.phaseDeadline,
      seats: this.seats,
      players: [...this.players.values()].map((p) => ({ id: p.id, seat: p.seat, name: p.name, host: p.host, left: p.left })),
      colors: this.colors,
      engine: this.engine?.snapshot() ?? null,
      positions: [...this.positions.entries()],
      turn: this.turn,
      seq: this.seq,
      seatStats: this.seatStats,
      lastActivity: this.lastActivity,
      ranked: this.ranked,
      wind: this.wind,
      windInning: this.windInning,
      idleStreak: this.idleStreak,
    });
  }

  /** Rebuilds a match from a snapshot. Call `resume()` once it is registered to get its timers going again. */
  static restore(snap: SessionSnapshot, opts: Omit<SessionOptions, 'id' | 'config' | 'seatPlan' | 'createdAt' | 'rematchOf'>): MatchSession {
    if (snap.version !== 1) throw new Error(`Unknown snapshot version ${String(snap.version)}`);
    if (snap.phase === 'finished' || snap.phase === 'abandoned') throw new Error('Finished matches are not restored');
    const data = structuredClone(snap);
    const session = new MatchSession({ ...opts, id: data.id, config: { ...data.config, wind: data.config.wind ?? 'breezy' }, createdAt: data.createdAt, rematchOf: data.rematchOf, ranked: data.ranked ?? null });
    session.startedAt = data.startedAt;
    session.phase = data.phase;
    session.phaseDeadline = data.phaseDeadline;
    session.seats = data.seats;
    session.colors = data.colors;
    session.engine = data.engine ? MatchEngine.restore(data.engine) : null;
    session.positions = new Map(data.positions);
    session.turn = data.turn;
    session.seq = data.seq;
    session.seatStats = data.seatStats;
    session.lastActivity = data.lastActivity;
    session.wind = data.wind ?? { ...CALM };
    session.windInning = data.windInning ?? 0;
    session.idleStreak = data.idleStreak ?? { A1: 0, B1: 0, A2: 0, B2: 0 };
    for (const p of data.players) session.players.set(p.id, { ...p, connected: false });
    return session;
  }

  /**
   * After a restart nobody is connected yet. Give everyone the usual 30 seconds to reconnect, keep
   * pick timers and turn clocks running (never less than a few seconds so people can get back in),
   * and carry on from where the match was.
   */
  resume(): void {
    const now = this.sched.now();
    const floor = 8000;
    if (this.phase !== 'lobby') for (const p of this.players.values()) this.armGrace(p);

    switch (this.phase) {
      case 'lobby':
        this.checkAbandon();
        break;
      case 'characters': {
        const remaining = Math.min(this.timing.characterPickMs, Math.max(floor, (this.phaseDeadline ?? now) - now));
        this.phaseDeadline = now + remaining;
        this.setTimer('phase', remaining, () => this.finishCharacters());
        break;
      }
      case 'colors': {
        const remaining = Math.min(this.timing.colorPickMs, Math.max(floor, (this.phaseDeadline ?? now) - now));
        this.phaseDeadline = now + remaining;
        this.setTimer('phase', remaining, () => this.finishColors());
        break;
      }
      case 'toss':
        this.setTimer('phase', 3000, () => this.startPlaying());
        break;
      case 'playing': {
        const turn = this.turn;
        if (!turn) {
          this.setTimer('turn', 3000, () => this.beginTurn());
        } else if (turn.controlledBy === 'bot') {
          this.scheduleBotThrow();
        } else if (this.config.throwTimerSec) {
          const deadline = Math.max(turn.deadlineAt ?? 0, now + floor);
          turn.deadlineAt = deadline;
          this.setTimer('turn', deadline - now, () => this.onThrowTimeout());
        }
        break;
      }
      default:
        break;
    }
    this.emit('resumed', { phase: this.phase });
  }

  // ------------------------------------------------------------- lobby queries

  hasActivePlayer(accountId: string): boolean {
    const p = this.players.get(accountId);
    return Boolean(p && !p.left && !this.isOver);
  }

  seatOf(accountId: string): SeatId | null {
    const p = this.players.get(accountId);
    return p && !p.left ? p.seat : null;
  }

  get hostName(): string | null {
    return [...this.players.values()].find((p) => p.host && !p.left)?.name ?? null;
  }

  /** Human account ids currently sitting in this match. */
  activeAccountIds(): string[] {
    return [...this.players.values()].filter((p) => !p.left).map((p) => p.id);
  }

  invitePreview(): InvitePreview {
    const openSeats = this.seats.filter((s) => s.kind === 'human' && !s.playerId).map((s) => s.id);
    return {
      code: this.id,
      hostName: this.hostName,
      mode: this.config.mode,
      playTo: this.config.playTo,
      phase: this.phase,
      openSeats,
      canJoin: this.phase === 'lobby' && openSeats.length > 0,
    };
  }

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  /** Is this player's phone connected right now? */
  isConnected(playerId: string): boolean {
    return this.players.get(playerId)?.connected === true;
  }

  get isRanked(): boolean {
    return this.ranked !== null;
  }

  get isOver(): boolean {
    return this.phase === 'finished' || this.phase === 'abandoned';
  }

  get outcome(): WinReason | 'abandoned' | null {
    return this.finalReason;
  }

  /** Stop every timer. The registry calls this when it drops the match. */
  dispose(): void {
    this.clearAllTimers();
    this.listeners.clear();
  }

  // ----------------------------------------------------------------- plumbing

  private emit(type: string, data: Record<string, unknown>): void {
    const event: SessionEvent = { seq: ++this.seq, at: this.sched.now(), type, data };
    // Live listeners get the full animation frames; the replay log keeps only the outcome, so a
    // long match does not hold megabytes of frames in memory.
    if (type === 'throw_result') {
      const { flight: _flight, slide: _slide, ...outcome } = data;
      void _flight;
      void _slide;
      this.log.push({ ...event, data: { ...outcome, framesOmitted: true } });
    } else {
      this.log.push(event);
    }
    if (this.log.length > EVENT_LOG_LIMIT) this.log.splice(0, this.log.length - EVENT_LOG_LIMIT);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must never break the match.
      }
    }
    try {
      this.hooks.onChange?.(this);
    } catch {
      // saving must never break the match
    }
  }

  private touch(): void {
    this.lastActivity = this.sched.now();
  }

  private seat(id: SeatId): SeatState {
    const seat = this.seats.find((s) => s.id === id);
    if (!seat) throw new DomainError('bad_seat', `No seat ${id}`);
    return seat;
  }

  private requirePlayer(playerId: string): Player {
    const player = this.players.get(playerId);
    if (!player || player.left) throw new DomainError('unknown_player', 'Unknown player', 404);
    return player;
  }

  private requirePhase(phase: Phase): void {
    if (this.phase !== phase) {
      throw new DomainError('wrong_phase', `This is only allowed during the ${phase} phase (now: ${this.phase})`, 409);
    }
  }

  private setTimer(key: string, ms: number, fn: () => void): void {
    this.clearTimer(key);
    const cancel = this.sched.after(ms, () => {
      this.timers.delete(key);
      fn();
    });
    this.timers.set(key, cancel);
  }

  private clearTimer(key: string): void {
    this.timers.get(key)?.();
    this.timers.delete(key);
  }

  private clearAllTimers(): void {
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
  }
}

/** Convenience for tests and tools: a seeded session rng. */
export const seededRng = (seed: number): Rng => createRng(seed);
