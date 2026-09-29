# iPlay Cornhole

Separate repo for the iPlay cornhole game. It shares the broader iPlay identity and style with iPlay Street Dice (first-person view, Kling video backgrounds, Unity overlays, server-authoritative results), but it's planned and built as its own game.

## Core Direction

- First-person view. The only body the player ever sees of themselves is their throwing hand holding the bag at the bottom of the screen.
- Real-video background made with Kling. Computer opponents are **video characters**: short clips of a person getting ready, throwing, and reacting.
- Unity draws the bags, the LED board lights, the HUD and the audio. The video provides the people and the setting.
- **The server decides every result.** The phone only sends a swipe.
- Regulation cornhole only: 1v1 and 2v2. Any seat can be a human or a video bot.
- A Match Setup screen before every game (target score defaults to 21).
- First scene: a big open park at a summertime hood BBQ cookout.
- **No wagers or money of any kind, and nothing for sale.** The only income is ads (never during a match).
- **Adults only (18+).** Voice chat isn't filtered, so every iPlay game is for adults.
- **Ranked play** for singles and duo teams, with global leaderboards.
- **Voice chat** (Unity Vivox): a table channel and a team channel.
- The custom iPlay LED board flashes and plays a game-show ring-in sound the instant a bag drops in the hole. Every bag has the iPlay mark on it.

## What's Built

| | Status |
|---|---|
| Rules engine (innings, cancellation scoring, win/bust/skunk, fouls) | Done, tested |
| Server physics (flight, slide, bag-on-bag, hole) | Done, tested |
| Bots (Rookie / Regular / Pro) | Done, tested |
| Lobby (character pick, first-come bag colors, coin toss, timers, bot takeover) | Done, tested |
| REST + WebSocket API | Done, tested |
| **Accounts:** guest, Sign in with Apple, Google; sessions; delete and export my data | Done, tested |
| **Database** (Postgres): accounts, match history, stats, reports, blocks | Done, tested on real Postgres |
| **Live matches survive a server restart or crash**, with safe deploys | Done, tested on real Postgres |
| **Invite links**, filling seats, removing players, start with bots | Done, tested |
| **Rematch** ("play again") | Done, tested |
| **Name filter**, blocking, reporting, bans (staff API) | Done, tested |
| **App version check** ("update required"), maintenance mode | Done, tested |
| LED board config, sound effects, iPlay logo for bags | Done, tested |
| Interactive board preview | Done (`npm run preview`) |
| **Adults-only (18+)**, terms version, leaderboard opt-out | Done, tested |
| **Ranked play:** matchmaking, duo parties, Elo ratings, forfeit/void rules | Done, tested |
| **Global leaderboards** (singles and teams) | Done, tested |
| **Voice chat** tokens (Vivox), table + team channels, block-list muting | Server done, tested. Unity side not started |
| **Ad pacing** settings for the app | Done (the ad SDK itself is a phone-side job) |
| **Hetzner deploy pack** (docker-compose, Caddy/nginx, deploy/backup/restore) | Written and validated, **not yet run on a real box** |
| Unity client | Not started (build against `docs/api-contract.md`) |
| Kling video plates and character clips | Not started (`artifacts/kling/cornhole-prompts.md`) |

## Repo Map

- `server/`: the game server (TypeScript, Node 22, Postgres). See below.
- `deploy/`: run it on your Hetzner box (`docs/hetzner-deploy.md`).
- `assets/`: sound effects (`audio/`), the iPlay mark for the bags (`logo/`), and the LED board spec (`board/`). Generated files are checked by tests.
- `preview/`: template for the interactive board preview page.
- `docs/api-contract.md`: **what the Unity client sends and receives.** `docs/operations.md`: **running, deploying and moderating the server.** `docs/data-and-privacy.md`: what is stored about people. `docs/game-rules.md`: rules contract. `docs/led-board-and-bags.md`: the board, sound and bags. `docs/visual-camera-plan.md`, `docs/multiplayer-plan.md`, `docs/characters.md`, `docs/roadmap.md`, `docs/open-decisions.md`.
- `artifacts/kling/cornhole-prompts.md`: Kling plate and clip shot list with prompts.

## Server

```bash
cd server
npm install
cp .env.example .env    # optional; the default keeps a local database in ./.data
npm run dev             # http://localhost:3000, restarts on change
npm run check           # typecheck + all tests (this is what CI runs)
npm run build && npm start
```

No database to install for development: by default it uses an in-process Postgres (`pglite://`). In production it needs a real Postgres (`DATABASE_URL=postgres://…`) and **refuses to start without one**. See `docs/operations.md` for every setting.

To also run the database tests against a real Postgres, point `TEST_DATABASE_URL` at any Postgres you can create databases on (CI does this with a service container):

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

Other scripts: `npm run assets` regenerates the sounds, logos and board JSON. `npm run preview` builds `preview/board-preview.html`.

**Docker:** `docker build -t iplay-cornhole-server server && docker run -p 3000:3000 -e NODE_ENV=production -e DATABASE_URL=postgres://… iplay-cornhole-server`. The image runs as a normal user and has a health check on `/health`.

### How it's organized

```
server/src/
  core/          rules: match engine, scoring, constants, config
  physics/       the bag simulation
  bots/          what a bot throws
  lobby/         match session (seats, picks, turns, rematch, restore), timers, live-match saving
  accounts/      accounts, sessions, Apple/Google checks, name filter, blocks/reports, history and stats
  ranking/       Elo ratings, ranked matchmaking and parties, leaderboards
  voice/         Vivox token signer and voice grants
  db/            Postgres and in-process drivers, migrations
  presentation/  LED + sound cues
  store/         registry of live matches
  http/          REST routes, WebSocket, version gate
  server.ts      start-up and shutdown order
```

The rules engine (`core/`) has no idea about networking, physics or the database: it takes the result of each throw and applies the rules, so it's easy to test and to trust.

### How live matches survive restarts

Every change to a running match is saved to the database within a quarter of a second. When a server starts it takes ownership of the live matches (only one server can), waits for the old one to finish during a deploy, restores what was running, and only then starts answering requests. On shutdown it tells phones to reconnect, saves everything, and lets go. See `docs/operations.md`.

### Things to know

- **One server instance runs all live matches.** A restart is safe but you can't run two at once. It has **not been load-tested**. Growing past one machine means sharing match state (for example Redis) and is not built.
- Sign in with Apple and Google are tested with locally made keys. They have **never been run against the real Apple and Google servers** (unreachable from where this was built), so test a real sign-in on a device before launch.
- Voice chat: the server hands out Vivox tokens; the Unity side (joining the channels, muting the blocked) is not built. Needs the four `VIVOX_*` settings and a real-device test.
- The deploy pack has only been validated (`docker compose config`, `bash -n`), not run: the machine it was written on had no Docker daemon. Try it on the box and expect small fixes.
- The ranking numbers (starting rating, how fast it moves, matchmaking window) are first guesses. Tune them after real games.
- Ranked matchmaking and parties are kept in memory. A restart empties the queue (players search again); running matches are saved and restored as usual.

## Decisions

See `docs/open-decisions.md`.
