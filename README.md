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
- **No wagers or money of any kind.**
- The custom iPlay LED board flashes and plays a game-show ring-in sound the instant a bag drops in the hole. Every bag has the iPlay mark on it.

## What's Built

| | Status |
|---|---|
| Rules engine (innings, cancellation scoring, win/bust/skunk, fouls) | Done, tested |
| Server physics (flight, slide, bag-on-bag, hole) | Done, tested |
| Bots (Rookie / Regular / Pro) | Done, tested |
| Lobby (character pick, first-come bag colors, coin toss, timers, bot takeover) | Done, tested |
| REST + WebSocket API | Done, tested |
| LED board config, sound effects, iPlay logo for bags | Done, tested |
| Interactive board preview | Done (`npm run preview`) |
| Unity client | Not started (build against `docs/api-contract.md`) |
| Kling video plates and character clips | Not started (`artifacts/kling/cornhole-prompts.md`) |

## Repo Map

- `server/`: the game server (TypeScript, Node 20+). See below.
- `assets/`: sound effects (`audio/`), the iPlay mark for the bags (`logo/`), and the LED board spec (`board/`). Generated files are checked by tests.
- `preview/`: template for the interactive board preview page.
- `docs/game-rules.md`: rules contract. `docs/api-contract.md`: what the Unity client sends and receives. `docs/led-board-and-bags.md`: the board, sound and bags. `docs/visual-camera-plan.md`, `docs/multiplayer-plan.md`, `docs/characters.md`, `docs/roadmap.md`, `docs/open-decisions.md`.
- `artifacts/kling/cornhole-prompts.md`: Kling plate and clip shot list with prompts.

## Server

```bash
cd server
npm install
npm run dev          # http://localhost:3000, restarts on change
npm run check        # typecheck + all tests (this is what CI runs)
npm run build && npm start
```

Other scripts: `npm run assets` regenerates the sounds, logos and board JSON. `npm run preview` builds `preview/board-preview.html`.

**Docker:** `docker build -t iplay-cornhole-server server && docker run -p 3000:3000 iplay-cornhole-server`. The image has a health check on `/health`.

### How it's organized

```
server/src/
  core/       rules: match engine, scoring, constants, config
  physics/    the bag simulation
  bots/       what a bot throws
  lobby/      match session: seats, picks, turns, timers, takeover
  presentation/  LED + sound cues
  store/      registry of live matches
  http/       REST routes and the WebSocket
```

The rules engine (`core/`) has no idea about networking or physics: it takes the result of each throw and applies the rules, so it's easy to test and to trust.

### Deploying: what to know

- **One server instance holds all live matches in memory.** That keeps things simple, but it means a restart ends live matches, and you can't run two instances behind a load balancer without sticky routing by match code. It has **not been load-tested** yet. The physics itself is cheap (the 300-match soak test plays about 24,000 throws in a few seconds on one core). When you need more, the next step is storing each match's state (the engine already serializes with `snapshot()` / `restore()`) in Redis. That isn't built.
- Set `TRUST_PROXY=true` behind a load balancer so the rate limits see real client IPs.
- The server uses no database and stores no personal data. Display names live only as long as the match.
- Voice chat (Vivox, as in Street Dice) is not wired in yet.

## Decisions

See `docs/open-decisions.md`.
