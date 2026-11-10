# Roadmap

On 2026-11-10, Cornhole was still on hold for game work. The Imagine tool change below is a spec update only.

## Phase 1: Rules And Look Lock

- Approve the rules contract (`game-rules.md`) and settle what's left in `open-decisions.md`.
- Generate and lock the **Thrower View** still in **Imagine (Grok Imagine, via SuperGrok)** (text-to-image first; don't spend on video yet). Same neon-dark iPlay look, on the summertime park BBQ cookout.
- Lock the matching Far Board Cam and Neighbor Cut stills from the same setting, also in Imagine. Imagine is the default candidate for all three plates.
- Open question (kept): whether to test more than one tool on a single plate (Plate 1) before locking the full set. Imagine remains the default candidate.
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

## Phase 4: Video Opponents

- Generate one character's clip set (idle, step-up, throw, 3 reactions) with Imagine image-to-video (or a first+last-frame loop) from the locked plate. Composite any close-up face that won't stay stable.
- Then the rest of the 8-character roster in `characters.md`.
- Add the release-frame JSON and the Unity bag hand-off.

## Phase 5: Multiplayer

- 2v2 seats, human/bot mixing, character pick, bag color pick (first come first served).
- Voice.
- Reconnect / bot takeover.
