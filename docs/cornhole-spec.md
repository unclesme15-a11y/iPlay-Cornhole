# Cornhole spec

Working title: **iPlay Cornhole**. Protocol **2**. This is the single spec to hand to a coding agent. It describes the game that is in this tree, and it names the unmerged branches that add the hand, the bag flight, the Imagine plates, and the round-trip tests.

Written against `claude/cornhole-game-prototype-p9nt6j` (parent of this branch). The Street Dice repo `unclesme15-a11y/iPlay-StreetDice` returned HTTP 404 from the environment that wrote this file, so no Dice spec on disk was opened. Section shape follows the Cornhole contract docs already in this tree (`docs/game-rules.md`, `docs/api-contract.md`) and the plate-list shape in [Imagine video plates](https://github.com/unclesme15-a11y/iPlay-Cornhole/blob/cursor/cornhole-imagine-plate-list/docs/imagine-video-plates.md) on draft PR 3. Dice file paths below are cited from that plate list and were not re-read.

Full wire shapes stay in `docs/api-contract.md`. This file is the map: rules, phases, who decides a throw, events, replay, presenters, characters, plates, colors, bugs, and what is still open. If this file and the code disagree, the code on the named branch wins, and this file should be corrected.

## How to read a line

| Mark | Meaning |
|---|---|
| **In this tree** | Read in code or in a doc on `claude/cornhole-game-prototype-p9nt6j`. |
| **Unmerged** | Read on a named branch or PR. It is not in this tree. |
| **Planned** | Written as intent. No implementation was found for it. |
| **Unverified** | Cited from Street Dice or from a PR this environment could not open. |

## The hand rule

**Imagine never generates hands. All hands in iPlay come from the shared Unity hand rig `com.iplay.handrig`, composited over Imagine footage.**

That is the rule for every plate, including Thrower View, Neighbor Cut, and the 2v2 partner shot. The foreground of an Imagine plate stays empty: no hand, no arm, no bag, no opponent body. Unity draws the hand and the bag on top.

The rig is the shared package owned by Street Dice and consumed by Cornhole. The purchased hand prefabs drop into `Resources/FirstPersonHands/FirstPersonHand_L` and `Resources/FirstPersonHands/FirstPersonHand_R`. The product name of that purchased asset is still open (Needs Sme, on the plate list).

Where the sentence already lives:

- **Unmerged.** `docs/imagine-video-plates.md` on `cursor/cornhole-imagine-plate-list` ([PR 3](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/3)).
- **Merged to `main` only.** The one-line callout was added by [PR 5](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/5) (`docs/hand-rig-callout`). That merge is not in `claude/cornhole-game-prototype-p9nt6j`. Docs on this tree still say Kling in several places. Those older sentences are stale relative to this rule.
- **Unmerged consumer.** [PR 4](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/4) pins the package. [PR 6](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/6) flies the bag after the rig lets go.

## Where the pieces live

| Piece | Where it actually is |
|---|---|
| Rules engine, physics, lobby, accounts, ranked, voice tokens, ads pacing | **In this tree.** `server/` |
| Protocol write-up | **In this tree.** `docs/api-contract.md` |
| Greybox phone app: top-down board, menus, `MatchPresenter` hook | **In this tree.** `unity/CornholeGreybox/`. Screens have not been opened in the Unity editor (`README.md`). |
| Shared hand rig package | **Unmerged, and unverified inside the package.** Pin is on [PR 4](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/4). Source PR: [Street Dice PR 3](https://github.com/unclesme15-a11y/iPlay-StreetDice/pull/3). |
| Bag flight after release | **Unmerged.** [PR 6](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/6), branch `cursor/bag-flight-after-release-9daa`. |
| Imagine plate list | **Unmerged.** [PR 3](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/3), `docs/imagine-video-plates.md`. No media was generated. |
| Round-trip tests and the two client bugs | **Unmerged tests, bugs in this tree.** Branch `cursor/cornhole-roundtrip-tests-8bd6`. |
| Street Dice PR 5 | **Unverified.** Linked below. This environment could not read the private repo. |

Older video-tool docs on this tree (`docs/open-decisions.md`, `docs/visuals-todo.md`, `artifacts/kling/cornhole-prompts.md`, `README.md`) still name Kling, and they still leave a side-by-side against Veo 3.1 and Seedance 2.0 open. Draft PRs [1](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/1) and [2](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/2) change that prose so Imagine is the default. They are not merged. The plate list on PR 3 is the list this spec follows: Imagine only, with one open question kept (whether to test more than one tool on a single plate before locking the set).

---

## 1. Rules and scoring

Source of truth: `server/src/core/scoring.ts`, `server/src/core/match.ts`, `server/src/core/constants.ts`. The prose contract is `docs/game-rules.md`. Tags there: **[Reg]** regulation, **[iPlay]** a choice for this game, **[House]** an optional table setting.

The rules engine does not know about networking, physics, or the database. Callers feed it a throw outcome. It applies the rules and returns events.

### Equipment (in this tree)

Lengths are inches.

| Constant | Value | File |
|---|---|---|
| Board | 24 × 48 | `BOARD` in `server/src/core/constants.ts` |
| Hole | radius 3 (6 in diameter), center at y = 39 from the front edge (9 in from the back) | same |
| Board height | front 3.5, back 12 | same |
| Bag | 6 × 6, simulated as a disc of radius 3 | `BAG` |
| Distance, front edge to front edge | regulation 324 (27 ft), backyard 252 (21 ft) | `DISTANCE_IN` |
| Bags | 4 per player, 8 per inning | `BAGS_PER_PLAYER`, `BAGS_PER_INNING` |

Pitcher's box and foot-faults are **[Reg]** in `docs/game-rules.md` and **are not fouls in this version**. The same doc says players cannot step over a line on a phone. The fouls the server can record are below.

### Points and cancellation (in this tree)

| Result | Points | Status |
|---|---|---|
| Through the hole (thrown in, slid in, or knocked in) | 3 | `hole` |
| Resting on the board at the end of the inning | 1 | `board` |
| Ground, including a miss and a bag knocked off | 0 | `ground` |

`rawPoints` counts only `hole` and `board`. `tallyInning` subtracts the lower team total from the higher. The difference is `scored`. `scoringTeam` is null when the totals match (a wash). The most one team can total before cancellation is 12 (4 × 3). That cap is a consequence of the bag count. There is no separate clamp.

Bags score where they finish. An opponent who knocks your bag in scores 3 for you, because the bag keeps its team.

### Innings (in this tree)

One inning is 8 throws. Teams alternate one bag at a time. `throwsThisInning` even: `firstTeam`. Odd: the other team.

Bag id: `{seat}-i{inning}-b{bagNumber}`. `bagNumber` is how many bags that team has thrown this inning, starting at 1.

`fromEnd` is `(inning - 1) % 2` (0 near, 1 far). The board they throw at is the other end.

Who stands where:

- Seats: `A1` and `B1` are the near end. `A2` and `B2` are the far end. Team A is `A1`+`A2`.
- **1v1** has only `A1` and `B1`. `seatFor` always returns `{team}1`, on every inning. The end index still flips, so wind and the far board swap. The camera stays put (`docs/game-rules.md`: the park looks the same from both ends).
- **2v2:** the thrower is `{team}1` from end 0 and `{team}2` from end 1. Partners stand at opposite ends. Only one end throws in an inning.

Next inning: the team that scored throws first. After a wash, `firstTeam` stays. The board clears. `inning` increments.

The first inning's `firstTeam` comes from the server coin toss (`coin_toss`).

### Winning (in this tree)

`playTo` is 11, 15, or 21. Default 21. Checked only at the end of an inning.

- Bust off (the default): first team with `score >= playTo` wins. Landing past the target is a win. There is no win-by-2.
- Bust on: a scoring team that goes **over** `playTo` is set back to `BUST_TO` (11→7, 15→11, 21→15) and does not win that inning. With bust on, the win check is equality with `playTo`.
- Skunk on: a team at `SKUNK_SCORE` (11) to 0 at the end of an inning wins immediately. Off by default.

`winReason`: `score`, `skunk`, `forfeit`, or `abandoned`.

### Fouls (in this tree)

`FoulReason` in `server/src/core/types.ts`: `timer`, `missed_board`, `knocked_off`.

| Foul | What the server does |
|---|---|
| `missed_board` | Physics: the bag is not on the board. `status: "ground"`. Emitted on `throw_result.foul`. |
| `knocked_off` | A later throw sets another bag's status to `ground`. The engine stores `foul: "knocked_off"` on that bag. `throw_result.updates` carries the new status. |
| `timer` | `foulTimeout` records a ground bag with no flight. The session emits `throw_timeout`, not `throw_result`. |

`docs/game-rules.md` also lists foot faults, a bounce off the grass, and hitting a person or a tree. Those are not separate code paths.

### Throw clock, idle, forfeit (in this tree)

- `throwTimerSec` is `20` or `null`. Default 20. The open turn carries `deadlineAt`.
- Three clock expirations in a row (`IDLE_TIMEOUTS_LIMIT = 3` in `server/src/lobby/session.ts`): casual seat becomes a bot (`seat_takeover`, reason `idle`). Ranked seat forfeits (`seat_forfeit`, reason `idle`).
- Casual disconnect: `RECONNECT_GRACE_MS` is 30 seconds, then a bot plays the seat until the human's socket returns (`seat_reclaimed`). Leave mid-match hands the seat to a bot for good and counts as a leave, not a win or a loss.
- Ranked leave, ranked disconnect past 30 seconds, or ranked idle: `forfeit`. The other team wins. The leaver waits 10 minutes (`FORFEIT_COOLDOWN_MS` in `server/src/ranking/rules.ts`). No bot takes the seat. Forfeit before anyone has thrown abandons as `forfeit_before_start` and does not move ratings (`voidReason` in `server/src/ranking/ratings.ts` covers `abandoned` and `no_throws`).
- A match with no connected human for `ABANDON_AFTER_MS` (120 seconds) is abandoned. Finished matches stay readable for 10 minutes (`docs/api-contract.md`).

### Match setup (in this tree)

`POST /api/matches` config, all optional. Unknown fields are rejected (that is how "no wagers" is enforced).

| Option | Choices | Default |
|---|---|---|
| `mode` | `1v1`, `2v2` | `2v2` |
| `playTo` | 11, 15, 21 | 21 |
| `bust`, `skunk` | bool | false |
| `distance` | `regulation`, `backyard` | `regulation` |
| `throwTimerSec` | 20 or null | 20 |
| `boardCam` | bool | true (far board only; `docs/game-rules.md`) |
| `tutorial` | bool | false (wind forced calm) |
| `wind` | `off`, `light`, `breezy`, `gusty` | `breezy` |

Host is seat `A1`. Other seats default to Regular bots. `seats` can set `human` or `bot` with `level` `rookie`, `regular`, or `pro`.

Ranked ignores this screen. `rankedConfig` in `server/src/ranking/rules.ts` is 1v1 or 2v2, play to 21, no bust, no skunk, regulation distance, 20 second clock, wind `breezy`, every seat human. No rematch.

Wind bands in `WIND_PRESETS` (`server/src/physics/wind.ts`): off 0; light 1–5 mph, gustiness 0.1; breezy 3–10, gustiness 0.15; gusty 8–16, gustiness 0.3. Switching ends swaps headwind and tailwind. Each inning nudges the field wind. Each throw adds a gust. The phone does not pre-correct aim for wind.

### Ranked numbers (in this tree, tune later)

Documented in `docs/game-rules.md` and `docs/ratings-explained.md`, implemented under `server/src/ranking/`. Everyone starts at 1200. Placement is the first 10 rated games. Matchmaking starts at ±100 and widens by 50 every 5 seconds, up to ±800. Search expires at 5 minutes. Same opponents: after 3 ranked matches in 24 hours, points are halved; from the 6th they are zero. Leaderboards: 10 rated games, a ranked game in the last 90 days, not banned, `showOnLeaderboards` on. Blocked players are never matched.

`README.md` says these numbers are first guesses.

### Ads, voice, accounts (in this tree, outside the throw)

- Adults only. Sign-up sends `confirmAdult: true` after the tick. Ranked, parties, and voice also require the current terms.
- No wagers. Nothing is for sale. Ads (AppLovin MAX) follow `GET /api/meta` → `ads`. Never during a match (coin toss through results).
- Voice is Vivox. The server signs tokens and returns a mute list. Audio does not pass through this server. `CornholeVivoxVoiceClient` is in the Unity project. The README status table says that client is compiled and has not been run on a phone. The README "Things to know" list and `docs/multiplayer-plan.md` still say the Unity voice client is not built. The file on disk is the later fact. It has not been run on a device.
- One account, one running match (`409 already_in_match`).

---

## 2. Match flow and phases

Session phases live on `MatchSession` (`server/src/lobby/session.ts`), not on `MatchEngine`. The engine only has `in_progress` and `finished`.

`view.phase`: `lobby` → `characters` → `colors` → `toss` → `playing` → `finished` or `abandoned`.

| Phase | Who acts | Ends when |
|---|---|---|
| `lobby` | Host sets seats, invites, kicks. `POST …/start`. | Start. Empty human seats without `fillOpenWithBots` return `409 seats_open`. With the flag, those seats become Regular bots. |
| `characters` | Each human `POST …/character` `{ characterId }`. First come, first served (`409 character_taken`). | Every human has picked, or `CHARACTER_PICK_TIMER_MS` (20 s). Timeout assigns a free character (`character_picked` with `auto: true`). Bots take what is left. |
| `colors` | A human posts `{ colorId }` for their team. One pick per team. No shared colors (`color_taken`, `team_already_picked`). | Every human team has picked, or 15 s. Remaining colors are assigned at random. Teams with no human pick last. |
| `toss` | Watch `coin_toss` `{ firstTeam }`. | `tossMs` 3000. Then `playing`. |
| `playing` | The seat in `view.turn` throws, or the clock fouls. | `checkWinner` at the end of an inning. |
| `finished` | Rematch votes, unless ranked. | Rematch window 60 s, or everyone has answered. |
| `abandoned` | Nobody left, host left the lobby, or forfeit before the first throw. | Terminal. |

`view.deadlineAt` is the pick-phase deadline (epoch ms). During `playing`, the throw clock is `turn.deadlineAt`.

Between throws, `turn` is null for `reactionMs` (1800) plus the throw's `durationMs`. An inning end adds `inningEndMs` (2600) before the next turn. Bots think 1000–2400 ms, then the server throws for them through the same `simulateThrow` path.

Ranked skips the lobby. `createRanked` seats both sides and `startRanked` enters `characters`. Anyone not connected within 30 seconds forfeits.

### Rematch (in this tree)

Casual only. `view.rematch` is `{ deadlineAt, votes, matchId, cancelled }`.

`POST …/rematch` `{ accept: true|false }`. If at least one human accepts, a **new match id** starts. Same config. Seats, characters, and bag colors are kept. Picks are skipped. Coin toss is `rematchTossMs` (5000) so phones can switch. `rematch_ready` carries the new id. `view.rematchOf` points back.

Cancel reasons on `rematch_cancelled`: `nobody_accepted`, `unavailable`, `maintenance`, `already_in_match`, `server_busy`.

### Resume after a restart (in this tree)

Live matches are saved. Socket close `1012` means reconnect with the last `seq`. Welcome `resync: true` means the client's `since` is ahead of the log: drop local state and draw `view`. On restore, an open throw clock is re-armed with a floor of 8 seconds (`session.ts` `resume`). Event seq continues. A crash can be up to about a quarter of a second behind (`README.md`).

One server process owns live matches. A second instance is not built.

### What the phone keeps (in this tree)

`MatchModel` mirrors events. It does not run the rules. `IsMyTurn` is `phase == "playing"` and `turn.controlledBy == "human"` and `turn.seat == you`.

`Flows.cs` is account, ranked, leaderboards, and ads. It is not a match state machine.

Round-trip comments on `cursor/cornhole-roundtrip-tests-8bd6` (`expectClientMatches` in `server/test/roundtrip.test.ts`) record three drifts the harness allows. They are not the two bugs in section 10:

- While the next turn is still closed, the phone keeps the inning from the last `turn_start`. The engine view has already stepped `inning`. They meet on the next turn.
- The phone keeps the coin-toss `firstTeam`. The engine rewrites `firstTeam` to whoever leads the next inning. The toss screen has already moved on.
- `inning_complete` clears the phone's board. On a winning inning the engine snapshot still lists those bags. The results screen does not read them.

---

## 3. Server-authoritative throw resolution

The phone sends a gesture. The server chooses the seed, applies wind and the flick, simulates the bag, then asks the rules engine to record the outcome. Two phones never disagree about where a bag stopped, because they both play the server's samples.

### What the phone may send (in this tree)

`POST /api/matches/:id/throw`

```json
{ "power": 0.604, "aim": 0.0, "arc": 0.9, "spin": 0.0, "leftHanded": false,
  "release": { "angleDeg": 1.5, "speed": 3.2, "holdMs": 900, "curve": 0.0 } }
```

| Field | Range | Meaning |
|---|---|---|
| `power` | 0..1 | 0 is far short of the board. About 0.6 is the hole. 1 is far past the back. |
| `aim` | -1..1 | Left/right. About ±0.5 is the board edge. `AIM_TO_X` is 24, so aim maps toward ±24 in before wobble. |
| `arc` | 0..1 | 0 is a flat skimmer (slide speed 110 in/s). 1 is a lob that sticks (20 in/s). |
| `spin` | -1..1 | Sideways drift on the slide. Replaced when `release` is present. |
| `leftHanded` | bool | Which side the flight is drawn from. It does not change the rules. |
| `release` | optional object | The flick. Without it, the throw is a clean release. |

`release` bounds (`server/src/physics/release.ts`): `angleDeg` -60..60, `speed` 0..30 screen-heights per second, `holdMs` 0..60000, `curve` -1..1.

`applyRelease` turns that flick into a push or a pull, a short-arm, extra wobble, and spin. `STRAIGHT_DEG` is 3. Those tuning numbers are called out as first guesses in `docs/open-decisions.md`. The full control map is `docs/throwing-controls.md`.

`aim`, `power`, and `arc` are the calm-day lineup. The server adds wind. The client must not subtract wind before posting.

Accepted response: `{ "accepted": true, "seq" }` (the route returns `accepted` and `seq`; `docs/api-contract.md` shows `{ "accepted": true }`). The result is the later `throw_result` event.

Rejected when it is not this seat's human turn (`409 not_your_turn`), the gesture is out of range (`400 bad_gesture`), or the phase is wrong (`409 wrong_phase`).

### What the server computes (in this tree)

`MatchSession.throw` → `performThrow`:

1. `seed = secureSeed()` per throw (`server/src/core/rng.ts`). Same seed, same landing.
2. `simulateThrow` (`server/src/physics/throwSim.ts`):
   - Nominal landing from power and aim, then Gaussian wobble (`WOBBLE_X` 1.4 in, `WOBBLE_Y` 2.6 in), times the release wobble multiplier.
   - Wind drift from the gusted relative wind.
   - Flight from release height 40 in. `flightMs = round((0.55 + 0.45 * arc + 0.15 * power) * 1000)`. Samples at about 30 Hz (`max(2, round(flightMs / (1000/30)))`).
   - Slide at 120 Hz internally, recorded every 4 steps (30 Hz), friction `DECEL` 200 in/s², stop under 1.5 in/s, max 6 s.
   - Hole: fall radius is hole radius minus 0.2 in. A bag sliding faster than 85 in/s can skate the hole (`HOLE_SKIP_SPEED`).
   - Other bags on the board are discs. Collisions use restitution 0.2. A knocked bag can enter the hole or leave the board.
3. `engine.recordThrow` checks the seat and the bag id, applies `updates`, pushes the new bag, and on the 8th throw runs `completeInning`.
4. `cuesForThrow` (`server/src/presentation/effects.ts`) builds the sound and LED list.
5. Emit `throw_result` with flight, slide, cues, wind, and release verdict.

Board frame, inches: `x` right of the center line, `y` from the **front** edge of the target board toward the back (48). The hole is `(0, 39)`. The thrower stands at `y = -distanceIn`. Flight samples before touchdown have `y < 0`. `z` is height above the ground.

`throw_result.release` is `{ pushIn, shortIn, shake, spin, verdict, aimed }` or null. `verdict` is `pure`, `pushed`, `pulled`, `short-armed`, or `shaky`. `aimed` is the gesture the player lined up. `gesture` on the event is what was actually thrown. Bots and phones that omit `release` get `release: null`.

`throw_result.wind` is `{ cross, along, driftX, driftY }` for the air that throw flew through. `cross` positive pushes right from the thrower's view. `along` positive carries long.

Statuses the sim returns: `board`, `hole`, `ground`. A ground bag from the sim carries `foul: "missed_board"`. A direct hole emits `holeEvents[].cause = "direct"` at `flightMs`. A slide-in is `slide`. A bag already on the board that drops is `knocked`, and `updates[bagId]` is `hole` or `ground`.

Timer fouls skip this pipeline. See section 1.

---

## 4. Protocol and events

**In this tree.** Normative write-up: `docs/api-contract.md`. Routes: `server/src/http/routes/`. Socket: `server/src/http/realtime.ts`.

`GET /api/version` returns `protocol: 2`. Protocol 1 (per-match tokens) is gone. Every player has a session.

Headers: `Authorization: Bearer`, `X-Client-Version`, `X-Client-Platform` (`ios` or `android`), JSON.

### Calls the match uses

| Call | Role |
|---|---|
| `POST /api/matches` | Create. `201` with `matchId`, `seat`, `invite`, `view`. |
| `POST /api/matches/:id/join` | Take an open lobby seat. Body `{ seat }` optional. |
| `GET /api/invites/:code` | Public preview. |
| `POST /api/matches/:id/seats` | Host: empty seat becomes `human` or `bot`. |
| `POST /api/matches/:id/kick` | Host removes a player. They get `kicked`. |
| `POST /api/matches/:id/start` | Leave the lobby. |
| `POST /api/matches/:id/character` | Pick. Returns the view. The client currently discards that body (section 10). |
| `POST /api/matches/:id/color` | Team color. |
| `POST /api/matches/:id/throw` | Gesture in, `{ accepted, seq }` out. |
| `POST /api/matches/:id/leave` | Lobby frees the seat (host leave cancels). In a match, a bot takes the seat. |
| `POST /api/matches/:id/rematch` | `{ accept }`. |
| `GET /api/matches/:id` | View. Token adds `you`. |
| `GET /api/matches/:id/events?since=` | `{ events, seq, resync }`. |
| `GET /api/matches/:id/ws` | The live channel. |

View fields the client must be able to draw: `id`, `protocol`, `seq`, `phase`, `config`, `seats[]` (`id`, `team`, `startEnd`, `kind`, `botLevel`, `name`, `claimed`, `connected`, `accountId`, `characterId`, `controlledByBot`), `colors`, `deadlineAt`, `scores`, `inning`, `firstTeam`, `turn`, `board[]`, `history[]`, `winner`, `winReason`, `rematch`, `you`, `wind`, `ranked`, `ratings`, `rematchOf`.

`board[]` entries are bags still in play: `{ id, team, status: "board"|"hole", x, y }`. Hole bags have null `x` and `y`.

`turn`: `{ seat, team, bagId, controlledBy, deadlineAt, fromEnd, targetEnd, throwNumber, bagsLeft, wind }` or null.

### Socket (in this tree)

1. Connect `GET /api/matches/:id/ws`.
2. Within 5 seconds send `{ "type": "hello", "bearer", "since", "clientVersion" }`. No bearer: read-only spectator. A signed-in player who is not seated is also a spectator.
3. Server sends `{ "type": "welcome", "view", "missed", "resync" }`.
4. Live events: `{ "type": "event", "event": { "seq", "at", "type", "data" } }`.
5. Client `{ "type": "ping" }` → `{ "type": "pong" }`. Server pings about every 25 seconds.

Throws are REST. The socket does not accept a throw.

Close codes: `1012` restart (reconnect), `4400` bad hello, `4401` bad credentials, `4403` banned, `4404` unknown match, `4408` no hello in 5 seconds, `4426` app too old.

`missed` and `GET …/events` read the log. Live listeners get the full `throw_result`. The log copies that event **without** `flight` and `slide`, and sets `framesOmitted: true` (`MatchSession.emit`). Outcome fields stay: status, foul, updates, landing, resting, hole events, cues, wind, release. `docs/api-contract.md`: show the new state, and do not replay the old animation. The client does not do that yet (section 10).

Log cap: `EVENT_LOG_LIMIT` 500.

### Event types (in this tree)

| `type` | `data` (the fields the client branches on) | When |
|---|---|---|
| `seats` | `{ seats }` | Join, leave, connect, disconnect, host edit |
| `kicked` | `{ seat, accountId }` | Host removed someone |
| `phase` | `{ phase, deadlineAt }` | Phase changed |
| `character_picked` | `{ seat, characterId, auto }` | A character was taken or assigned |
| `color_picked` | `{ team, colorId, auto }` | A team color was taken or assigned |
| `coin_toss` | `{ firstTeam }` | Who throws first |
| `wind` | `{ wind, inning }` | Field wind at the start of play and each inning nudge |
| `turn_start` | seat, team, bagId, inning, fromEnd, targetEnd, throwNumber, bagsLeft, controlledBy, deadlineAt, wind | A turn opens |
| `turn_control` | `{ seat, controlledBy }` | A bot took the open turn |
| `throw_result` | see section 3 and `docs/api-contract.md` | A simulated throw |
| `throw_timeout` | `{ seat, bagId }` | Clock foul. No frames. |
| `inning_complete` | `{ result }` with `points`, `scoringTeam`, `scored`, `scoreAfter`, `busted`, `finalBags` | Eight bags, scored |
| `score` | `{ team, points, scores, led }` | The team that scored this inning |
| `match_end` | `{ winner, reason, scores, led }` | Game over |
| `rematch_update` | `{ deadlineAt, votes }` | Window opened or a vote landed |
| `rematch_ready` | `{ matchId }` | Switch to this match |
| `rematch_cancelled` | `{ reason }` | No rematch |
| `seat_takeover` | `{ seat, reason }` `disconnect`, `left`, or `idle` | Casual bot takeover |
| `seat_forfeit` | `{ seat, reason }` same three | Ranked forfeit |
| `seat_reclaimed` | `{ seat }` | Human socket is back |
| `ratings_updated` | `{ voided, updates }` | Ranked result saved |
| `resumed` | `{ phase }` | Process restored this match |
| `match_abandoned` | `{ reason }` | Nobody left, or equivalent |

`MatchModel.ApplyEvent` on this tree handles `color_picked`, `throw_result`, `turn_start`, scores, rematch, forfeit, takeover, and ratings. It **breaks without writing seats** for `character_picked`, `kicked`, `resumed`, and `seat_reclaimed` (`unity/CornholeGreybox/Assets/Scripts/Core/MatchModel.cs`). `kicked` and `seat_reclaimed` still arrive, and a later `seats` event or a full view can refresh those. `character_picked` has no matching seat write. That is bug 1 in section 10.

---

## 5. Replay and flight

### Samples (in this tree)

`throw_result` carries:

| Field | Unit |
|---|---|
| `flight[]` | `{ t, x, y, z }`, `t` ms since release, about 30 Hz, until touchdown |
| `flightMs` | Touchdown, ms since release |
| `slide[]` | `{ t, bags: { id: [x, y] } }`, `t` ms since **touchdown**, only bags that moved |
| `durationMs` | Release to rest, ms |
| `landing` | `{ x, y }` first touch |
| `resting` | Every bag still on the board |
| `holeEvents[]` | `{ bagId, tMs, cause }` with `tMs` since release |
| `cues[]` | `{ atMs, reason, bagId?, sound?, led? }` |

Cue reasons from `cuesForThrow`: `foul` + `ground_thud` when the thrown bag misses, `landing` + `bag_thud` when it stays on the board, `hole` + `cornhole_hit` and an LED `flash_burst` when any bag drops in. `boardEnd` selects which board's lights. Reduce motion uses `steady_glow` from `GET /api/meta` instead of the strobe. Flash rate is capped at 3 per second (`docs/led-board-and-bags.md`).

### `ThrowReplay` (in this tree)

`unity/CornholeGreybox/Assets/Scripts/Core/Replay.cs`. Pure function of the server payload. It does not resimulate.

`ThrowReplay.At(result, tMs, boardBefore)`:

- Copies bags that were on the board before this throw.
- `tMs < flightMs`: phase `flight`. Interpolates `flight` samples. Height is `z`. If `flight` is empty, the bag jumps to `landing` and returns immediately.
- Else phase `slide` until `durationMs`, then `rest`. Height 0. Slide frames with `t <= tMs - flightMs` are applied. At rest, `resting` overwrites positions.
- Any `holeEvents` entry with `tMs <= t` is removed from the board set and added to `InHole`.

`CuesBetween(result, fromMs, toMs]` is how the greybox fires sounds. `FirstHoleMs` is the earliest hole, or -1.

`CornholeApp.Match.OnThrowResult` always stores the result and sets `replayStart` to now. `UpdateReplay` walks `ThrowReplay` every frame and calls `presenter.OnReplayFrame` until `durationMs + 200`. The top-down map uses the same clock (`DrawBoardMap`). Empty flight still produces a flight-phase frame at the landing, so a stripped reconnect throw still animates. That is bug 2.

### Bag flight after the hand lets go (unmerged)

Branch `cursor/bag-flight-after-release-9daa` ([PR 6](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/6)), read for this spec, not recompiled in Unity and not re-tested here. The PR reports offline core tests (68 passed, including the flight cases). Unity is not installed in the environment that wrote this spec.

`BagFlightVisual` in `unity/CornholeGreybox/Assets/Scripts/Core/BagFlight.cs` on that branch:

- One bag. Modes `InHand`, `LocalArc`, `Replay`.
- The shared rig's release is at **0.48 s** (comment on `SharedHandRigPresenter`). Server time 0 is anchored to that release pose so the bag does not pop to the sample that is already 0.48 s down the lane.
- `BoardDeck` lifts slide and rest onto the board (front 3.5 in, back 12 in, 48 in long). Replay height 0 would otherwise drop a 3D bag onto the grass. A miss stays on the grass. A holed bag hides when it arrives, not while it is still in the hand.
- No server samples: a local arc uses the release direction and speed and does not score. A server path that arrives later eases in from the arc's current pose.
- The presenter moves the renderer already on the release pose. It does not spawn a second cube. It looks for a small renderer whose name contains bag, bean, prop, or cube within 12 cm of the handoff origin, otherwise any small renderer within 4 cm. A package-side `Transform` on `CornholeBagPropView` would replace that search. That change belongs in Street Dice. The pin was not moved.

`HoldReplayClock` is true only while `SharedHandRigPresenter` is waiting for release (timeout 2 s). The match screen holds the replay clock so the top-down map and the cues start when the bag leaves the hand. With no hand presenter, the clock starts when the server answer arrives, which is the behavior in this tree.

---

## 6. Client presenters

### The hook (in this tree)

`MatchPresenter` (`unity/CornholeGreybox/Assets/Scripts/Unity/MatchPresenter.cs`) is an optional `MonoBehaviour`. With none in the scene, the match still plays.

| Call | When |
|---|---|
| `OnMatchOpened(MatchModel, ThrowGuide)` | Match screen opens |
| `OnAimChanged(aim, power, shotId, pulling, handShake)` | Drag, pull, release |
| `OnThrowResult(ThrowResult, boardBefore)` | Server answer, any seat |
| `OnReplayFrame(ThrowResult, ReplayFrame)` | Each replay frame |
| `OnCue(Cue, reduceMotion)` | Sound or LED is due |
| `OnWind(WindInfo)` | Field wind changed |
| `OnScore(team, points)` | A team scored |
| `OnMatchEnded(winnerTeam, reason)` | Game over |
| `OnMatchClosed()` | Screen closed |

Coordinates passed in are board inches. The hole is `(0, 39)`. The presenter does not decide the score.

`CornholeApp` finds the first `MatchPresenter` when the match screen opens. This tree has no subclass. `HoldReplayClock` does not exist on `MatchPresenter` in this tree. It is added on the PR 6 branch.

### Top-down board (in this tree)

There is no separate presenter class for it. `CornholeApp.Match.DrawBoardMap` draws a 24×48 minimap, a hole marker at `(0, 39)`, and 14×14 bag swatches in the team color from `GET /api/meta`. During a replay it reads `ThrowReplay.At`. While the bag's height is above 0 it draws the thrown bag at the landing x and the flight y (clamped at 0), so the map shows progress down the lane rather than a 3D arc. Casual play can show a landing ring. This is the default picture until someone opts into the hand rig.

`Theme` (`unity/CornholeGreybox/Assets/Scripts/Core/Theme.cs`) is the greybox UI palette (backdrop, cyan, gold, Barlow). It is not a bag or board skin.

The Unity project layout, sign-in, and build steps are `docs/unity-client.md`.

### Shared hand rig presenter (unmerged)

`SharedHandRigPresenter` is a `MatchPresenter` on [PR 4](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/4) and extended on [PR 6](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/6).

Opt in with `SharedHandRigPresenter.Attach(gameObject)` or by placing the component. The greybox does not add it. The top-down board stays the default.

Package pin in `unity/CornholeGreybox/Packages/manifest.json` on those branches:

```
com.iplay.handrig → https://github.com/unclesme15-a11y/iPlay-StreetDice.git?path=/unity/Packages/com.iplay.handrig#89462fdcff569a2975c438828208199c531b7cb5
```

That commit is on `cursor/shared-iplay-hand-rig`. Do not point the pin at `main`. Do not commit a machine-local `file:` path. Unity needs git credentials for the private Street Dice repo, or a local `file:` path that is not committed.

`docs/shared-hand-rig.md` on those branches says the package id could not be re-read from the private commit. The manifest key is `com.iplay.handrig`. Assembly `IPlay.Cornhole` references runtime assembly `IPlay.HandRig`. If the package asmdef uses another name, change that one reference. `IPlay.Cornhole.Core` stays free of Unity and of the rig.

On release the rig raises `BagReleased` with a `CornholeArcHandoff` (origin, lofted direction, speed, rotation). PR 6 keeps that same bag and flies it (`BagFlightVisual`). PR 4 stopped at the handoff event and left the projectile to a later wire-up. PR 6 is the later wire-up. The presenter was not compiled or played in the Unity editor on either PR. The stub Unity compile skips `SharedHandRigPresenter.cs` because the private package is absent. `docs/shared-hand-rig.md` lists the Play-mode checks still required on a machine that can resolve the package.

Every server throw still plays the local release, including an opponent's, and the flight starts from this hand's release pose. Settled bags are not copied onto a 3D board. The top-down map still shows them. The one rig bag returns to the hand on the next aim after it has landed.

---

## 7. Characters

### Roster (in this tree)

`CHARACTERS` in `server/src/core/constants.ts`. The same eight ids are the catalog the client reads from `GET /api/meta`. Prose, outfits, and throw personality are `docs/characters.md`. Names are placeholders. Ages in code match that table.

| id | Name | Gender | Age |
|---|---|---|---|
| `keisha` | Keisha | female | 34 |
| `tanya` | Tanya | female | 46 |
| `marisol` | Marisol | female | 38 |
| `jenna` | Jenna | female | 42 |
| `dre` | Dre | male | 36 |
| `big-mike` | Big Mike | male | 48 |
| `carlos` | Carlos | male | 41 |
| `travis` | Travis | male | 33 |

Each id is both a video-bot character and a human avatar (`docs/characters.md`). The server stores the chosen id on the seat and enforces uniqueness during the pick. It does not render a clip.

### Clips (planned)

`docs/characters.md` asks for 7 clips × 8 characters = 56, plus background-life takes: `idle`, `stepup`, `throw`, `react_good`, `react_bad`, `react_opponent_scored`, `neighbor_throw`. It tells the generator to lock a reference portrait first and to build Keisha's set first. Nothing in Unity maps `characterId` to a clip.

`docs/visuals-todo.md` still describes those clips as Kling image-to-video, plus a release-frame marker so Unity can hand the bag off. The Imagine plate list (section 8) puts character clips **outside** the plate list. Opponent bodies are not Imagine plates. The hand on screen is the shared rig.

Clothes in the character doc are plain: no logos, no team names, no readable text.

---

## 8. Imagine plate list

**Unmerged.** Full text, including every prompt: `docs/imagine-video-plates.md` on `cursor/cornhole-imagine-plate-list` ([PR 3](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/3)). This section is the contract a presenter needs. It does not copy the prompt blocks. Applying the plate list does not generate images, video, or Unity assets. No plates have been generated.

**Tool:** Imagine (Grok Imagine, via SuperGrok). The plate list says Kling, Veo, and Seedance are not used for any plate in that list. Open question kept: whether to test more than one tool on one plate before locking the set. Imagine stays the default.

**Hands:** Imagine never generates hands. See the rule at the top of this file.

Imagine also does not generate the bag, the opponent's body, or a character clip. LED strips on a board, if visible, stay dark. Unity draws the light. No logos, no readable text.

### Classes

| Group | Class | What it is |
|---|---|---|
| Background plates | BACKGROUND | Ambient cookout loops. Three lights. |
| Camera plates | BACKGROUND | Thrower View, Far Board Cam, Neighbor Cut, 2v2 partner shot. |
| Reaction plates | PUNCTUATION | Short crowd cuts. |

### Length and input (from the plate list)

- Imagine cap 15 seconds. Ask for 8 seconds by default.
- Extend is 2–10 seconds at 720p, only when an 8 second camera take ends before the landing hold, and the total stays at or under 15 seconds. A take whose boards drift during Extend is discarded.
- Flight on the prototype is about 0.55–1.15 seconds (the `flightMs` formula in section 3), then a short slide. Far Board Cam cuts in at 0.33 seconds after release. Hold about 1.2 seconds after the bag stops, then return to Thrower View. That window fits in 8 seconds.
- Reactions: ask for 4 seconds. If the tool emits 8, play the first 4. Do not Extend a reaction.
- Background and camera plates are seamless 8 second loops so aiming can outlast one play. Unity crossfades the loop. The same reaction does not play twice in a row.
- Frame is **16:9**. `artifacts/kling/cornhole-prompts.md` on this tree still says 9:16. The plate list says not to use that frame.
- Text-to-video is not used. Lock a still, then:
  - Background and camera: first+last-frame loop from the approved still.
  - Reaction: image-to-video from the approved Thrower View still. One-shot.
- Reject any clip whose board has moved. Check by laying the clip over the locked still.

Crowd direction in the prompts follows `docs/visual-camera-plan.md` and still needs Sme. Faces stay small and far. A 2026-11-10 Face Scan test (status note on the plate list) showed face morphing and a flickering beam on a locked-off still. That is why hands stay in Unity.

### The 16 plates

| ID | Class | Name | Loop or one-shot | Length | Input mode |
|---|---|---|---|---|---|
| BG-GOLDEN | BACKGROUND | Golden hour cookout | Seamless loop | 8 s | First+last-frame loop |
| BG-OVERCAST | BACKGROUND | Overcast cookout | Seamless loop | 8 s | First+last-frame loop |
| BG-DUSK | BACKGROUND | Dusk cookout | Seamless loop | 8 s | First+last-frame loop |
| CAM-THROWER | BACKGROUND | Thrower View | Seamless loop | 8 s | First+last-frame loop |
| CAM-FAR | BACKGROUND | Far Board Cam | Seamless loop | 8 s | First+last-frame loop |
| CAM-NEIGHBOR | BACKGROUND | Neighbor Cut (singles) | Seamless loop | 8 s | First+last-frame loop |
| CAM-PARTNER | BACKGROUND | 2v2 partner shot | Seamless loop | 8 s | First+last-frame loop |
| RX-HOLE-1 | PUNCTUATION | Hole cheer A | One-shot | 4 s | Image-to-video |
| RX-HOLE-2 | PUNCTUATION | Hole cheer B | One-shot | 4 s | Image-to-video |
| RX-HOLE-3 | PUNCTUATION | Hole cheer C | One-shot | 4 s | Image-to-video |
| RX-MISS-1 | PUNCTUATION | Miss groan A | One-shot | 4 s | Image-to-video |
| RX-MISS-2 | PUNCTUATION | Miss groan B | One-shot | 4 s | Image-to-video |
| RX-MISS-3 | PUNCTUATION | Miss groan C | One-shot | 4 s | Image-to-video |
| RX-AMB-1 | PUNCTUATION | Ambient energy A | One-shot | 4 s | Image-to-video |
| RX-AMB-2 | PUNCTUATION | Ambient energy B | One-shot | 4 s | Image-to-video |
| RX-AMB-3 | PUNCTUATION | Ambient energy C | One-shot | 4 s | Image-to-video |

Each plate in the source file has ID, type, purpose, framing, length, loop or one-shot, input mode, an Imagine prompt draft, acceptance, and a Unity hookup. Prompts are short on purpose.

### Playback the presenter is supposed to grow into (planned)

The plate list wires playback through `MatchPresenter`. This tree's greybox does not play video. The intended cuts:

| Moment | Call | Plate |
|---|---|---|
| Match opens | `OnMatchOpened` | Approved light's background loop and CAM-THROWER. Invisible boards on the video boards. Hand rig hidden until someone throws. |
| Aim, pull, shake | `OnAimChanged` | Stay on CAM-THROWER. `handShake` above 1 trembles the rig. |
| A throw exists | `OnThrowResult` | Play that seat's gesture on the rig. Schedule the cut below. |
| Bag in the air | `OnReplayFrame` | Move the Unity bag. The plate has no bag. |
| Hole | `OnCue` reason `hole`, sound `cornhole_hit` | Random RX-HOLE, then back. |
| Miss | `OnCue` reason `foul`, sound `ground_thud` | Random RX-MISS, then back. |
| Woody | `OnCue` reason `landing`, sound `bag_thud` | Stay on the camera plate. |
| Inning score | `OnScore` | HUD only. |
| Reduce motion | `OnCue(..., true)` | Skip the reaction cut. |

Camera cuts for one throw, from the plate list:

- Local player, and anyone throwing at the far board: start on CAM-THROWER (or CAM-NEIGHBOR when that plate is up). At 0.33 s cut to CAM-FAR. Hold about 1.2 s after the bag stops, then CAM-THROWER. `boardCam` false: stay on the plate that showed the release.
- Singles, the player beside you: CAM-NEIGHBOR, then the same 0.33 s cut to CAM-FAR.
- 2v2 partner at the opposite end: CAM-PARTNER. They throw at your board, so do not cut to CAM-FAR. On release, return to CAM-THROWER and let the Unity bag land on your board.
- 2v2 opponent beside you: no extra plate. Their rig enters from the side of CAM-THROWER that is not the local player's side, then CAM-FAR at 0.33 s.

The release the presenter uses is the rig's release, not a frame hunted inside an Imagine clip.

Generation order, when Sme says to start: stills for the three lights and four cameras, stop for approval, then loops (dusk cameras first), then reactions from the approved CAM-THROWER still, then wire `MatchPresenter`. A failed take is discarded. Do not paint a hand out of a bad frame and keep it.

### What Dice has today (unverified paths)

The plate list cites these as Dice-specific files on branch `cursor/dice-lineup-presentation-f9f3`. They were not re-checked on disk:

- `unity/StreetDiceGreybox/Assets/FirstPersonDiceHand.cs`
- `StreetDiceHandPreviews.cs`
- `Editor/ThrowMotionCapture.cs`
- `ThrowMotionVerification.cs`
- `Resources/Fades/CatchSkin.cginc`
- `CatchVideo.shader`
- catch, plant, tap, and wave Kling clips
- `docs/hand-pack-integration.md`
- `docs/brief-for-claude-3d-hand-dice.md`
- `docs/reference/3d-hand-dice/*`

Those Kling clips are Dice video references. Cornhole does not remake them in Imagine.

The shared rig, as specified on the plate list: one prop slot (die or bag), one purchased skin, the same gesture set (throw, plus catch, plant, tap, and wave), package path `unity/Packages/com.iplay.handrig` on `cursor/shared-iplay-hand-rig`. Cornhole maps aim, pull, flick, lean, and `handShake` onto that motion through `OnAimChanged`. It does not invent a second gesture vocabulary. Do not copy the Dice scripts into Cornhole as a fork.

---

## 9. Skins and colors

### Team bag colors (in this tree)

Twelve colors, display order, `BAG_COLORS` in `server/src/core/constants.ts`. Teams pick in the `colors` phase. First come, first served. The two teams cannot share a color. Either partner may pick for the team.

| id | Name | Hex |
|---|---|---|
| `black` | Black | `#1B1B1B` |
| `white` | White | `#F4F4F2` |
| `red` | Red | `#C8102E` |
| `orange` | Orange | `#FF6A13` |
| `yellow` | Yellow | `#FFD100` |
| `kelly-green` | Kelly Green | `#009A44` |
| `royal-blue` | Royal Blue | `#1D4ED8` |
| `sky-blue` | Sky Blue | `#6CC5F0` |
| `purple` | Purple | `#6B2C91` |
| `hot-pink` | Hot Pink | `#E0218A` |
| `teal` | Teal | `#00A5A8` |
| `maroon` | Maroon | `#6D1A2A` |

The client reads the palette from `GET /api/meta`. The top-down map paints bags with those hexes. LED hole bursts use white plus the scoring team's hex (`server/src/presentation/effects.ts`). `color_picked` updates `MatchModel.Colors`. That path works. Character pick does not (section 10).

There is no cosmetic shop, no unlock, and no per-player bag skin beyond the team color. `README.md`: nothing is for sale.

### Planned art, not a second ruleset

`docs/visuals-todo.md` and `docs/art-briefs/`:

- 3D bag with the iPlay mark (`assets/logo/`), the 12 team colors as materials, slick side and sticky side. Hook: `OnReplayFrame`.
- Three hand skin shades, left- and right-handed, like Street Dice. The shared rig's skin is the purchased asset (section 6). A second Cornhole skin is not part of the rig spec.
- LED board, aim line, landing ring, wind streamers, replay ghost of the calm-day path, menu art in the Street Dice palette.
- Team B stitched X is mentioned on the board preview template as a color-blind cue. It is not drawn by the Unity greybox.

`Theme.cs` is the menu palette already in the greybox. It is not a swappable skin system.

---

## 10. Known client bugs

Found by round-trip tests on `cursor/cornhole-roundtrip-tests-8bd6` (commit on that branch adds `server/test/roundtrip.test.ts` and `server/test/helpers/phoneClient.ts`). The tests talk to the real server. The phone side is a TypeScript mirror of `MatchSocket`, `MatchModel`, and `ThrowReplay`, not the Unity player. Both bugs are still in this tree's C#. The tests are `it.fails`, so the suite stays green until the client is fixed. This spec did not re-run them.

### Bug 1. `character_picked` never reaches the pick screen

**In this tree.** `MatchModel.ApplyEvent` hits `character_picked` and breaks. It does not write `Seat.CharacterId`.

`MatchSession.PickCharacterAsync` posts `POST /api/matches/:id/character` and throws away the view the server returns. `Try` only keeps the error code.

`CornholeApp.Match.DrawCharacterPick` decides "taken" by scanning `m.Seats[].CharacterId`.

So a successful pick is stored on the server (the passing test `the server stores a character pick and tells the other phone` reads `characterId: "keisha"` off the view) and neither phone's pick screen can see it.

The failing test is `a phone records a character pick on the seat the pick screen reads`. It expects both phones' seat `A1` to show `keisha` after the host picks.

`color_picked` does update `MatchModel.Colors`. A fix has to give character picks the same treatment, or apply the view from `POST …/character`. Remove `.fails` on that test once the seat the pick screen reads is updated. Do not weaken the assertion.

### Bug 2. A reconnect throw with `framesOmitted` still raises a replay

**In this tree.** `MatchSession.emit` strips `flight` and `slide` on the log copy and sets `framesOmitted: true`. Live sockets still get the frames.

`MatchModel.ApplyEvent` for `throw_result` always assigns `LastThrow`, applies the board, and raises `ThrowResultReceived`. `FramesOmitted` is parsed onto `ThrowResult` and nothing in the Unity client reads it.

`CornholeApp.Match.OnThrowResult` always arms `replayStart`. `ThrowReplay.At` with an empty flight, while `tMs < flightMs`, returns a flight frame at `landing`.

The contract in `docs/api-contract.md`: show the new state, and do not replay the old animation.

The passing test `a reconnect applies the throws it missed without their animation frames…` checks the board: `framesOmitted` true, `flight` and `slide` empty, `status` and `resting` equal to the live throw. The failing test `a throw whose animation frames were dropped does not start a replay` expects the presenter notification list for that throw to stay empty. The harness records a presentation for every `throw_result`, which is what `ThrowResultReceived` does today.

A later live throw on the reconnected phone is a normal replay (`framesOmitted` false, flight samples present). The bug is only the stripped event.

Fix by not arming a replay when `framesOmitted` is true (and when `flight` is empty for that reason). Keep applying `status`, `resting`, `updates`, and the board. Remove `.fails` once an omitted throw does not start a replay.

---

## 11. Open items

Still open on this tree's `docs/open-decisions.md`, plus items the plate list and the hand PRs add. Planned or unverified, as marked.

| Item | State |
|---|---|
| Purchased hand asset product name and path | **Open.** Maps to `Resources/FirstPersonHands/FirstPersonHand_L` and `FirstPersonHand_R` once Sme names it. Plate list Needs Sme. |
| Plate approvals and crowd casting | **Open.** Plate list Needs Sme. Dusk is the default camera grade until another light is chosen. Generation waits until Sme says to start. |
| Whether to test more than one video tool on one plate | **Open.** Imagine stays the default. PRs 1–3. This tree's older docs still describe a Kling / Veo 3.1 / Seedance bake-off. |
| Vector iPlay mark for the bag print | **Open.** `docs/open-decisions.md`. The raster mark is in `assets/logo/`. |
| Domain name and Storage Box | **Open.** `docs/open-decisions.md`, `docs/production-checklist.md`. |
| Age-check strength and `MATCH_HISTORY_DAYS` | **Open.** Needs a lawyer. The setting exists. |
| Throw-feel numbers (wind, 3° zone, push per degree, shaky-arm timing) | **Open.** First guesses. First real-phone test. `docs/throwing-controls.md`. |
| Unity Play test of the hand presenter and bag flight | **Open.** PR 4 and PR 6 were not played in the editor. |
| Package-side handle for the released bag | **Open.** `CornholeBagPropView` exposing the released `Transform` belongs in Street Dice. The Cornhole pin was not moved. |
| Character clips and release-frame markers | **Planned.** `docs/characters.md`, `docs/visuals-todo.md`. Outside the Imagine plate list. |
| 3D bags, LED board mesh, aim guide, wind dressing, menu art | **Planned.** `docs/visuals-todo.md`. |
| Street Dice doc paths and the inside of `com.iplay.handrig` | **Unverified** from this environment. |

`docs/production-checklist.md` is the owner list: lawyer review of privacy and terms, moderation timings, `TERMS_VERSION`, DNS, backups, the visuals, and the first device pass (Unity 6 open, Vivox, ads keys, sign-in, ranked, reconnect). Those checkboxes were not re-audited line by line for this spec.

---

## 12. Related pull requests

| PR | What this spec uses it for |
|---|---|
| [iPlay-Cornhole #3](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/3) | Draft. Imagine plate list. Branch `cursor/cornhole-imagine-plate-list`. |
| [iPlay-Cornhole #4](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/4) | Draft, onto `claude/cornhole-game-prototype-p9nt6j`. Consumes `com.iplay.handrig`. Opt-in `SharedHandRigPresenter`. |
| [iPlay-Cornhole #6](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/6) | Draft, onto PR 4's branch. Bag flight after the 0.48 s release. `BagFlightVisual`. |
| [iPlay-StreetDice #3](https://github.com/unclesme15-a11y/iPlay-StreetDice/pull/3) | Shared rig package. Cited by PR 3 and PR 4. The repo was not readable here, so the diff was not re-reviewed. |
| [iPlay-StreetDice #5](https://github.com/unclesme15-a11y/iPlay-StreetDice/pull/5) | Linked as requested. **Unverified.** HTTP 404 from this environment. This spec does not describe its diff. |

Also in flight, not required to implement the game, and not merged into the prototype branch: [PR 1](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/1) and [PR 2](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/2) (Imagine as the default tool in the older prose). [PR 5](https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/5) on this repo is the hand-rule callout, merged to `main` only.

Round-trip branch, no PR number recorded in this tree: `cursor/cornhole-roundtrip-tests-8bd6`.

## 13. What a later change must keep

- The server decides every result. The phone sends a gesture. Art, the hand rig, and Imagine plates do not score.
- Imagine never generates hands. Hands come from `com.iplay.handrig`, composited over Imagine footage.
- A `throw_result` with `framesOmitted: true` updates the board and does not start a replay.
- `character_picked` has to become visible on the seat the pick screen reads.
- `IPlay.Cornhole.Core` stays free of Unity and of the hand package.
- The top-down board remains the default until something opts into `SharedHandRigPresenter`.
- Do not fork the Dice hand scripts into this repo.
