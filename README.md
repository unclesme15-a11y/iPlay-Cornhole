# iPlay Cornhole (Concept)

Separate repo for the iPlay cornhole game. It shares the broader iPlay identity and style with iPlay Street Dice (first-person view, Kling video backgrounds, Unity overlays, server-authoritative results), but it's planned and built as its own game.

## Core Direction

- First-person view. The only body the player ever sees of themselves is their throwing hand holding the bag at the bottom of the screen.
- Real-video background made with Kling, the same way Street Dice uses a Kling bodega plate.
- Computer opponents are **video characters**: short Kling clips of a person getting ready, throwing, and reacting. No 3D character models.
- Unity is responsible for the bags, the boards' hit areas, scoring, the HUD, and audio. The video provides the people and the setting.
- The server decides every result. The video and bag flight make it look good, but the backend holds the score.
- After the local player releases the bag, the camera cuts to a close-up of the far board so the landing is easy to read.
- Regulation cornhole only: 1v1 and 2v2. Any seat can be a human or a video bot, so you can mix them freely.
- A Match Setup screen before every game lets the host set the target score (default 21) and the other options.
- First scene: a big open park at a summertime hood BBQ cookout.
- No wagers or money of any kind.

## Repo Map

- `docs/game-rules.md`: rules contract (regulation cornhole plus the iPlay choices).
- `docs/visual-camera-plan.md`: camera angles, how the video plates and Unity bags line up, and the board-cam cut.
- `docs/characters.md`: the 8 video characters (4 men, 4 women, ages 30-50).
- `docs/multiplayer-plan.md`: seats, 2v2 layout, mixing humans and video bots, throw input.
- `docs/roadmap.md`: build order.
- `docs/open-decisions.md`: calls the owner still needs to make.
- `artifacts/kling/cornhole-prompts.md`: Kling plate and clip shot list with prompts.
