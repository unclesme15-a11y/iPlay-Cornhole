# Visuals: What's Left

Everything that isn't a picture, a video, or how something looks is built. This is the list of what is left to make, in the order it makes sense to do it. The plans it refers to already exist; this just gathers them.

## The rule

The server decides every result and sends everything the art needs (`docs/unity-client.md`, "What you get from the server"). Art never decides a score. So the art can be swapped or redone without touching the game.

## 1. The look of the world (Kling)

Follow `artifacts/kling/cornhole-prompts.md` and `docs/visual-camera-plan.md`.

| Piece | What | Notes |
|---|---|---|
| **Thrower View** (Plate 1) | Still of the big open park BBQ, first person, far board ahead | Lock this first, in text-to-image, before spending on video |
| **Far Board Cam** (Plate 2) | Close-up of the far board for the cut after release | Board cam only ever shows the far board |
| **Neighbor Cut** (Plate 3) | The other side of the yard (the opponent's view) | |
| **Board reference** | The board from above, for modelling the overlay | |
| **Background life takes** (4 or so) | Random, natural crowd movement: talking, kids far off, people walking, only an occasional phone | Keep it random so it doesn't look fake |
| **Nearby reaction** | The crowd's reaction to a cornhole | Plays when a bag drops in |
| Ambient audio bed | Cookout sounds with random one-shots | |
| Side-by-side test | Same Plate 1 in Kling, Veo 3.1 and Seedance 2.0 | Pick the tool per clip type |

## 2. Video opponents

At least 4 men and 4 women, ages 30 to 50, summer outfits (`docs/characters.md`). For each character: idle, step-up, throw, and three reactions, generated image-to-video from the locked Plate 1. Then the **release-frame marker** for each throw clip (the frame the bag leaves the hand), so Unity can hand off to the 3D bag at the right instant.

## 3. In-Unity art

| Piece | What |
|---|---|
| **First-person hand** | Only the hand and part of the palm at the bottom of the screen; three skin shades like Street Dice; left- and right-handed; the pull-back and flick animation; the tremble when held too long. Hooks: `OnAimChanged` |
| **Bags** | 3D bag with the **iPlay "i▶" mark** (files in `assets/logo`); 12 team colors; slick side / sticky side look. Hook: `OnReplayFrame` |
| **The LED board** | The custom board with LED strips down the sides (`docs/led-board-and-bags.md`): the flash burst on a cornhole, the soft pulse on a score, the victory pattern. Hook: `OnCue`. Respect the 3-flashes-a-second limit and the softer glow for "reduce motion" |
| **Aim guide** | The aim line, the landing ring and the hole marks (one mark is the hole's width, 6 in), the wind streamer on the far board, the wind badge. Numbers come from `GET /api/meta` |
| **Wind in the world** | Streamers, trees, tablecloths moving with the wind. Hook: `OnWind` |
| **Replay ghost** | After a throw, the calm-day path faintly next to the real one, so players can see what wind and flick did |
| **Results moment** | "CORNHOLE!" with the game-show ring-in sound (already made), score change, rating change animation |
| **Voice markers** | A speaking indicator per player (`SpeechActivity`) |

## 4. Menus and branding (the Street Dice look)

Street Dice's target is "distressed dark surfaces, restrained cyan glow and gold edges, brush/graffiti lettering, functional UI". The plain menus already use the right colors and font.

- Logo animation at launch (Street Dice: cyan trace, symbol reveal, strike, fade) and the menu clack sounds.
- Menu art: the main menu "object" (Street Dice has the die), metal plate rows for buttons, the gear and exit signs.
- Ranked search screen, party screen, leaderboards (a good place for the big rank numbers), results, profile, settings.
- App icon, splash, store screenshots and preview video.
- A consolidated icon and control sheet, and captures at a phone size and a narrower one, for your approval before any build goes to a store (the same gate as Street Dice's `visual-approval-checklist.md`).

## 5. Sound

Already made: the game-show ring-in (three versions to choose from), bag thud, ground thud. Still to make or choose: crowd cheer for a cornhole, a small sting for winning, menu sounds, and any music.

## Decisions only you can make

- **Portrait or landscape.**
- **Which ring-in sound** (three are ready; the preview page plays them: `npm run preview` in `server/`).
- **Which video tool** per clip type after the side-by-side test.
- **A vector version of the iPlay mark** for the final bag print.
