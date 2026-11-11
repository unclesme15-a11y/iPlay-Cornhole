# iPlay Cornhole (Concept)

> **Hands:** All hands come from the shared Unity hand rig (`com.iplay.handrig`), composited over Imagine footage. Imagine never generates hands.

Separate repo for the iPlay cornhole game. It shares the broader iPlay identity and style with iPlay Street Dice (first-person view, Kling video backgrounds, Unity overlays, server-authoritative results), but it's planned and built as its own game.

> **Direction change (November 2026): the players are 3D iPlay characters, so the iPlay face scan fits.** Cornhole and Slap are the two iPlay games that use the face scan. Cards and Dice do not use it. The old plan (every player shown as a pre-made Kling video clip) is retired, because a scanned face cannot be put into a pre-made video without face-swapping, which iPlay will not do. See `docs/face-scan.md`.

## Core Direction

- First-person view. The only body the player ever sees of themselves is their throwing hand holding the bag at the bottom of the screen.
- Real-video **background** made with Kling (the park, the cookout, the far-off crowd), the same way Street Dice uses a Kling bodega plate. The video provides the setting, not the players.
- **Every player is a 3D iPlay character** drawn by Unity on top of the video: humans and computer opponents alike. A human who has done the face scan plays as their own character, with their own face. Anyone else picks one of the 8 roster characters (`docs/characters.md`).
- The character system is **shared with iPlay Slap**: one iPlay character per player, made once, used in both games.
- Unity is responsible for the characters, the bags, the boards' hit areas, scoring, the HUD, and audio. The video provides the setting.
- The server decides every result. The video and bag flight make it look good, but the backend holds the score.
- After the local player releases the bag, the camera cuts to a close-up of the far board so the landing is easy to read.
- Regulation cornhole only: 1v1 and 2v2. Any seat can be a human or a bot, so you can mix them freely.
- A Match Setup screen before every game lets the host set the target score (default 21) and the other options.
- First scene: a big open park at a summertime hood BBQ cookout.
- No wagers or money of any kind.

## Repo Map

- `docs/game-rules.md`: rules contract (regulation cornhole plus the iPlay choices).
- `docs/visual-camera-plan.md`: camera angles, how the video plates and Unity bags line up, and the board-cam cut.
- `docs/face-scan.md`: how a player's scanned face becomes their character, and the privacy rules.
- `docs/characters.md`: the iPlay character system and the 8 roster characters (4 men, 4 women, ages 30-50).
- `docs/multiplayer-plan.md`: seats, 2v2 layout, mixing humans and bots, throw input.
- `docs/roadmap.md`: build order.
- `docs/open-decisions.md`: calls the owner still needs to make.
- `artifacts/kling/cornhole-prompts.md`: Kling plate and background shot list with prompts. (The per-character video clip section is retired.)
