# API Contract

This is everything the Unity client needs to talk to the server. The server decides every result. The phone sends **only a swipe**, and gets back what happened.

**In plain terms:** the phone says "I swiped this hard, at this angle." The server works out where the bag lands, slides and bumps into other bags, then tells every phone the same story so all of them show the same landing.

Base URL: wherever the server runs (`http://localhost:3000` in dev). JSON everywhere.

## Auth

Creating or joining a match returns a `bearer`. Send it on every action:

```
Authorization: Bearer <bearer>
```

Reading a match (`GET`) works without it and shows the public view. With it, the view also includes `you`. The bearer is a secret: never show it, and don't put it in URLs.

## Errors

Every error has the same shape, and `code` is stable, so switch on the code and not the message:

```json
{ "error": { "code": "color_taken", "message": "hot-pink was taken by Team A" } }
```

| Status | Codes |
|--------|-------|
| 400 | `bad_request` (with `issues`), `bad_config`, `bad_seat`, `bad_name`, `bad_character`, `bad_color`, `bad_gesture` |
| 401 | `unauthorized` |
| 403 | `not_host` |
| 404 | `match_not_found`, `unknown_player`, `not_found` |
| 409 | `wrong_phase`, `not_your_turn`, `match_full`, `seat_taken`, `seat_is_bot`, `seats_open`, `character_taken`, `color_taken`, `team_already_picked` |
| 413 | body over 16 KB |
| 429 | rate limit (slow down) |
| 503 | `server_busy` (too many live matches) |

## Setup

`GET /api/meta` returns the catalog: the 12 bag colors, 8 characters, target scores, defaults, board and bag sizes, the LED layout and the sound list. Draw the Match Setup screen from it.

### `POST /api/matches` (create)

```json
{
  "hostName": "Uncle",
  "config": { "mode": "2v2", "playTo": 21, "bust": false, "skunk": false, "distance": "regulation", "throwTimerSec": 20, "boardCam": true, "tutorial": false },
  "seats": { "B1": { "kind": "human" }, "A2": { "kind": "bot", "level": "pro" }, "B2": { "kind": "bot", "level": "rookie" } }
}
```

Every field except `hostName` is optional and falls back to the default (2v2, play to 21, host in `A1`, everyone else a Regular bot). Unknown fields are rejected, which is how "no wagers" is enforced.

Returns `201` with `{ matchId, playerId, seat, bearer, view }`. `matchId` is an 8-character code (letters and digits, no 0/O/1/I/L). Friends join with it.

Seats: `A1`, `B1` (near end) and `A2`, `B2` (far end). Team A is `A1` + `A2`. In 1v1 only `A1` and `B1` exist.

### `POST /api/matches/:id/join`

`{ "name": "Friend", "seat": "B1" }` (`seat` optional: first open human seat). Returns `201` like create. Only while the match is in the lobby.

### `POST /api/matches/:id/start`

Host only. Every human seat must be filled (`seats_open` otherwise). Moves to the character pick.

## The match, phase by phase

`view.phase` is one of: `lobby` → `characters` → `colors` → `toss` → `playing` → `finished` (or `abandoned`).

| Phase | What players do | Ends when |
|-------|-----------------|-----------|
| `characters` | `POST .../character` `{ "characterId": "keisha" }`. First come, first served: a taken character is `character_taken`. | Every human picked, or after 20 s. Unpicked players get a random free character. Bots get whatever is left. |
| `colors` | `POST .../color` `{ "colorId": "hot-pink" }`. **First come, first served.** A team picks once, and no two teams share a color. Either partner can pick for their team. | Every human team picked, or after 15 s. Teams that didn't get a random free color. Teams with no humans pick last. |
| `toss` | Watch the coin flip (`coin_toss` event). | About 3 s. |
| `playing` | Throw when it's your turn. | Someone wins. |

`view.deadlineAt` is when the current pick phase auto-completes (epoch ms).

### `POST /api/matches/:id/throw`

```json
{ "power": 0.604, "aim": 0.0, "arc": 0.85, "spin": 0.0, "leftHanded": false }
```

| Field | Range | Meaning |
|-------|-------|---------|
| `power` | 0 to 1 | 0 is far too short, about 0.6 lands on the hole, 1 is far too long |
| `aim` | -1 to 1 | Left/right. About ±0.5 is the edge of the board |
| `arc` | 0 to 1 | 0 is a flat skimmer that slides a long way, 1 is a high lob that sticks |
| `spin` | -1 to 1 | Sideways drift while sliding (default 0) |
| `leftHanded` | boolean | Only changes which side the flight starts from |

Returns `{ "accepted": true }`. The result arrives as a `throw_result` event. Only valid when `view.turn.seat` is your seat and `view.turn.controlledBy` is `"human"` (`not_your_turn` otherwise). The server adds a small random wobble, so a perfect swipe is not a guaranteed cornhole.

### `POST /api/matches/:id/leave`

Leaving during the lobby frees your seat (the host leaving cancels the match). Leaving during a match hands your seat to a bot right away. If no humans are left the match is abandoned.

## Reading the match

`GET /api/matches/:id` returns the **view**:

```
id, seq, phase, config,
seats[]: { id, team, startEnd, kind: "human"|"bot", botLevel, name, claimed, connected, characterId, controlledByBot }
colors: { A?: colorId, B?: colorId }
deadlineAt, scores: { A, B }, inning, firstTeam
turn: null | { seat, team, bagId, controlledBy: "human"|"bot", deadlineAt, fromEnd, targetEnd, throwNumber, bagsLeft: {A,B} }
board[]: { id, team, status: "board"|"hole", x, y }   // bags on the target board now; x,y null for bags in the hole
history[]: one entry per finished inning
winner, winReason: "score"|"skunk"|"forfeit"|"abandoned"|null
you: null | { playerId, seat, team, host }
```

`turn` is `null` in the short pause between throws. `fromEnd` is which end the bags are thrown **from** this inning (0 near, 1 far) and `targetEnd` is the board they land on. Ends alternate every inning.

`GET /api/matches/:id/events?since=<seq>` returns missed events (see below).

## Realtime: `GET /api/matches/:id/ws`

Use a WebSocket to get events as they happen.

1. Connect, then send within 5 s: `{ "type": "hello", "bearer": "<bearer>", "since": <lastSeq> }`. `bearer` is optional, and without it you're a read-only spectator. `since` is optional.
2. The server answers `{ "type": "welcome", "view": {...}, "missed": [ ...events after since ] }`.
3. Then every event arrives as `{ "type": "event", "event": { "seq": 41, "at": 1700000000000, "type": "throw_result", "data": {...} } }`.
4. Send `{ "type": "ping" }` any time and get `{ "type": "pong" }`. The server also pings every 25 s.
5. Bad hello closes with code 4400, bad credentials 4401, unknown match 4404, no hello in 5 s 4408.

Your seat counts as **connected** while at least one of your sockets is open. If your last socket closes, a 30 s clock starts. If you're not back by then, a bot plays your seat until you return (you get the seat back on your next turn). A match with nobody connected for 2 minutes is abandoned. Finished matches stay readable for 10 minutes.

On reconnect, send your last `seq` as `since` and you get what you missed. **Missed `throw_result` events have their `flight` and `slide` animation frames removed** (`framesOmitted: true`) to keep memory small, but keep the outcome. Just show the new state, and don't replay old animations.

### Events

| `type` | `data` | When |
|--------|--------|------|
| `seats` | `{ seats }` | Someone joined, left, connected or disconnected |
| `phase` | `{ phase, deadlineAt }` | Phase changed |
| `character_picked` | `{ seat, characterId, auto }` | `auto` is true if assigned on timeout |
| `color_picked` | `{ team, colorId, auto }` | Same |
| `coin_toss` | `{ firstTeam }` | Who throws first |
| `turn_start` | `{ seat, team, bagId, inning, fromEnd, targetEnd, throwNumber, bagsLeft, controlledBy, deadlineAt }` | A turn opens. `deadlineAt` is the throw clock (null for bots or no timer) |
| `turn_control` | `{ seat, controlledBy }` | A bot took over the current turn |
| **`throw_result`** | see below | **A bag was thrown** |
| `throw_timeout` | `{ seat, bagId }` | The clock ran out (a foul) |
| `inning_complete` | `{ result }` | All 8 bags thrown, scored. `result` has `points`, `scoringTeam`, `scored`, `scoreAfter`, `busted` |
| `score` | `{ team, points, scores, led }` | A team scored this inning, with a soft LED pulse cue |
| `match_end` | `{ winner, reason, scores, led }` | Game over, with the victory LED cue |
| `seat_takeover` | `{ seat, reason: "disconnect"\|"left" }` | A bot took a human's seat |
| `seat_reclaimed` | `{ seat }` | The human is back |
| `match_abandoned` | `{ reason }` | Nobody is left |

### `throw_result` (the important one)

```
seat, team, bagId, inning, fromEnd, targetEnd,
gesture: { power, aim, arc, spin },     // what was thrown (for a bot, its swipe)
seed,                                   // the server's random seed for this throw
status: "board" | "hole" | "ground",    // where THIS bag ended up
foul: null | "missed_board",
updates: { "<bagId>": "hole" | "ground" },   // OTHER bags this throw knocked in or off
landing: { x, y },                      // where it first touched down
resting: { "<bagId>": { x, y } },       // every bag still on the board, final positions
flight: [ { t, x, y, z } ],             // release to touchdown, ~30 samples a second (t in ms)
slide:  [ { t, bags: { "<bagId>": [x, y] } } ],   // movement after touchdown; only bags that moved
holeEvents: [ { bagId, tMs, cause: "direct"|"slide"|"knocked" } ],
flightMs, durationMs,                   // touchdown time and total time, in ms from release
cues: [ { atMs, reason, bagId?, sound?, led? } ]
```

**Board coordinates** are inches. `x` is left/right (0 is the center line, right is positive). `y` runs from the **front edge** of the board (0) to the back (48). The hole is at `(0, 39)`. Flight positions before touchdown have `y < 0`, and `z` is height above the ground.

**How to play it back:** start the flight at time 0, walk the `flight` samples, then at `flightMs` start the `slide` frames (their `t` counts from touchdown). Fire each `cues` entry at `atMs` after release. Stop the bag at `resting`.

### Cues: the sound and the lights

`cues` is how the board reacts. For every bag that drops in the hole there is one entry:

```json
{ "atMs": 1090, "reason": "hole", "bagId": "A1-i1-b1", "sound": "cornhole_hit",
  "led": { "pattern": "flash_burst", "durationMs": 1800, "boardEnd": 1, "colors": ["#FFFFFF", "#1D4ED8"] } }
```

Play `sound` and start the `led` pattern at `atMs`. Other cues are just sounds: `bag_thud` when a bag lands on the board and `ground_thud` when it hits the grass. `boardEnd` says which board's lights to use (0 near, 1 far). If the player has reduce-motion on, use `led.cornhole.reducedMotion` from `GET /api/meta` (`steady_glow`) instead of the strobe. See `docs/led-board-and-bags.md`.

## Configuration (environment)

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | 3000 | |
| `HOST` | 0.0.0.0 | |
| `LOG_LEVEL` | info | fatal, error, warn, info, debug, trace, silent |
| `MAX_MATCHES` | 5000 | Live matches before `server_busy` |
| `RATE_LIMIT_PER_MIN` | 300 | Per IP. Creating a match is limited to 20 a minute |
| `TRUST_PROXY` | false | Set `true` behind a load balancer so limits use the real client IP |

Health checks: `GET /health` and `GET /ready` (never rate-limited).
