import WebSocket from 'ws';
import type { Booted } from './app.js';

/**
 * A phone-shaped test client for the match protocol.
 *
 * The Unity scripts cannot run in the server test job (the unity-core CI job fails while loading
 * stub Unity DLLs). This harness speaks the same HTTP and WebSocket protocol as `ApiClient` and
 * `MatchSocket`, and applies welcome messages and events with the same rules as `MatchModel` and
 * `ThrowReplay` (`unity/CornholeGreybox/Assets/Scripts/Core/`). A change that would make the phone
 * draw the wrong board, score, turn, or flight shows up here.
 *
 * It is a transcription of that client, including the gaps in it. It is not a second, stricter
 * implementation.
 */

export const CLIENT_HEADERS = { 'x-client-version': '0.1.0', 'x-client-platform': 'ios' };

type Call = Booted['call'];
type Dict = Record<string, unknown>;

export interface Gesture {
  power: number;
  aim: number;
  arc: number;
  spin: number;
}

export interface ReleaseBody {
  angleDeg: number;
  speed: number;
  holdMs: number;
  curve: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface FlightSample {
  t: number;
  x: number;
  y: number;
  z: number;
}

export interface SlideFrame {
  t: number;
  bags: Record<string, Point>;
}

export interface HoleEvent {
  bagId: string | null;
  cause: string | null;
  tMs: number;
}

export interface LedCue {
  pattern: string | null;
  durationMs: number;
  boardEnd: number;
  colors: string[];
}

export interface Cue {
  atMs: number;
  reason: string | null;
  bagId: string | null;
  sound: string | null;
  led: LedCue | null;
}

export interface ReleaseVerdict {
  pushIn: number;
  shortIn: number;
  shake: number;
  spin: number;
  verdict: string;
  aimedAim: number;
  aimedPower: number;
  aimedArc: number;
}

/** What `MatchModel.ParseThrow` keeps. The presenter replays `flight` and `slide` from this. */
export interface ClientThrow {
  seat: string | null;
  team: string | null;
  bagId: string | null;
  status: string | null;
  foul: string | null;
  inning: number;
  fromEnd: number;
  targetEnd: number;
  flightMs: number;
  durationMs: number;
  landing: Point;
  resting: Record<string, Point>;
  updates: Record<string, string>;
  flight: FlightSample[];
  slide: SlideFrame[];
  holeEvents: HoleEvent[];
  cues: Cue[];
  windCross: number;
  windAlong: number;
  driftX: number;
  driftY: number;
  release: ReleaseVerdict | null;
  framesOmitted: boolean;
}

export interface BoardBag {
  id: string | null;
  team: string | null;
  status: string | null;
  x: number;
  y: number;
  hasPosition: boolean;
}

export interface SeatInfo {
  id: string | null;
  team: string | null;
  name: string | null;
  characterId: string | null;
  accountId: string | null;
  kind: string | null;
  botLevel: string | null;
  claimed: boolean;
  connected: boolean;
  controlledByBot: boolean;
  startEnd: number;
}

export interface TurnInfo {
  seat: string | null;
  team: string | null;
  bagId: string | null;
  controlledBy: string;
  deadlineAt: number;
  fromEnd: number;
  targetEnd: number;
  throwNumber: number;
  bagsLeftA: number;
  bagsLeftB: number;
  windMph: number;
  windTowardDeg: number;
  windCross: number;
  windAlong: number;
}

export interface ReplayFrame {
  phase: 'flight' | 'slide' | 'rest';
  bag: Point;
  height: number;
  board: Record<string, Point>;
  inHole: string[];
}

export interface Posted {
  ok: boolean;
  status: number;
  code: string | null;
  body: Dict | null;
}

const dict = (v: unknown): Dict | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : null);
const list = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
const str = (o: unknown, key: string, fallback: string | null = null): string | null => {
  const v = dict(o)?.[key];
  return typeof v === 'string' ? v : fallback;
};
const num = (o: unknown, key: string, fallback = 0): number => {
  const v = dict(o)?.[key];
  return typeof v === 'number' ? v : fallback;
};
const int = (o: unknown, key: string, fallback = 0): number => Math.round(num(o, key, fallback));
const flag = (o: unknown, key: string, fallback = false): boolean => {
  const v = dict(o)?.[key];
  return typeof v === 'boolean' ? v : fallback;
};
const has = (o: unknown, key: string): boolean => {
  const d = dict(o);
  return d != null && Object.prototype.hasOwnProperty.call(d, key) && d[key] != null;
};
const child = (o: unknown, key: string): Dict | null => dict(dict(o)?.[key]);
const childList = (o: unknown, key: string): unknown[] | null => list(dict(o)?.[key]);
const point = (o: unknown): Point => ({ x: num(o, 'x'), y: num(o, 'y') });

/** `MatchModel`, plus the lists of throws and scores the screen is told about. */
export class ClientModel {
  id: string | null = null;
  seq = 0;
  phase = 'lobby';
  mode = '1v1';
  playTo = 21;
  windSetting = 'breezy';
  deadlineAt = 0;
  inning = 0;
  scoreA = 0;
  scoreB = 0;
  firstTeam: string | null = null;
  winner: string | null = null;
  winReason: string | null = null;
  youSeat: string | null = null;
  youTeam: string | null = null;
  youId: string | null = null;
  youAreHost = false;
  windMph = 0;
  turn: TurnInfo | null = null;
  seats: SeatInfo[] = [];
  colors: Record<string, string> = {};
  board = new Map<string, BoardBag>();
  lastThrow: ClientThrow | null = null;
  /** The board just before `lastThrow` was applied. `ThrowReplay.At` starts from this. */
  boardBeforeLastThrow = new Map<string, BoardBag>();
  needsRefresh = false;
  /** Every throw that raises `ThrowResultReceived`. The presenter starts a replay for each one. */
  presented: ClientThrow[] = [];
  scoreLog: Array<{ team: string | null; points: number }> = [];
  /** Wire event, kept so a test can tell a parsed throw from the JSON the server sent. */
  rawThrow: Dict | null = null;

  get isMyTurn(): boolean {
    return this.turn != null && this.turn.controlledBy === 'human' && this.turn.seat === this.youSeat && this.phase === 'playing';
  }

  get isOver(): boolean {
    return this.phase === 'finished' || this.phase === 'abandoned';
  }

  seat(id: string): SeatInfo | null {
    return this.seats.find((s) => s.id === id) ?? null;
  }

  /** `MatchModel.ApplyView`. */
  applyView(v: Dict, youAccountId: string): void {
    this.id = str(v, 'id', this.id);
    this.seq = int(v, 'seq', this.seq);
    this.phase = str(v, 'phase', this.phase) ?? this.phase;
    this.deadlineAt = num(v, 'deadlineAt', 0);
    const cfg = child(v, 'config');
    if (cfg) {
      this.mode = str(cfg, 'mode', this.mode) ?? this.mode;
      this.playTo = int(cfg, 'playTo', this.playTo);
      this.windSetting = str(cfg, 'wind', this.windSetting) ?? this.windSetting;
    }
    const scores = child(v, 'scores');
    this.scoreA = num(scores, 'A');
    this.scoreB = num(scores, 'B');
    this.inning = int(v, 'inning');
    this.firstTeam = str(v, 'firstTeam');
    this.winner = str(v, 'winner');
    this.winReason = str(v, 'winReason');
    this.youId = youAccountId;
    const you = child(v, 'you');
    this.youSeat = str(you, 'seat');
    this.youTeam = str(you, 'team');
    this.youAreHost = flag(you, 'host');
    const wind = child(v, 'wind');
    if (wind) this.windMph = num(wind, 'mph');
    this.seats = parseSeats(childList(v, 'seats'));
    this.colors = {};
    const colors = child(v, 'colors');
    if (colors) {
      for (const [key, value] of Object.entries(colors)) if (typeof value === 'string') this.colors[key] = value;
    }
    const turn = child(v, 'turn');
    this.turn = turn ? parseTurn(turn) : null;
    this.board = new Map();
    for (const b of childList(v, 'board') ?? []) {
      const bag: BoardBag = { id: str(b, 'id'), team: str(b, 'team'), status: str(b, 'status'), x: 0, y: 0, hasPosition: false };
      if (has(b, 'x')) {
        bag.x = num(b, 'x');
        bag.y = num(b, 'y');
        bag.hasPosition = true;
      }
      if (bag.id) this.board.set(bag.id, bag);
    }
    this.needsRefresh = false;
  }

  /** `MatchModel.ApplyEvent`. */
  applyEvent(e: Dict): void {
    const seq = int(e, 'seq');
    if (seq <= this.seq) return;
    if (seq !== this.seq + 1) this.needsRefresh = true;
    this.seq = seq;
    const type = str(e, 'type');
    const data = child(e, 'data');
    switch (type) {
      case 'phase':
        this.phase = str(data, 'phase', this.phase) ?? this.phase;
        this.deadlineAt = num(data, 'deadlineAt', 0);
        if (this.phase !== 'playing') this.turn = null;
        break;
      case 'seats':
        this.seats = parseSeats(childList(data, 'seats'));
        break;
      case 'coin_toss':
        this.firstTeam = str(data, 'firstTeam');
        break;
      case 'color_picked': {
        const team = str(data, 'team');
        const colorId = str(data, 'colorId');
        if (team && colorId) this.colors[team] = colorId;
        break;
      }
      case 'wind':
        this.windMph = num(child(data, 'wind'), 'mph');
        break;
      case 'turn_start':
        this.turn = data ? parseTurn(data) : null;
        this.inning = int(data, 'inning', this.inning);
        if (this.phase !== 'playing') this.phase = 'playing';
        break;
      case 'turn_control':
        if (this.turn && this.turn.seat === str(data, 'seat')) this.turn.controlledBy = str(data, 'controlledBy', this.turn.controlledBy) ?? this.turn.controlledBy;
        break;
      case 'throw_result': {
        const parsed = parseThrow(data ?? {});
        this.lastThrow = parsed;
        this.rawThrow = data;
        this.turn = null;
        this.boardBeforeLastThrow = copyBoard(this.board);
        applyBoard(this.board, parsed);
        this.presented.push(parsed);
        break;
      }
      case 'throw_timeout':
        this.turn = null;
        break;
      case 'inning_complete': {
        const after = child(child(data, 'result'), 'scoreAfter');
        if (after) {
          this.scoreA = num(after, 'A', this.scoreA);
          this.scoreB = num(after, 'B', this.scoreB);
        }
        this.board = new Map();
        break;
      }
      case 'score': {
        const scores = child(data, 'scores');
        if (scores) {
          this.scoreA = num(scores, 'A', this.scoreA);
          this.scoreB = num(scores, 'B', this.scoreB);
        }
        this.scoreLog.push({ team: str(data, 'team'), points: num(data, 'points') });
        break;
      }
      case 'match_end':
        this.winner = str(data, 'winner');
        this.winReason = str(data, 'reason');
        {
          const end = child(data, 'scores');
          if (end) {
            this.scoreA = num(end, 'A', this.scoreA);
            this.scoreB = num(end, 'B', this.scoreB);
          }
        }
        this.turn = null;
        break;
      case 'match_abandoned':
        this.winReason = 'abandoned';
        break;
      case 'character_picked':
      case 'kicked':
      case 'seat_reclaimed':
      case 'resumed':
        // MatchModel.ApplyEvent ignores these. character_picked is the one the pick screen needed.
        break;
      default:
        break;
    }
  }
}

function copyBoard(board: Map<string, BoardBag>): Map<string, BoardBag> {
  const copy = new Map<string, BoardBag>();
  for (const [id, bag] of board) copy.set(id, { ...bag });
  return copy;
}

/** `MatchModel.ApplyBoard`. */
function applyBoard(board: Map<string, BoardBag>, t: ClientThrow): void {
  for (const [id, status] of Object.entries(t.updates)) {
    if (status === 'ground') board.delete(id);
    else {
      const bag = board.get(id);
      if (bag) bag.status = status;
    }
  }
  if (t.bagId) {
    if (t.status === 'ground') board.delete(t.bagId);
    else {
      let bag = board.get(t.bagId);
      if (!bag) {
        bag = { id: t.bagId, team: t.team, status: t.status, x: 0, y: 0, hasPosition: false };
        board.set(t.bagId, bag);
      }
      bag.status = t.status;
    }
  }
  for (const [id, pos] of Object.entries(t.resting)) {
    const bag = board.get(id);
    if (bag) {
      bag.x = pos.x;
      bag.y = pos.y;
      bag.hasPosition = true;
      bag.status = 'board';
    }
  }
}

function parseTurn(t: Dict): TurnInfo {
  const bags = child(t, 'bagsLeft');
  const wind = child(t, 'wind');
  return {
    seat: str(t, 'seat'),
    team: str(t, 'team'),
    bagId: str(t, 'bagId'),
    controlledBy: str(t, 'controlledBy', 'human') ?? 'human',
    deadlineAt: num(t, 'deadlineAt', 0),
    fromEnd: int(t, 'fromEnd'),
    targetEnd: int(t, 'targetEnd'),
    throwNumber: int(t, 'throwNumber'),
    bagsLeftA: int(bags, 'A'),
    bagsLeftB: int(bags, 'B'),
    windMph: num(wind, 'mph'),
    windTowardDeg: num(wind, 'towardDeg'),
    windCross: num(wind, 'cross'),
    windAlong: num(wind, 'along'),
  };
}

function parseSeats(listValue: unknown[] | null): SeatInfo[] {
  if (!listValue) return [];
  return listValue.map((s) => ({
    id: str(s, 'id'),
    team: str(s, 'team'),
    name: str(s, 'name'),
    characterId: str(s, 'characterId'),
    accountId: str(s, 'accountId'),
    kind: str(s, 'kind'),
    botLevel: str(s, 'botLevel'),
    claimed: flag(s, 'claimed'),
    connected: flag(s, 'connected'),
    controlledByBot: flag(s, 'controlledByBot'),
    startEnd: int(s, 'startEnd'),
  }));
}

/**
 * `MatchModel.ParseThrow`. Slide samples are the server's `[x, y]` pairs. Anything else is dropped,
 * which is what the C# reader does (`xy[0] is double`).
 */
export function parseThrow(d: Dict): ClientThrow {
  const t: ClientThrow = {
    seat: str(d, 'seat'),
    team: str(d, 'team'),
    bagId: str(d, 'bagId'),
    status: str(d, 'status'),
    foul: str(d, 'foul'),
    inning: int(d, 'inning'),
    fromEnd: int(d, 'fromEnd'),
    targetEnd: int(d, 'targetEnd'),
    flightMs: num(d, 'flightMs'),
    durationMs: num(d, 'durationMs'),
    landing: point(child(d, 'landing')),
    resting: {},
    updates: {},
    flight: [],
    slide: [],
    holeEvents: [],
    cues: [],
    windCross: 0,
    windAlong: 0,
    driftX: 0,
    driftY: 0,
    release: null,
    framesOmitted: flag(d, 'framesOmitted'),
  };
  const resting = child(d, 'resting');
  if (resting) for (const [id, value] of Object.entries(resting)) t.resting[id] = point(value);
  const updates = child(d, 'updates');
  if (updates) for (const [id, value] of Object.entries(updates)) if (typeof value === 'string') t.updates[id] = value;
  for (const f of childList(d, 'flight') ?? []) {
    t.flight.push({ t: num(f, 't'), x: num(f, 'x'), y: num(f, 'y'), z: num(f, 'z') });
  }
  for (const f of childList(d, 'slide') ?? []) {
    const frame: SlideFrame = { t: num(f, 't'), bags: {} };
    const bags = child(f, 'bags');
    if (bags) {
      for (const [id, value] of Object.entries(bags)) {
        if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
          frame.bags[id] = { x: value[0], y: value[1] };
        }
      }
    }
    t.slide.push(frame);
  }
  for (const h of childList(d, 'holeEvents') ?? []) {
    t.holeEvents.push({ bagId: str(h, 'bagId'), cause: str(h, 'cause'), tMs: num(h, 'tMs') });
  }
  for (const c of childList(d, 'cues') ?? []) {
    const led = child(c, 'led');
    const cue: Cue = { atMs: num(c, 'atMs'), reason: str(c, 'reason'), bagId: str(c, 'bagId'), sound: str(c, 'sound'), led: null };
    if (led) {
      cue.led = { pattern: str(led, 'pattern'), durationMs: num(led, 'durationMs'), boardEnd: int(led, 'boardEnd'), colors: [] };
      for (const color of childList(led, 'colors') ?? []) if (typeof color === 'string') cue.led.colors.push(color);
    }
    t.cues.push(cue);
  }
  const wind = child(d, 'wind');
  if (wind) {
    t.windCross = num(wind, 'cross');
    t.windAlong = num(wind, 'along');
    t.driftX = num(wind, 'driftX');
    t.driftY = num(wind, 'driftY');
  }
  const rel = child(d, 'release');
  if (rel) {
    const aimed = child(rel, 'aimed');
    t.release = {
      pushIn: num(rel, 'pushIn'),
      shortIn: num(rel, 'shortIn'),
      shake: num(rel, 'shake', 1),
      spin: num(rel, 'spin'),
      verdict: str(rel, 'verdict', 'pure') ?? 'pure',
      aimedAim: num(aimed, 'aim'),
      aimedPower: num(aimed, 'power'),
      aimedArc: num(aimed, 'arc'),
    };
  }
  return t;
}

/** `ThrowReplay.At`. `tMs` is milliseconds since release. */
export function replayAt(r: ClientThrow, tMs: number, boardBefore: Map<string, BoardBag>): ReplayFrame {
  const frame: ReplayFrame = { phase: 'flight', bag: { x: 0, y: 0 }, height: 0, board: {}, inHole: [] };
  for (const [id, bag] of boardBefore) {
    if (bag.hasPosition && bag.status === 'board') frame.board[id] = { x: bag.x, y: bag.y };
  }
  if (tMs < r.flightMs) {
    frame.phase = 'flight';
    if (r.flight.length === 0) {
      frame.bag = r.landing;
      return frame;
    }
    const s = sampleFlight(r.flight, tMs);
    frame.bag = { x: s.x, y: s.y };
    frame.height = s.z;
    return frame;
  }
  frame.phase = tMs >= r.durationMs ? 'rest' : 'slide';
  frame.height = 0;
  frame.bag = r.landing;
  if (r.bagId) frame.board[r.bagId] = r.landing;
  const sinceTouch = tMs - r.flightMs;
  for (const slide of r.slide) {
    if (slide.t > sinceTouch) break;
    for (const [id, pos] of Object.entries(slide.bags)) frame.board[id] = pos;
  }
  if (frame.phase === 'rest') {
    for (const [id, pos] of Object.entries(r.resting)) frame.board[id] = pos;
  }
  if (r.bagId && frame.board[r.bagId]) frame.bag = frame.board[r.bagId]!;
  for (const h of r.holeEvents) {
    if (h.tMs <= tMs && h.bagId) {
      frame.inHole.push(h.bagId);
      delete frame.board[h.bagId];
    }
  }
  return frame;
}

/** `ThrowReplay.CuesBetween`: cues with `atMs` in `(fromMs, toMs]`. */
export function cuesBetween(r: ClientThrow, fromMs: number, toMs: number): Cue[] {
  return r.cues.filter((c) => c.atMs > fromMs && c.atMs <= toMs);
}

function sampleFlight(flight: FlightSample[], t: number): FlightSample {
  const first = flight[0];
  if (!first) return { t: 0, x: 0, y: 0, z: 0 };
  if (t <= first.t) return first;
  for (let i = 1; i < flight.length; i++) {
    const b = flight[i];
    const a = flight[i - 1];
    if (!a || !b || t > b.t) continue;
    const u = b.t - a.t < 1e-9 ? 1 : (t - a.t) / (b.t - a.t);
    return { t, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
  }
  return flight[flight.length - 1] ?? first;
}

export interface PhoneOptions {
  port: number;
  matchId: string;
  token: string;
  accountId: string;
  call: Call;
}

/**
 * One signed-in phone: a real WebSocket, hello with the last seq, and REST for throws and picks.
 * `sendThrow` is `MatchSession.SendThrowAsync` (it will not post when it is not this seat's turn).
 * `postThrow` skips that local gate so a test can show the server rejects the same throw.
 */
export class Phone {
  readonly model = new ClientModel();
  readonly matchId: string;
  readonly accountId: string;
  lastError: string | null = null;
  throwInFlight = false;
  resynced = 0;
  fault: Error | null = null;

  private readonly port: number;
  private readonly token: string;
  private readonly call: Call;
  private ws: WebSocket | null = null;
  private queue: Promise<void> = Promise.resolve();
  private welcomeSeen = 0;

  constructor(opts: PhoneOptions) {
    this.port = opts.port;
    this.matchId = opts.matchId;
    this.accountId = opts.accountId;
    this.token = opts.token;
    this.call = opts.call;
  }

  /** Connect, say hello, and wait until the welcome has been applied. */
  async connect(): Promise<void> {
    await this.openAndHello();
  }

  /**
   * Drop the socket. The server starts the reconnect clock when a player's last socket closes.
   */
  async disconnect(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    if (!ws || ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close();
    });
    await this.queue;
    await delay(30);
  }

  /** Connect again and hello with this model's seq, the way `MatchSocket` resumes. */
  async reconnect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) await this.disconnect();
    await this.openAndHello();
  }

  /** `MatchSession.SendThrowAsync`. A turn that is not ours never hits the network. */
  async sendThrow(gesture: Gesture, release?: ReleaseBody): Promise<Posted> {
    if (this.throwInFlight || !this.model.isMyTurn) return { ok: false, status: 0, code: 'not_sent', body: null };
    this.throwInFlight = true;
    const posted = await this.postThrow(gesture, release);
    if (!posted.ok) {
      this.throwInFlight = false;
      this.lastError = posted.code;
    }
    return posted;
  }

  async postThrow(gesture: Gesture, release?: ReleaseBody): Promise<Posted> {
    const body: Dict = { ...gesture };
    if (release) body.release = release;
    return this.post(`/api/matches/${this.matchId}/throw`, body);
  }

  async post(path: string, body: Dict): Promise<Posted> {
    const res = await this.call(this.token, 'POST', path, body, CLIENT_HEADERS);
    return readPosted(res.statusCode, safeJson(res));
  }

  /** `MatchSession.PickCharacterAsync`: the returned view is discarded, same as the phone. */
  async pickCharacter(characterId: string): Promise<boolean> {
    const posted = await this.post(`/api/matches/${this.matchId}/character`, { characterId });
    if (!posted.ok) this.lastError = posted.code;
    return posted.ok;
  }

  async pickColor(colorId: string): Promise<boolean> {
    const posted = await this.post(`/api/matches/${this.matchId}/color`, { colorId });
    if (!posted.ok) this.lastError = posted.code;
    return posted.ok;
  }

  async waitFor(pred: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.fault) throw this.fault;
      await this.queue;
      if (pred()) return;
      await delay(10);
    }
    throw new Error(`timed out waiting for ${label} (phase ${this.model.phase}, seq ${this.model.seq}, turn ${this.model.turn?.seat ?? 'none'})`);
  }

  private async openAndHello(): Promise<void> {
    const seen = this.welcomeSeen;
    await this.openSocket();
    await this.waitFor(() => this.welcomeSeen > seen, 'welcome');
  }

  private openSocket(): Promise<void> {
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}/api/matches/${this.matchId}/ws`);
    this.ws = ws;
    ws.on('message', (raw) => {
      this.queue = this.queue.then(() => this.handleText(raw.toString())).catch((err: unknown) => {
        this.fault = err instanceof Error ? err : new Error(String(err));
      });
    });
    return new Promise((resolve, reject) => {
      ws.once('open', () => {
        ws.send(JSON.stringify({ type: 'hello', bearer: this.token, since: this.model.seq, clientVersion: '0.1.0' }));
        resolve();
      });
      ws.once('error', reject);
    });
  }

  /** `MatchSocket.Handle`, including a full-view refresh when event numbers leave a gap. */
  private async handleText(text: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    const msg = dict(parsed);
    if (!msg) return;
    switch (str(msg, 'type')) {
      case 'welcome': {
        const resync = flag(msg, 'resync');
        const view = child(msg, 'view');
        if (!view) return;
        if (this.model.id == null || resync || int(view, 'seq') > this.model.seq + 200) {
          this.model.applyView(view, this.accountId);
          if (resync) this.resynced++;
        } else {
          for (const e of childList(msg, 'missed') ?? []) {
            const ev = dict(e);
            if (ev) this.noteEvent(ev);
          }
          if (this.model.needsRefresh) await this.refresh();
        }
        this.welcomeSeen++;
        break;
      }
      case 'event': {
        const ev = child(msg, 'event');
        if (!ev) return;
        this.noteEvent(ev);
        if (this.model.needsRefresh) await this.refresh();
        break;
      }
      default:
        break;
    }
  }

  /** `MatchSession` clears ThrowInFlight when any throw result arrives. */
  private noteEvent(ev: Dict): void {
    this.model.applyEvent(ev);
    if (str(ev, 'type') === 'throw_result') this.throwInFlight = false;
  }

  private async refresh(): Promise<void> {
    const res = await this.call(this.token, 'GET', `/api/matches/${this.matchId}`, undefined, CLIENT_HEADERS);
    if (res.statusCode !== 200) throw new Error(`refresh failed: ${res.statusCode} ${res.body}`);
    const view = dict(safeJson(res));
    if (!view) throw new Error('refresh returned no view');
    this.model.applyView(view, this.accountId);
    this.resynced++;
  }
}

function readPosted(status: number, body: unknown): Posted {
  const rec = dict(body);
  return { ok: status >= 200 && status < 300, status, code: str(child(rec, 'error'), 'code'), body: rec };
}

function safeJson(res: { json: () => unknown; body?: string }): unknown {
  try {
    return res.json();
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
