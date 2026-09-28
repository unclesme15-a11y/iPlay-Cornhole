import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ABANDON_AFTER_MS,
  BAG_COLORS,
  CHARACTER_PICK_TIMER_MS,
  CHARACTERS,
  COLOR_PICK_TIMER_MS,
  DISTANCE_IN,
  MAX_DISPLAY_NAME_LENGTH,
  RECONNECT_GRACE_MS,
} from '../core/constants.js';
import { DomainError } from '../core/errors.js';
import { MatchEngine, seatsFor } from '../core/match.js';
import { createRng, pick, randomInt, secureRng, secureSeed, type Rng } from '../core/rng.js';
import type {
  EngineEvent,
  InningResult,
  MatchConfig,
  SeatId,
  TeamId,
  WinReason,
} from '../core/types.js';
import { decideThrow, type BotLevel } from '../bots/botPolicy.js';
import { isValidGesture, simulateThrow, type ThrowGesture, type ThrowSimResult } from '../physics/throwSim.js';
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

interface Player {
  id: string;
  seat: SeatId;
  name: string;
  tokenHash: Buffer;
  connected: boolean;
  host: boolean;
  left: boolean;
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
};

const SEAT_TEAM: Record<SeatId, TeamId> = { A1: 'A', B1: 'B', A2: 'A', B2: 'B' };
const SEAT_END: Record<SeatId, 0 | 1> = { A1: 0, B1: 0, A2: 1, B2: 1 };
const EVENT_LOG_LIMIT = 500;

interface Turn {
  seat: SeatId;
  team: TeamId;
  bagId: string;
  controlledBy: 'human' | 'bot';
  deadlineAt: number | null;
}

export interface MatchView {
  id: string;
  seq: number;
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
    characterId: string | null;
    controlledByBot: boolean;
  }>;
  colors: Partial<Record<TeamId, string>>;
  deadlineAt: number | null;
  scores: Record<TeamId, number>;
  inning: number;
  firstTeam: TeamId | null;
  turn: (Omit<Turn, 'controlledBy'> & { controlledBy: 'human' | 'bot'; fromEnd: 0 | 1; targetEnd: 0 | 1; throwNumber: number; bagsLeft: Record<TeamId, number> }) | null;
  board: Array<{ id: string; team: TeamId; status: 'board' | 'hole'; x: number | null; y: number | null }>;
  history: InningResult[];
  winner: TeamId | null;
  winReason: WinReason | 'abandoned' | null;
  you: { playerId: string; seat: SeatId; team: TeamId; host: boolean } | null;
}

export interface Credentials {
  playerId: string;
  token: string;
  seat: SeatId;
}

const hashToken = (token: string): Buffer => createHash('sha256').update(token).digest();

export function cleanName(raw: string): string {
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length === 0) throw new DomainError('bad_name', 'Name is required');
  return name.slice(0, MAX_DISPLAY_NAME_LENGTH);
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

  lastActivity: number;

  constructor(opts: SessionOptions) {
    this.id = opts.id;
    this.config = opts.config;
    this.sched = opts.scheduler;
    this.rng = opts.rng ?? secureRng();
    this.seed = opts.seedSource ?? secureSeed;
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
    this.lastActivity = this.sched.now();

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
  createHost(name: string): Credentials {
    return this.claim('A1', name, true);
  }

  join(name: string, seatId?: SeatId): Credentials {
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
    return this.claim(seat.id, name, false);
  }

  private claim(seatId: SeatId, rawName: string, host: boolean): Credentials {
    const name = cleanName(rawName);
    const seat = this.seat(seatId);
    const playerId = randomBytes(12).toString('hex');
    const token = randomBytes(32).toString('hex');
    this.players.set(playerId, {
      id: playerId,
      seat: seatId,
      name,
      tokenHash: hashToken(token),
      connected: true,
      host,
      left: false,
    });
    seat.playerId = playerId;
    seat.name = name;
    this.touch();
    this.emit('seats', { seats: this.seatsView() });
    return { playerId, token, seat: seatId };
  }

  authenticate(playerId: string, token: string): boolean {
    const player = this.players.get(playerId);
    if (!player || player.left) return false;
    const given = hashToken(token);
    return given.length === player.tokenHash.length && timingSafeEqual(given, player.tokenHash);
  }

  /** Host closes the lobby and starts the pick phases. */
  start(playerId: string): void {
    const player = this.requirePlayer(playerId);
    this.requirePhase('lobby');
    if (!player.host) throw new DomainError('not_host', 'Only the host can start the match', 403);
    const open = this.seats.filter((s) => s.kind === 'human' && !s.playerId);
    if (open.length > 0) {
      throw new DomainError('seats_open', `Waiting for players to fill ${open.map((s) => s.id).join(', ')}`, 409);
    }
    this.touch();
    this.enterCharacters();
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

  private enterToss(): void {
    this.phase = 'toss';
    this.phaseDeadline = null;
    const firstTeam: TeamId = this.rng() < 0.5 ? 'A' : 'B';
    this.engine = new MatchEngine(this.config, firstTeam);
    this.emit('phase', { phase: this.phase, deadlineAt: null });
    this.emit('coin_toss', { firstTeam });
    this.setTimer('phase', this.timing.tossMs, () => {
      this.phase = 'playing';
      this.emit('phase', { phase: this.phase, deadlineAt: null });
      this.beginTurn();
    });
  }

  // -------------------------------------------------------------------- turns

  private beginTurn(): void {
    const engine = this.engine;
    if (!engine || this.phase !== 'playing') return;
    const next = engine.next();
    if (!next) return;
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
    });
    this.performThrow(turn, decision.gesture);
  }

  /** A human throws. The phone sends only the gesture; the server decides everything else. */
  throw(playerId: string, gesture: ThrowGesture): void {
    const player = this.requirePlayer(playerId);
    this.requirePhase('playing');
    const turn = this.turn;
    if (!turn || turn.seat !== player.seat || turn.controlledBy !== 'human') {
      throw new DomainError('not_your_turn', 'It is not your turn to throw', 409);
    }
    if (!isValidGesture(gesture)) throw new DomainError('bad_gesture', 'Throw values are out of range');
    this.touch();
    this.performThrow(turn, gesture);
  }

  private onThrowTimeout(): void {
    const engine = this.engine;
    const turn = this.turn;
    if (!engine || !turn) return;
    this.turn = null;
    this.clearTimer('turn');
    const targetEnd = (1 - engine.next()!.fromEnd) as 0 | 1;
    const events = engine.foulTimeout(turn.seat);
    this.emit('throw_timeout', { seat: turn.seat, bagId: turn.bagId });
    this.afterEngineEvents(targetEnd, events, 1200);
  }

  private performThrow(turn: Turn, gesture: ThrowGesture): void {
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
        this.emit('seat_reclaimed', { seat: seat.id });
      }
    } else if (this.phase !== 'finished' && this.phase !== 'abandoned') {
      this.setTimer(key, this.timing.reconnectGraceMs, () => this.takeOver(player, 'disconnect'));
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
    if (this.phase === 'finished' || this.phase === 'abandoned') return;
    player.left = true;
    this.takeOver(player, 'left');
  }

  private takeOver(player: Player, reason: 'left' | 'disconnect'): void {
    if (this.phase === 'finished' || this.phase === 'abandoned') return;
    const seat = this.seat(player.seat);
    if (seat.controlledByBot) return;
    this.clearTimer(`grace:${player.id}`);
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
        }
      : null;
    return {
      id: this.id,
      seq: this.seq,
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
      you: player && !player.left ? { playerId: player.id, seat: player.seat, team: SEAT_TEAM[player.seat], host: player.host } : null,
    };
  }

  eventsSince(seq: number): SessionEvent[] {
    return this.log.filter((e) => e.seq > seq);
  }

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get currentPhase(): Phase {
    return this.phase;
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
