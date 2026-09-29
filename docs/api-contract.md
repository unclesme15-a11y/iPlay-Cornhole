# API Contract (protocol 2)

This is everything the Unity client needs to talk to the server. The server decides every result. The phone sends **only a swipe**, and gets back what happened.

**In plain terms:** the phone says "I swiped this hard, at this angle." The server works out where the bag lands, slides and bumps into other bags, then tells every phone the same story so all of them show the same landing.

Base URL: wherever the server runs (`http://localhost:3000` in dev). JSON everywhere. `GET /api/version` returns `protocol: 2`. Protocol 1 (per-match tokens) is gone: everyone now signs in.

## Headers every app request should send

```
X-Client-Version: 1.4.2        (the app's version, x.y.z)
X-Client-Platform: ios         (ios | android, for support)
Authorization: Bearer <token>  (after sign-in)
Content-Type: application/json (fine to send even when there is no body)
```

If the server has a minimum app version set, an older app gets `426` (see **Updates and maintenance**).

## Signing in

Everyone has an account. There are three ways to get one, and all return a **session token** (43 characters) that you send as `Authorization: Bearer <token>`. A session lasts 90 days from its last use. Store it in the phone's secure storage.

### Guest (play right away)

`POST /api/auth/guest` with `{ "displayName": "Uncle Me" }` (name optional; you get `Player4821` otherwise).

```json
{ "token": "…43 chars…", "expiresAt": "2026-12-28T…Z", "account": { "id": "…", "displayName": "Uncle Me", "isGuest": true }, "created": true, "linked": false, "switched": false }
```

A guest can play everything. **If they lose the token (new phone, reinstall), the guest account is gone**, so the app should nudge guests to add Apple or Google sign-in.

### Apple and Google

`POST /api/auth/apple` with `{ "identityToken": "…", "nonce": "…", "displayName": "…" }`
`POST /api/auth/google` with `{ "idToken": "…", "nonce": "…", "displayName": "…" }`

- **Send a nonce.** Make a random string, give it to Apple/Google when you start sign-in, and send the same string here. It stops a stolen token being replayed. (Either the raw string or its SHA-256 in the token works.)
- `displayName` is optional and is only used the first time.
- **If the app is already signed in as a guest** (the `Authorization` header is present), the Apple/Google identity is **attached to that guest**. The account keeps its id, stats and history, and stops being a guest (`linked: true`).
- If that Apple/Google identity already has an account (for example on a new phone), you are signed into **that** account instead (`switched: true`). The guest account you arrived with is left behind.
- Returns `201` for a brand-new account, `200` otherwise. Same body as guest.
- `501 provider_not_configured` if the server has no client ids for that provider. `GET /api/meta` → `signIn` tells you which buttons to show.

The server stores only Apple's/Google's id for the person. **It never reads or stores their email.**

### Other

`POST /api/auth/logout` ends this session only.

## My account

| Call | What it does |
|------|--------------|
| `GET /api/me` | `{ account, stats, signInMethods: ["apple"], activeMatchId }`. **Call this when the app starts.** If `activeMatchId` is set, offer to rejoin that match (after a crash or a server restart). |
| `PATCH /api/me` `{ displayName }` | Rename. Passes the name filter. The first custom name is free, then one change every 7 days (`429 rename_cooldown` with `retryAt`). |
| `DELETE /api/me` | **Erases the account** (required by the app stores). Pulls you out of any match, deletes sign-in links, sessions, stats and blocks. Old match history stays for the other players, with your name replaced by "Deleted player". |
| `GET /api/me/export` | Everything held about the person, as JSON. |
| `GET /api/me/matches?limit=20&before=<iso date>` | Match history, newest first. Pass the returned `next` as `before` for the next page. |

`stats` is `{ games, wins, losses, leaves, throws, holes, boards, fouls }`. Leaving a match early adds a `leave` and no win or loss. An abandoned match changes nobody's stats.

### Names

Every name a person types goes through the same filter: 3 to 20 characters, letters (any language), numbers, spaces and `. _ ' -`. No emoji or invisible characters, no profanity or slurs (including `sh1t`, `f.u.c.k`, stretched letters), and nothing that looks like the game or its staff (iPlay, Admin, Support…). Errors: `name_length`, `name_chars`, `name_profane`, `name_reserved` (all `400`). Show the message to the person.

## Blocking and reporting

| Call | What it does |
|------|--------------|
| `GET /api/blocks` | Who I've blocked. **Use this list to mute their voice.** Blocking is private and one-way. |
| `PUT /api/blocks/:accountId` / `DELETE …` | Block / unblock. |
| `POST /api/reports` `{ accountId, matchId?, reason, note? }` | Report someone. `reason` is `harassment`, `cheating`, `inappropriate_name` or `other`. Repeat reports of the same person while one is open are merged, and there is a limit of 10 an hour. |

Other players' account ids come from `view.seats[].accountId`.

## Setup screen data

`GET /api/meta` returns the catalog: the 12 bag colors, 8 characters, target scores, defaults, board and bag sizes, name limits, which sign-in methods are on, the LED layout and the sound list.

## Matches

### `POST /api/matches` (create)

```json
{
  "config": { "mode": "2v2", "playTo": 21, "bust": false, "skunk": false, "distance": "regulation", "throwTimerSec": 20, "boardCam": true, "tutorial": false },
  "seats": { "B1": { "kind": "human" }, "A2": { "kind": "bot", "level": "pro" } }
}
```

Everything is optional (2v2, play to 21, you in `A1`, everyone else a Regular bot). Unknown fields are rejected, which is how "no wagers" is enforced. You are the host, in seat `A1`, using your account's name.

Returns `201`:

```json
{ "matchId": "V97ZEKPH", "seat": "A1", "invite": { "code": "V97ZEKPH", "url": "https://…/join/V97ZEKPH", "deepLink": "iplaycornhole://join/V97ZEKPH" }, "view": { … } }
```

Seats: `A1`, `B1` (near end) and `A2`, `B2` (far end). Team A is `A1` + `A2`. In 1v1 only `A1` and `B1` exist.

### One match at a time

An account can be in only one running match. Creating or joining another returns `409 already_in_match` with `matchId` so the app can take them back:

```json
{ "error": { "code": "already_in_match", "message": "You are already in a match", "matchId": "V97ZEKPH" } }
```

### Inviting friends

`invite.url` is the link to share. Tapping it opens the app if it's installed (universal links / app links), or a small web page with store buttons if not. `invite.deepLink` is for the app to open directly.

- `POST /api/matches/:id/invite` returns the invite again (any seated player).
- `GET /api/invites/:code` is a public preview for the join screen: `{ code, hostName, mode, playTo, phase, openSeats, canJoin }`. `404 invite_expired` if the match is over, full, or unknown.
- `POST /api/matches/:id/join` with `{ "seat": "B1" }` (seat optional: first open one). Only while in the lobby. Joining a match you're already in just returns your seat.

### Setting up seats in the lobby (host only)

| Call | What it does |
|------|--------------|
| `POST /api/matches/:id/seats` `{ seat, kind: "human"\|"bot", level? }` | Make an empty seat a **human seat** (so a friend can take it) or a **bot** of a skill level. Not the host's own seat, and not a seat with someone in it. |
| `POST /api/matches/:id/kick` `{ seat }` | Remove a player. Their seat stays open. They get a `kicked` event. |
| `POST /api/matches/:id/start` `{ "fillOpenWithBots": true }` | Start. Without the flag, `409 seats_open` while any human seat is empty. With it, empty human seats become Regular bots. Body is optional. |

### The phases

`view.phase`: `lobby` → `characters` → `colors` → `toss` → `playing` → `finished` (or `abandoned`).

| Phase | What players do | Ends when |
|-------|-----------------|-----------|
| `characters` | `POST …/character` `{ "characterId": "keisha" }`. First come, first served (`character_taken`). | Every human picked, or after 20 s. Unpicked players get a random free character. Bots get what is left. |
| `colors` | `POST …/color` `{ "colorId": "hot-pink" }`. **First come, first served.** A team picks once and no two teams share a color. Either partner can pick for their team. | Every human team picked, or after 15 s (then random free colors; teams with no humans pick last). |
| `toss` | Watch the coin flip (`coin_toss` event). | About 3 s. |
| `playing` | Throw when it's your turn. | Someone wins. |

`view.deadlineAt` is when the current pick phase auto-completes (epoch ms).

### Throwing: `POST /api/matches/:id/throw`

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

Returns `{ "accepted": true }`. The result arrives as a `throw_result` event. Only valid when `view.turn.seat` is your seat and `view.turn.controlledBy` is `"human"` (`409 not_your_turn` otherwise). The server adds a small random wobble.

### Leaving

`POST /api/matches/:id/leave`. In the lobby your seat frees up (the host leaving cancels the match). During a match a bot takes your seat right away, and you can't rejoin. If no humans are left the match is abandoned. After the match ends, leaving counts as "no thanks" to a rematch.

### Rematch ("play again")

When a match finishes, `view.rematch` opens: `{ deadlineAt, votes: { "<accountId>": true|false }, matchId, cancelled }`. Players get **60 seconds**.

- `POST /api/matches/:id/rematch` `{ "accept": true }` (or `false`).
- As soon as every human has answered (or the 60 s are up), it starts if at least one said yes. Anyone who said no (or nothing) is replaced by a bot of the same character.
- The new match is a **new match id** (`view.rematch.matchId`, also the `rematch_ready` event). Switch to it. It has the same setup, **keeps everyone's seat, character and bag color, skips the picks**, and goes straight to the coin toss (5 s, to give phones time to switch). `view.rematchOf` links back.
- If it can't start (nobody said yes, maintenance, someone already joined another match) you get `rematch_cancelled` with a `reason`.

### Reading the match

`GET /api/matches/:id` returns the **view** (public; add your token to also get `you`):

```
id, protocol, seq, createdAt, rematchOf, phase, config,
seats[]: { id, team, startEnd, kind: "human"|"bot", botLevel, name, claimed, connected, accountId, characterId, controlledByBot }
colors: { A?: colorId, B?: colorId }
deadlineAt, scores: { A, B }, inning, firstTeam
turn: null | { seat, team, bagId, controlledBy: "human"|"bot", deadlineAt, fromEnd, targetEnd, throwNumber, bagsLeft: {A,B} }
board[]: { id, team, status: "board"|"hole", x, y }   // bags on the target board now; x,y null for bags in the hole
history[]: one entry per finished inning
winner, winReason: "score"|"skunk"|"forfeit"|"abandoned"|null
rematch: null | { deadlineAt, votes, matchId, cancelled }
you: null | { playerId, seat, team, host }        // playerId is your account id
```

`turn` is `null` in the short pause between throws. `fromEnd` is which end the bags are thrown **from** this inning (0 near, 1 far) and `targetEnd` is the board they land on. Ends alternate every inning.

`GET /api/matches/:id/events?since=<seq>` returns `{ events, seq, resync }`.

## Realtime: `GET /api/matches/:id/ws`

1. Connect, then send within 5 s: `{ "type": "hello", "bearer": "<session token>", "since": <lastSeq>, "clientVersion": "1.4.2" }`. `bearer` is optional (without it you're a read-only spectator, as is a signed-in person who isn't in the match). `since` and `clientVersion` are optional.
2. The server answers `{ "type": "welcome", "view": {...}, "missed": [ …events after since ], "resync": false }`.
3. Then every event arrives as `{ "type": "event", "event": { "seq": 41, "at": 1700000000000, "type": "throw_result", "data": {...} } }`.
4. Send `{ "type": "ping" }` any time and get `{ "type": "pong" }`. The server also pings every 25 s.

**Close codes:** `1012` the server is restarting: **reconnect and resume** (send your last `seq`). `4400` bad hello. `4401` bad credentials (sign in again). `4403` banned. `4404` unknown match. `4408` no hello in 5 s. `4426` app too old (an `error` message with the versions comes first).

### Server restarts

Live matches are saved to the database. If the server restarts, **matches carry on**, and the app should just reconnect. What to expect:

- The socket closes with `1012`. Reconnect (retry every second or two). The same login keeps working.
- Everyone gets the usual **30 seconds** to reconnect before a bot takes their seat. A human whose turn was open gets at least 8 more seconds to throw.
- Event numbers continue from where they were, but some recent events may be lost. If your `since` is higher than the server's latest event, the welcome has **`resync: true`**: throw away what you had and draw from `view`.
- In a hard crash, the match can be up to a quarter of a second behind. Play carries on from there.

### Connection and leaving rules

Your seat counts as **connected** while at least one of your sockets is open. If your last socket closes, a 30 s clock starts. If you're not back by then, a bot plays your seat until you return (you get the seat back on your next turn). A match with nobody connected for 2 minutes is abandoned. Finished matches stay readable for 10 minutes.

**Missed `throw_result` events have their `flight` and `slide` animation frames removed** (`framesOmitted: true`) to keep memory small, but keep the outcome. Just show the new state, and don't replay old animations.

### Events

| `type` | `data` | When |
|--------|--------|------|
| `seats` | `{ seats }` | Someone joined, left, connected, disconnected, or the host changed a seat |
| `kicked` | `{ seat, accountId }` | The host removed a player |
| `phase` | `{ phase, deadlineAt }` | Phase changed |
| `character_picked` | `{ seat, characterId, auto }` | `auto` is true if assigned on timeout |
| `color_picked` | `{ team, colorId, auto }` | Same |
| `coin_toss` | `{ firstTeam }` | Who throws first |
| `turn_start` | `{ seat, team, bagId, inning, fromEnd, targetEnd, throwNumber, bagsLeft, controlledBy, deadlineAt }` | A turn opens. `deadlineAt` is the throw clock (null for bots or no timer) |
| `turn_control` | `{ seat, controlledBy }` | A bot took over the current turn |
| **`throw_result`** | see below | **A bag was thrown** |
| `throw_timeout` | `{ seat, bagId }` | The clock ran out (a foul) |
| `inning_complete` | `{ result }` | All 8 bags thrown, scored. `result` has `points`, `scoringTeam`, `scored`, `scoreAfter`, `busted`, `finalBags` |
| `score` | `{ team, points, scores, led }` | A team scored this inning, with a soft LED pulse cue |
| `match_end` | `{ winner, reason, scores, led }` | Game over, with the victory LED cue |
| `rematch_update` | `{ deadlineAt, votes }` | The play-again window opened or someone voted |
| `rematch_ready` | `{ matchId }` | **Switch to this match** |
| `rematch_cancelled` | `{ reason }` | No rematch: `nobody_accepted`, `unavailable`, `maintenance`, `already_in_match`, `server_busy` |
| `seat_takeover` | `{ seat, reason: "disconnect"\|"left" }` | A bot took a human's seat |
| `seat_reclaimed` | `{ seat }` | The human is back |
| `resumed` | `{ phase }` | The server restarted and picked this match back up |
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

For every bag that drops in the hole there is one cue:

```json
{ "atMs": 1090, "reason": "hole", "bagId": "A1-i1-b1", "sound": "cornhole_hit",
  "led": { "pattern": "flash_burst", "durationMs": 1800, "boardEnd": 1, "colors": ["#FFFFFF", "#1D4ED8"] } }
```

Play `sound` and start the `led` pattern at `atMs`. Other cues are just sounds: `bag_thud` when a bag lands on the board and `ground_thud` when it hits the grass. `boardEnd` says which board's lights to use (0 near, 1 far). If the player has reduce-motion on, use `led.cornhole.reducedMotion` from `GET /api/meta` (`steady_glow`) instead of the strobe. See `docs/led-board-and-bags.md`.

## Updates and maintenance

- `GET /api/version` (never blocked): `{ protocol, minClientVersion, latestClientVersion, maintenance, serverTime }`. Call it at launch.
- If the app is older than `minClientVersion`, every other `/api` call returns **`426`**:

```json
{ "error": { "code": "client_outdated", "message": "Please update…", "minVersion": "1.2.0", "latestVersion": "1.4.0", "storeUrls": { "ios": "https://…", "android": "https://…" } } }
```

  Show an "Update required" screen with the store link. `client_version_required` means the app sent no version. The realtime hello does the same check (close code `4426`).
- While `maintenance` is true, **new matches, joins and rematches return `503 maintenance`**. Matches already running are not affected. Show "we're updating, back in a minute".

## Errors

Every error has the same shape, and `code` is stable, so switch on the code and not the message:

```json
{ "error": { "code": "color_taken", "message": "hot-pink was taken by Team A" } }
```

Some errors carry extra fields (`matchId`, `retryAt`, `minVersion`, `reason`, `bannedUntil`).

| Status | Codes |
|--------|-------|
| 400 | `bad_request` (with `issues`), `bad_config`, `bad_seat`, `bad_character`, `bad_color`, `bad_gesture`, `bad_client_version`, `nonce_required`, `name_length`, `name_chars`, `name_profane`, `name_reserved` |
| 401 | `unauthorized`, `invalid_identity_token` |
| 403 | `not_host`, `account_banned` (with `reason`, `bannedUntil`), `guests_disabled` |
| 404 | `match_not_found`, `unknown_player`, `unknown_account`, `invite_expired`, `not_found` |
| 409 | `wrong_phase`, `not_your_turn`, `match_full`, `seat_taken`, `seat_is_bot`, `seat_empty`, `seats_open`, `character_taken`, `color_taken`, `team_already_picked`, `already_in_match`, `already_linked`, `no_rematch`, `rematch_closed` |
| 413 | body over 16 KB |
| 426 | `client_outdated`, `client_version_required` |
| 429 | `rename_cooldown`, `too_many_reports`, or the rate limit (slow down) |
| 501 | `provider_not_configured` |
| 503 | `server_busy`, `maintenance` |

A banned account gets `403 account_banned` on every call, and can't sign in again, until the ban ends.

## Staff API (not for the app)

Guarded by the `ADMIN_TOKEN` secret and off unless it is set. See `docs/operations.md`.
