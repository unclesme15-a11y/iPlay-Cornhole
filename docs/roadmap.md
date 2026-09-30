# Roadmap

## Phase 1: Rules And Look Lock

- Approve the rules contract (`game-rules.md`) and settle what's left in `open-decisions.md`.
- Generate and lock the **Thrower View** still in Kling (text-to-image first; don't spend on video yet).
- Lock the matching Far Board Cam and Neighbor Cut stills from the same setting.
- Side-by-side test: the same Plate 1 plus one background prompt in Kling, Veo 3.1 and Seedance 2.0. Pick per clip type.
- Generate 3-4 random background life takes plus the cornhole nearby-reaction take, and an ambient audio bed with random one-shots.

## Phase 2: Game Server (DONE, see `server/`)

- [x] Cornhole rules engine: innings, alternating throws, cancellation scoring, target score from Match Setup (default 21), bust/skunk toggles.
- [x] Unit tests for each scoring example in `game-rules.md`.
- [x] Seeded bag physics on the server, with flight and slide frames sent to every phone.
- [x] Lobby, character pick, first-come bag colors, bots, disconnect takeover, REST + WebSocket API.
- [x] LED board config, the ring-in sound, and the iPlay logo for the bags.

## Phase 2b: Production Foundations (DONE, see `docs/operations.md`)

- [x] Accounts: guest, Sign in with Apple, Google. Sessions. Delete and export my data.
- [x] Postgres database with automatic, checksummed migrations. Tested on real Postgres.
- [x] Live matches survive a restart or a crash. Safe deploys (the new server waits for the old one).
- [x] Match history and player stats.
- [x] Invite links, filling seats, removing players, start with bots.
- [x] Rematch.
- [x] Name filter, blocking, reporting, bans, staff API.
- [x] App version check ("update required") and maintenance mode.
- [x] CI with a real Postgres, Dockerfile, health checks, operations guide, privacy data map.

## Phase 2c: Adults, Ranked, Voice, Hosting (DONE, server side)

- [x] 18+ confirmation, terms version, leaderboard opt-out, `underage` reports.
- [x] Ranked singles and duo teams: matchmaking queue, parties, forfeit and void rules, cooldowns.
- [x] Elo ratings saved atomically with match history; repeat-opponent guard.
- [x] Global leaderboards for singles and teams, with "my rank".
- [x] Voice chat tokens (Vivox): table and team channels, block-list muting.
- [x] Ad pacing settings for the app.
- [x] Hetzner deploy pack: docker-compose, Caddy and nginx, deploy, backup and restore scripts (`docs/hetzner-deploy.md`).

## Production readiness (DONE)

- [x] Load test: 1,500 matches at once on about a third of one CPU core.
- [x] Unity side of voice (Vivox), ads (AppLovin MAX, consent via its Terms and Privacy flow), and native Sign in with Apple / Google with the login in the Keychain / Keystore.
- [x] Build scripts: Player Settings, Xcode capabilities, Android libraries and invite-link filters.
- [x] Deploy pack run for real in Docker; one-command host setup; checked, off-box backups; alerts to Discord/Slack; app error reports.
- [x] Public pages: privacy, terms, support, and the account-deletion form Google Play requires; a moderation routine.

## Before launch (yours: see `docs/production-checklist.md`)

- Sign-ups and keys, the lawyer's pass on the privacy policy and terms, and putting the server on the Hetzner box.
- The first real-device test: sign-in, invite links, voice, ranked, ads, reconnects, and the feel of the throw.
- Store age ratings 17+ / Mature, TestFlight and Play internal testing.
- Push notifications for invites (optional, later).

## Phase 3: Unity Greybox (logic DONE; needs its first open in Unity, see `docs/unity-client.md`)

- [x] Sign-in flow: guest first, then "add Apple/Google" (native, built in). `GET /api/me` at launch to rejoin a match.
- [x] Swipe throw: drag to aim, pull back, flick; wind badge; shot picker; aim helper (casual only); throw clock.
- [x] Match Setup screen, HUD, results with the rating change, rematch, report and block.
- [x] Reconnect handling: on close code 1012, reconnect and resume (`resync` rule in the contract).
- [x] The art hook (`MatchPresenter`) and the replay maths (`ThrowReplay`) for the visuals.
- [ ] Open the project in Unity for the first time and fix what shows up.
- [ ] Invisible boards lined up on the locked plates.
- [ ] First-person hand + bag flight (art, see `docs/visuals-todo.md`).
- [ ] Board-cam cut after release.

## Phase 4: Video Opponents

- Generate one character's clip set (idle, step-up, throw, 3 reactions) with Kling image-to-video from the locked plate.
- Then the rest of the 8-character roster in `characters.md`.
- Add the release-frame JSON and the Unity bag hand-off.

## Phase 5: Multiplayer Polish

- Real-device testing of reconnect, deploys and takeover with human players.
