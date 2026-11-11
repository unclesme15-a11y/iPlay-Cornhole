# Roadmap

> **Hands:** All hands come from the shared Unity hand rig (`com.iplay.handrig`), composited over Imagine footage. Imagine never generates hands.

## Phase 1: Rules And Look Lock

- Approve the rules contract (`game-rules.md`) and settle what's left in `open-decisions.md`.
- Generate and lock the **Thrower View** still in Imagine (text-to-image first; don't spend on video yet). Pitcher's boxes stay empty: Unity puts the players there.
- Lock the matching Far Board Cam and Neighbor Cut stills from the same setting.
- Generate 3-4 random background life takes plus the cornhole nearby-reaction take, and an ambient audio bed with random one-shots.

## Phase 2: Scoring Backend

- Cornhole rules engine: innings, alternating throws, cancellation scoring, target score from Match Setup (default 21), bust/skunk toggles.
- Unit tests for each scoring example in `game-rules.md`.
- Seeded bag physics on the server, plus a frame-path transport (copy the Street Dice pattern).

## Phase 3: Unity Greybox

- Invisible boards lined up on the locked plates.
- First-person hand + swipe throw + bag flight.
- Board-cam cut after release.
- Match Setup screen, HUD, bag counters, inning summary.
- Local practice mode against a placeholder bot, no video yet.

## Phase 4: 3D Characters (Changed November 2026)

Depends on the **shared iPlay character system** (built once for Slap and Cornhole; see `face-scan.md`).

- Keisha first: rigged 3D roster character, full animation set (idle, step-up, throw with release event, 3 reactions, neighbor throw), lit and graded to the locked plates. Judge her in Thrower View and Neighbor Cut.
- Then the rest of the 8-character roster in `characters.md`.
- Bag attached to the hand bone, released on the animation event.
- Walk-up intro and cornhole-celebration close cut.

## Phase 5: Face Scan + Multiplayer

- Face scan → personal iPlay character (on the phone; face measurements deleted after building). Consent screen with a separate "show my face to opponents" choice. Geo-block where required.
- Character relay between phones (server passes it along, keeps nothing).
- 2v2 seats, human/bot mixing, character pick, bag color pick (first come first served).
- Voice.
- Reconnect / bot takeover (bot shows a roster character).
