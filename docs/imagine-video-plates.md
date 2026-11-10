# Imagine Video Plate List

Spec only. On 2026-11-10 Cornhole game work was still on hold. This file is the plate list a later pass can generate from. Applying this document does not generate images, video, or Unity assets.

**Tool:** Imagine (Grok Imagine, via SuperGrok). Kling, Veo, and Seedance are not used for any plate in this list.

**Open question (kept):** whether to test more than one tool on a single plate before locking the full set. Imagine stays the default candidate. The earlier named-tool bake-off was dropped.

**Hands:** every hand and every throw gesture comes from the **purchased Unity hand asset (name/path: needs Sme)**, composited over the Imagine plate. Imagine never generates hands. No plate, including Thrower View, Neighbor Cut, and the 2v2 partner shot, shows an Imagine hand or an Imagine person in the foreground.

Related docs: `docs/visual-camera-plan.md` (angles and the bag hand-off), `docs/game-rules.md` (singles stand at the same end; 2v2 partners stand at opposite ends), `docs/throwing-controls.md` (aim, pull-back, flick). The Unity hookup below is `MatchPresenter` on the prototype branch `claude/cornhole-game-prototype-p9nt6j` (`unity/CornholeGreybox/Assets/Scripts/Unity/MatchPresenter.cs`). That project is not on `main`.

## Status

- Cornhole game work is on hold. This is a spec update only. No plates or clips are generated from it.
- Face Scan desktop hero stills are **done**: `face-scan-hero-desktop-2560x1440.jpg` and `face-scan-hero-desktop-1920x1080.jpg` in the iPlay art folder, upscaled from a 1280-wide Imagine render.
- A 2026-11-10 Face Scan test showed face morphing and a flickering beam on a locked-off still. Plates in this list keep faces small and far, and they contain no hands. The hand on screen is always the purchased Unity asset.
- Shared Dice and Cornhole hand rig: **approved 2026-11-10, in progress.** Embedded Unity package in iPlay-StreetDice, planned path `unity/Packages/com.iplay.handrig`, branch `cursor/shared-iplay-hand-rig`. Rig PR: https://github.com/unclesme15-a11y/iPlay-StreetDice/pull/3. Cornhole consumes it in https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/4.

## What Imagine generates

Three groups only:

| Group | Class | What it is |
|---|---|---|
| Background plates | BACKGROUND | Ambient cookout loops behind play. Three lights: golden hour, overcast, dusk. |
| Camera plates | BACKGROUND | The gameplay angles: Thrower View, Far Board Cam, Neighbor Cut, and the 2v2 partner shot. |
| Reaction plates | PUNCTUATION | Short crowd cuts on a hole or a miss, plus a few seconds of ordinary crowd energy. |

Imagine does not generate the throwing hand, the bag, the opponent's body, or a character clip. Video characters in `docs/characters.md` are a later roster and are outside this list.

## Rules

### Length

- Imagine caps a clip at **15 seconds**. The default length to ask for is **8 seconds**.
- **Extend** adds **2–10 seconds at 720p**. Use Extend only when an 8 second camera take ends before the landing hold, and keep the total at or under 15 seconds. If the boards drift during Extend, throw the take out and generate again.
- Frame every camera plate tight so **one throw plus the landing fits inside 15 seconds**, and inside the 8 second default. On the prototype, flight time is about 0.55–1.15 seconds (`flightMs = round((0.55 + 0.45 * arc + 0.15 * power) * 1000)` in `server/src/physics/throwSim.ts`), then a short slide. Far Board Cam cuts in at **0.33 seconds** after release. Hold about **1.2 seconds** after the bag stops, then return to Thrower View. That whole window fits in 8 seconds.
- Reaction clips are a few seconds. Ask for **4 seconds**. If Imagine will only emit the 8 second default, generate 8 and play the first 4. Do not Extend a reaction.
- Background and camera plates are **seamless loops** of 8 seconds so aiming can run longer than one clip. Unity crossfades to the next play of the same loop and never plays the same reaction twice in a row.
- Frame shape for this list is **16:9 landscape**, matching the prototype's landscape lock and the Face Scan desktop stills (2560×1440 and 1920×1080). The older lines in `artifacts/kling/cornhole-prompts.md` say 9:16. Do not use that frame for this list.

### Input mode

Lock a still before spending on video. Text-to-video is not used: the boards have to stay put so the Unity colliders line up.

| Kind | Still | Video mode |
|---|---|---|
| Background loop | Text-to-image, then approve | **First+last-frame loop.** The same approved still is both the first frame and the last frame. |
| Camera plate | Text-to-image, then approve | **First+last-frame loop**, same rule. |
| Reaction | The approved Thrower View still | **Image-to-video** from that still. One-shot. |

Reject any clip where the board has moved. Check by laying the clip over the locked still.

### What every prompt must keep

Copy the plate's prompt as written. The prompts are short on purpose. A long list of crowd actions makes everything happen at once and looks staged.

Every prompt already says the foreground is empty. Keep these in the prompt and in review:

- No hands, fingers, or arms as a subject. No wave, clap, point, or raised hand.
- No person in the foreground. The lane between the boards stays empty. Nobody stands in a pitcher's box.
- Crowd stays at mid and far distance, soft, small in frame. No face close enough to read the eyes.
- No bag, in the air or on a board. Unity draws every bag.
- No logos, no readable text. If a board has LED strips, they are dark and unlit. Unity draws the light.
- Female-heavy cookout crowd, as in `docs/visual-camera-plan.md`: mostly Black women, then Latina, then white, curvy adult builds, some men mixed in, a few kids only far from the lane. Casting direction still needs Sme (see Needs Sme). If that direction changes, change the crowd clause in every prompt before generating.
- Neon-dark iPlay grade on every plate: dark, premium, soft cyan and magenta rim light. Golden hour and overcast change the sky and the practical light. They do not become a bright documentary look.

### Playback and Unity

One camera plate is on screen during a throw. The purchased hand and the Unity bag are drawn on top. `MatchPresenter` is the door (prototype):

| Moment | Call | What the presenter does |
|---|---|---|
| Match opens | `OnMatchOpened` | Load the approved light's background loop and **CAM-THROWER**. Place invisible boards on the video boards. Show the hand rig, hidden until someone is throwing. |
| Aim, pull, shake | `OnAimChanged(aim, power, shotId, pulling, handShake)` | Drive the purchased hand. The plate stays **CAM-THROWER**. `handShake` above 1 trembles the rig. |
| A throw exists | `OnThrowResult` | Play that seat's gesture on the purchased hand. Schedule the camera cut from the rules below. |
| Bag in the air | `OnReplayFrame` | Move the Unity bag. The Imagine plate has no bag. |
| Hole | `OnCue` with `reason: "hole"` (sound `cornhole_hit`) | Cut in a random **RX-HOLE** variant, then return to the camera plate. |
| Miss (off the board) | `OnCue` with `reason: "foul"` (sound `ground_thud`) | Cut in a random **RX-MISS** variant, then return. |
| Woody (on the board, not in the hole) | `OnCue` with `reason: "landing"` (sound `bag_thud`) | Stay on the camera plate. No groan. |
| Inning score | `OnScore` | HUD only. It does not pick a plate. |
| Reduce motion | `OnCue(..., reduceMotion: true)` | Skip the reaction cut. Keep the camera plate. |

Camera cuts for one throw:

- **Local player, and anyone throwing at the far board:** start on **CAM-THROWER** (or **CAM-NEIGHBOR** when that plate is the one in use). At **0.33 s** after release, cut to **CAM-FAR**. Hold about 1.2 s after the bag stops, then return to **CAM-THROWER**. Match Setup can turn the board-cam cut off (default is on; `docs/game-rules.md`). When it is off, stay on the plate that showed the release and let the Unity bag carry the flight.
- **Singles, the player beside you:** **CAM-NEIGHBOR** for the gesture, then the same 0.33 s cut to **CAM-FAR**, because both players throw at the far board.
- **2v2, your partner at the opposite end:** **CAM-PARTNER** replaces **CAM-NEIGHBOR**. The purchased hand plays the gesture in that empty box. They throw at your board, so do not cut to **CAM-FAR**. On release, return to **CAM-THROWER**, where your own board sits in the lower frame and the Unity bag comes in. The whole partner throw and landing stays inside 15 s.
- **2v2, the opponent beside you:** there is no extra Imagine plate. Their purchased-hand gesture enters from the side of **CAM-THROWER** that is not the local player's side, then **CAM-FAR** at 0.33 s. The plate stays empty of people.

The release the presenter uses is the rig's release, not a frame hunted inside an Imagine clip.

### Summary

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

## 1. Background plates

Ambient loops behind gameplay. Same park, three lights. Crowd at mid and far distance only. Seamless. Generate these so Sme can pick the light. Camera plates below are authored in the **dusk** grade, which is the gameplay default until that pick is made. Do not build a second full camera set in golden hour or overcast until Sme says that light is the one.

Shared crowd clause, already inside each prompt: a big relaxed crowd in the distance, mostly curvy adult Black women, with Latina and white women and some men mixed in, summer cookout clothes, small groups talking, a few kids far from the lane, soft focus, nobody posing.

### BG-GOLDEN

- **ID:** BG-GOLDEN
- **Type:** BACKGROUND
- **Purpose:** Ambient loop of the cookout in warm low sun, under the neon-dark grade. Plays behind a match only if Sme locks this light. Until then it is the golden-hour option.
- **Framing and camera:** Wide locked-off view down the empty 27 foot lane. Both boards readable, neither one huge. Foreground grass is empty. Crowd behind and beside the lane, never between the boards.
- **Length target:** 8 s (15 s cap).
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Imagine prompt draft:**

```text
Wide locked-off view down an empty cornhole lane on flat trimmed grass in a big open city park, summertime hood BBQ cookout, golden hour, low warm sun under a dark premium neon-dark iPlay grade, soft cyan and magenta rim light on the board edges, string lights starting to show on distant tents, grills smoking far back, pop-up tents and coolers in the distance, a relaxed female-heavy crowd only at mid and far distance, mostly curvy adult Black women with Latina and white women and some men mixed in, summer clothes, people talking in small groups, a few kids playing far from the lane, soft focus, nobody posing, both regulation boards visible and still, lane between them empty, foreground grass empty, no people near the camera, no hands, no fingers, no arms, no bags, no logos, no text, no close-up faces, realistic, 16:9
```

- **Acceptance:** First and last frames match the still. Boards do not slide. No hand, finger, arm, bag, or foreground person in any frame. No face large enough to read. Lane stays empty. Grade stays dark and neon-rimmed, not a bright afternoon photo.
- **Unity hookup:** `OnMatchOpened` may select this loop as the environment bed after Sme approves the light. It is not a throw camera. The hand rig is not parented to this plate.

### BG-OVERCAST

- **ID:** BG-OVERCAST
- **Type:** BACKGROUND
- **Purpose:** The same cookout under a soft grey sky, still in the neon-dark grade. An option, not the gameplay default.
- **Framing and camera:** Same wide locked-off lane as BG-GOLDEN.
- **Length target:** 8 s (15 s cap).
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Imagine prompt draft:**

```text
Wide locked-off view down an empty cornhole lane on flat trimmed grass in a big open city park, summertime hood BBQ cookout, overcast grey-green sky, soft flat light under a dark premium neon-dark iPlay grade, soft cyan and magenta rim light on the board edges, distant tents and coolers, grills smoking far back, a relaxed female-heavy crowd only at mid and far distance, mostly curvy adult Black women with Latina and white women and some men mixed in, summer clothes, people talking in small groups, a few kids playing far from the lane, soft focus, nobody posing, both regulation boards visible and still, lane between them empty, foreground grass empty, no people near the camera, no hands, no fingers, no arms, no bags, no logos, no text, no close-up faces, realistic, 16:9
```

- **Acceptance:** Same as BG-GOLDEN. Sky reads overcast. Rim light is still there.
- **Unity hookup:** Same as BG-GOLDEN. Environment bed only, after approval.

### BG-DUSK

- **ID:** BG-DUSK
- **Type:** BACKGROUND
- **Purpose:** Dusk-to-night cookout. This is the light the camera plates use until Sme locks another one.
- **Framing and camera:** Same wide locked-off lane as the other background plates.
- **Length target:** 8 s (15 s cap).
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Imagine prompt draft:**

```text
Wide locked-off view down an empty cornhole lane on flat trimmed grass in a big open city park, summertime hood BBQ cookout, dusk going to night, dark premium neon-dark iPlay grade, soft cyan and magenta rim light tracing the boards, string lights on distant tents, grills smoking far back, pop-up tents and coolers in the dark, a relaxed female-heavy crowd only at mid and far distance, mostly curvy adult Black women with Latina and white women and some men mixed in, summer clothes, people talking in small groups, a few kids playing far from the lane, soft focus, nobody posing, both regulation boards visible and still, lane between them empty, foreground grass empty, no people near the camera, no hands, no fingers, no arms, no bags, no logos, no text, no close-up faces, realistic, 16:9
```

- **Acceptance:** Same as BG-GOLDEN. Practical lights read as dusk, not daylight. Boards still line up with the still.
- **Unity hookup:** Default environment bed in `OnMatchOpened` until another light is approved. Crossfade plays of this loop while the match sits on a camera plate of the same light.

## 2. Camera plates

BACKGROUND-class gameplay plates. Each one is an empty set. The purchased Unity hand plays every throw on top. One loop is long enough for one throw and the landing. Generate them in the dusk grade of BG-DUSK.

Shared bottom-of-frame rule for Thrower View, Neighbor Cut, and the partner shot: leave a clear band of grass so the rig has room. The plate itself stays empty there.

### CAM-THROWER

- **ID:** CAM-THROWER
- **Type:** BACKGROUND
- **Purpose:** First-person view while the local player aims and releases, and the view that shows a bag arriving at your own board. Your board is in frame so far-end landings can be read without a second angle.
- **Framing and camera:** Eye level, about 5 feet, from your pitcher's box, looking down the 27 foot lane. Your board is large in the lower left, hole visible. The bottom edge is empty grass and the near board only, with room for the Unity hand along the bottom. The hand is not in the picture. Far board centered at the end of an empty lane. Right-handed and left-handed play share this one plate; the rig mirrors (`docs/throwing-controls.md`).
- **Length target:** 8 s. Must cover one throw and landing inside 15 s.
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Imagine prompt draft:**

```text
First-person view standing in a cornhole pitcher's box on flat trimmed grass, eye level about 5 feet, a regulation cornhole board with a round hole large in the lower left, the bottom edge of the frame empty grass and the near board only so a hand can be added later, looking down a clear 27 foot lane at a matching far board, wide open city park, summertime hood BBQ cookout, dusk going to night, dark premium neon-dark iPlay grade, soft cyan and magenta rim light on the boards, string lights on distant tents, grills smoking far back, a relaxed female-heavy crowd only behind and beside the lane at mid and far distance, mostly curvy adult Black women with Latina and white women and some men mixed in, summer clothes, small groups talking, a few kids far off, soft focus, nobody posing, lane empty, no person in the foreground, no hands, no fingers, no arms, no bags, no logos, no text, no close-up faces, camera locked off, realistic, 16:9
```

- **Acceptance:** Near board stays lower left and does not jump. Bottom band stays empty on every frame. No hand, arm, bag, or person enters that band. Far crowd never walks into the lane. Loop point is invisible. One 8 s play is longer than release → 0.33 s cut → flight → slide → 1.2 s hold.
- **Unity hookup:** Default plate from `OnMatchOpened` and `OnAimChanged`. Local release starts here. `OnReplayFrame` draws the bag leaving the rig toward the far board. At 0.33 s, cut to CAM-FAR when the board-cam setting is on. 2v2 partner landings return here on release. The hand is the purchased rig along the bottom, clear of the near hole: bottom-right for a right-handed player, bottom-left when mirrored.

### CAM-FAR

- **ID:** CAM-FAR
- **Type:** BACKGROUND
- **Purpose:** Close view of the far board so the landing is easy to read. Used only for bags thrown at the far board.
- **Framing and camera:** Low, slightly to the side of the far board. The board fills the lower half. The deck is empty. The hole is clear. Crowd is soft and far behind the board. No pitcher's box person, no hand, no bag.
- **Length target:** 8 s. The on-screen stay is shorter: from 0.33 s after release through the landing hold (about 1.2 s after the bag stops). The loop must cover that stay.
- **Loop or one-shot:** Seamless loop. Unity cuts into the loop; it does not play a staged landing.
- **Input mode:** First+last-frame loop from one approved still.
- **Imagine prompt draft:**

```text
Low locked-off camera beside a regulation cornhole board, board filling the lower half of the frame, round hole clear, deck empty, dusk going to night in a summertime park BBQ cookout, dark premium neon-dark iPlay grade, soft cyan and magenta rim light on the board edges, trimmed grass, tents and a female-heavy crowd soft and far behind the board, mostly curvy adult Black and Latina women, people small in frame, no one on the board, no one in the foreground, no hands, no fingers, no arms, no bags, no logos, no text, no close-up faces, realistic, 16:9
```

- **Acceptance:** Board position matches the still for the whole loop. Deck stays empty. No hand or person enters the foreground. Crowd stays soft and far.
- **Unity hookup:** `OnThrowResult` schedules the cut to this plate at **0.33 s** after release for the local player, the singles neighbor, and the 2v2 opponent who shares your end. `OnReplayFrame` drops the Unity bag onto this board. Do not use this plate for the 2v2 partner, who throws at your board. After the 1.2 s hold, return to CAM-THROWER.

### CAM-NEIGHBOR

- **ID:** CAM-NEIGHBOR
- **Type:** BACKGROUND
- **Purpose:** Singles only. The player beside you, one on each side of your board (`docs/game-rules.md`). The person the player sees is the purchased Unity hand, not an Imagine person.
- **Framing and camera:** Side angle from your box, looking across the near board at the other pitcher's box on the same end. That box is empty. The lower part of the frame is bare grass beside the board, left clear for the rig. Far cookout stays soft.
- **Length target:** 8 s, covering one throw and the cut to the landing inside 15 s.
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Imagine prompt draft:**

```text
Side angle from a cornhole pitcher's box looking across the near regulation board at the opposite pitcher's box on the other side of it, that box empty, lower frame bare grass with room for a hand to be added later, flat trimmed grass, summertime park BBQ cookout behind, dusk going to night, dark premium neon-dark iPlay grade, soft cyan and magenta rim light, crowd of mostly curvy adult women small and soft in the distance, no person in either box, no hands, no fingers, no arms, no bags, no logos, no text, no close-up faces, camera locked off, realistic, 16:9
```

- **Acceptance:** Both boxes stay empty. No hand grows out of the still. The near board does not move. The lower band stays clear for the rig.
- **Unity hookup:** In singles, `OnThrowResult` for the other seat shows the purchased hand in this framing, same gestures as the local throw, with the bag prop. At 0.33 s after that release, cut to CAM-FAR. In 2v2 this plate is not used; CAM-PARTNER replaces it.

### CAM-PARTNER

- **ID:** CAM-PARTNER
- **Type:** BACKGROUND
- **Purpose:** 2v2 only. Replaces Neighbor Cut. A straight-on view of your partner throwing from the opposite end. The throwing hand is the purchased Unity hand composited into the empty box.
- **Framing and camera:** Straight down the lane from your box toward the opposite pitcher's box. That box is empty and readable, straight on. The far board sits beside it. Lower center is empty grass so the rig can stand in the box. No body, no hand, no bag in the video.
- **Length target:** 8 s. The gesture and the return to Thrower View for the landing on your board fit inside 15 s.
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Imagine prompt draft:**

```text
Straight-on locked-off view from a cornhole pitcher's box looking down a clear 27 foot lane at the opposite pitcher's box, that box empty and centered, lower center of the frame bare grass with room for a hand to be added later, the far regulation board beside the empty box, summertime park BBQ cookout, dusk going to night, dark premium neon-dark iPlay grade, soft cyan and magenta rim light, female-heavy crowd only far behind the box, soft and small, no person in the box, no hands, no fingers, no arms, no bags, no logos, no text, no close-up faces, realistic, 16:9
```

- **Acceptance:** The opposite box stays empty on every frame. No Imagine hand or body. Board beside the box does not drift. Lower center stays clear.
- **Unity hookup:** In 2v2, when the partner at the other end throws, `OnThrowResult` plays the purchased hand in this frame. On release, cut back to CAM-THROWER and let `OnReplayFrame` land the bag on your board. Do not cut to CAM-FAR for this throw.

## 3. Hand and throw

### Source

All hands and throw gestures come from the **purchased Unity hand asset (name/path: needs Sme)**.

That product name and path are still open. They are not on `main`, and they are not in the prototype tree on `claude/cornhole-game-prototype-p9nt6j`. When Sme names the asset, it maps to `Resources/FirstPersonHands/FirstPersonHand_L` and `Resources/FirstPersonHands/FirstPersonHand_R`. The Street Dice repo `unclesme15-a11y/iPlay-StreetDice` was not readable from the environment that wrote this spec, so the Dice paths below are cited as given and were not re-checked on disk.

The asset is composited over the Imagine plate. It is the only hand for:

- the local player on CAM-THROWER
- the singles player beside you on CAM-NEIGHBOR
- the 2v2 partner on CAM-PARTNER
- the 2v2 opponent who shares your end, entering from the side of CAM-THROWER

Imagine does not generate a hand for any of those shots, and it does not generate a backup hand.

### What Dice has today

Street Dice already drives a throw with its own scripts. Those files are still Dice-specific. The shared package below is approved and in progress on a separate branch. The scripts cited here are on branch `cursor/dice-lineup-presentation-f9f3` in `unclesme15-a11y/iPlay-StreetDice`:

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

Those Kling clips are Dice video references for catch, plant, tap, and wave. Cornhole does not remake them in Imagine. Cornhole plays the purchased Unity asset.

### Shared hand rig (approved 2026-11-10, in progress)

Sme approved the shared Dice and Cornhole hand rig on 2026-11-10. It is in progress.

One iPlay hand rig, **owned by Street Dice** and **consumed by Cornhole** from the prototype Unity project, on the purchased Unity hand asset.

- **Prop slot.** One swappable socket on the hand. Dice puts the die in it. Cornhole puts the bag in it. Grip and release timing stay the same. After release, Cornhole hides the prop and `OnReplayFrame` flies the game bag. The die path in Dice is unchanged aside from reading the prop id.
- **Skin and material.** One skin, the purchased asset's skin, shared by both games. The material slot is the one Dice already uses for the hand fade (`CatchSkin.cginc`, `CatchVideo.shader`). Cornhole does not author a second skin.
- **Gesture set.** The same set Dice already drives: the throw motion captured and checked by `ThrowMotionCapture` and `ThrowMotionVerification`, plus catch, plant, tap, and wave. Cornhole maps its own input onto that motion through `OnAimChanged`: drag to aim, pull back for power, flick to release, lean left or right, and `handShake` for the long hold. It does not invent a second vocabulary. Same hands, same skin, same directional gestures.
- **Where the shared code lives.** An embedded Unity package in `unclesme15-a11y/iPlay-StreetDice`, on branch `cursor/shared-iplay-hand-rig`. Planned path: `unity/Packages/com.iplay.handrig`. Rig PR: https://github.com/unclesme15-a11y/iPlay-StreetDice/pull/3. Cornhole consumes the package from the prototype Unity project (`unity/CornholeGreybox` on `claude/cornhole-game-prototype-p9nt6j`): https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/4. The Dice scripts listed above move into that package, with the hand driver taking a prop id instead of assuming a die. Cornhole's only new script is a thin `MatchPresenter` that binds the bag prop and forwards `OnAimChanged` and `OnThrowResult`. Do not copy the Dice scripts into Cornhole as a fork.
- **Status:** approved 2026-11-10, in progress. The purchased asset's name and path are still open. See Needs Sme.

### Why the hand stays in Unity

The 2026-11-10 Face Scan test showed Imagine morphing a face and flickering a beam on a locked-off still. Hands morph the same way. The hand the player watches is the purchased rig, composited over a plate that was generated empty. That is the rule for every plate in this list.

## 4. Reaction plates

PUNCTUATION. Short crowd cuts. A handful of variants: three hole cheers, three miss groans, three ambient-energy beats. People stay mid and far. Energy reads from the group shifting and leaning, not from hands. No raised hands, no claps with readable fingers, no face filling the frame.

Start each one **image-to-video from the approved CAM-THROWER still** so the boards do not jump on the cut. One-shot, 4 seconds. If the tool emits 8 seconds, use the first 4.

### RX-HOLE-1

- **ID:** RX-HOLE-1
- **Type:** PUNCTUATION
- **Purpose:** Crowd cheer when a bag goes in the hole. Variant A: the mid-distance group leans in and the energy lifts.
- **Framing and camera:** Same frame as CAM-THROWER. Boards locked. Crowd only, far enough that faces stay small.
- **Length target:** 4 s.
- **Loop or one-shot:** One-shot.
- **Input mode:** Image-to-video from the approved CAM-THROWER still.
- **Imagine prompt draft:**

```text
Same locked cornhole frame, boards and lane frozen, dusk neon-dark cookout. In the mid distance the crowd leans in and a cheer moves through the group, faces small, no one steps toward the lane, no hands raised, no waving, foreground empty, no bags, no logos, no text, camera locked off, 4 seconds, 16:9
```

- **Acceptance:** Boards match the still. No new person in the foreground. No readable hand. Cheer reads in the first 4 seconds. Lane stays empty.
- **Unity hookup:** `OnCue` reason `hole`. Pick among RX-HOLE-1, RX-HOLE-2, and RX-HOLE-3, skipping the one just played. Then return to the camera plate. Skip the cut when `reduceMotion` is true.

### RX-HOLE-2

- **ID:** RX-HOLE-2
- **Type:** PUNCTUATION
- **Purpose:** Hole cheer, variant B. A few people in the mid distance bounce on their heels, mouths open, hands staying down and unreadable.
- **Framing and camera:** CAM-THROWER still. Boards locked.
- **Length target:** 4 s.
- **Loop or one-shot:** One-shot.
- **Input mode:** Image-to-video from the approved CAM-THROWER still.
- **Imagine prompt draft:**

```text
Same locked cornhole frame, boards and lane frozen, dusk neon-dark cookout. A few people at mid distance bounce on their heels with a short cheer, faces small, arms down and not readable, no hands raised, nobody enters the lane or the foreground, no bags, no logos, no text, camera locked off, 4 seconds, 16:9
```

- **Acceptance:** Same as RX-HOLE-1. Fingers never become readable.
- **Unity hookup:** Same hole pool as RX-HOLE-1.

### RX-HOLE-3

- **ID:** RX-HOLE-3
- **Type:** PUNCTUATION
- **Purpose:** Hole cheer, variant C. The group nearest the tents turns toward the lane, the energy lifts, then it starts to settle. They do not approach.
- **Framing and camera:** CAM-THROWER still. Boards locked.
- **Length target:** 4 s.
- **Loop or one-shot:** One-shot.
- **Input mode:** Image-to-video from the approved CAM-THROWER still.
- **Imagine prompt draft:**

```text
Same locked cornhole frame, boards and lane frozen, dusk neon-dark cookout. The far group by the tents turns toward the lane and the energy lifts, then starts to settle, faces small, no one walks forward, no hands raised, foreground empty, no bags, no logos, no text, camera locked off, 4 seconds, 16:9
```

- **Acceptance:** Same as RX-HOLE-1. Nobody crosses toward the boards.
- **Unity hookup:** Same hole pool as RX-HOLE-1.

### RX-MISS-1

- **ID:** RX-MISS-1
- **Type:** PUNCTUATION
- **Purpose:** A groan when the bag misses the board. Variant A: the mid-distance group sags and heads drop.
- **Framing and camera:** CAM-THROWER still. Boards locked.
- **Length target:** 4 s.
- **Loop or one-shot:** One-shot.
- **Input mode:** Image-to-video from the approved CAM-THROWER still.
- **Imagine prompt draft:**

```text
Same locked cornhole frame, boards and lane frozen, dusk neon-dark cookout. The mid-distance crowd sags, a short groan, heads drop, faces small, hands not readable, no one enters the foreground, no bags, no logos, no text, camera locked off, 4 seconds, 16:9
```

- **Acceptance:** Boards match the still. The beat reads as a miss, not a cheer. No hands, no foreground person.
- **Unity hookup:** `OnCue` reason `foul` (bag off the board). Pool with RX-MISS-2 and RX-MISS-3. Do not play on reason `landing` (that is a woody). Skip when `reduceMotion` is true.

### RX-MISS-2

- **ID:** RX-MISS-2
- **Type:** PUNCTUATION
- **Purpose:** Miss groan, variant B. A few people wince, then turn back to their own conversation.
- **Framing and camera:** CAM-THROWER still. Boards locked.
- **Length target:** 4 s.
- **Loop or one-shot:** One-shot.
- **Input mode:** Image-to-video from the approved CAM-THROWER still.
- **Imagine prompt draft:**

```text
Same locked cornhole frame, boards and lane frozen, dusk neon-dark cookout. A few people at mid distance wince and turn back to their own conversation, faces small, no hand gesture, foreground empty, no bags, no logos, no text, camera locked off, 4 seconds, 16:9
```

- **Acceptance:** Same as RX-MISS-1. The group goes back to talking inside the clip.
- **Unity hookup:** Same foul pool as RX-MISS-1.

### RX-MISS-3

- **ID:** RX-MISS-3
- **Type:** PUNCTUATION
- **Purpose:** Miss groan, variant C. A short disappointed murmur, then ordinary cookout talk.
- **Framing and camera:** CAM-THROWER still. Boards locked.
- **Length target:** 4 s.
- **Loop or one-shot:** One-shot.
- **Input mode:** Image-to-video from the approved CAM-THROWER still.
- **Imagine prompt draft:**

```text
Same locked cornhole frame, boards and lane frozen, dusk neon-dark cookout. A short disappointed murmur moves through the far crowd, then they go back to talking, faces small, no hands raised, no one near the lane, foreground empty, no bags, no logos, no text, camera locked off, 4 seconds, 16:9
```

- **Acceptance:** Same as RX-MISS-1.
- **Unity hookup:** Same foul pool as RX-MISS-1.

### RX-AMB-1

- **ID:** RX-AMB-1
- **Type:** PUNCTUATION
- **Purpose:** A few seconds of ordinary crowd energy. Variant A: small groups talking, one laugh far off. Not a score reaction.
- **Framing and camera:** CAM-THROWER still. Boards locked. Crowd mid and far.
- **Length target:** 4 s.
- **Loop or one-shot:** One-shot.
- **Input mode:** Image-to-video from the approved CAM-THROWER still.
- **Imagine prompt draft:**

```text
Same locked cornhole frame, boards and lane frozen, dusk neon-dark cookout. Ordinary mid-distance conversation, one laugh far off, most people not watching the lane, faces small, no hands as a subject, foreground empty, no bags, no logos, no text, camera locked off, 4 seconds, 16:9
```

- **Acceptance:** Boards locked. The clip feels like background life, not a cheer or a groan. No readable hands. No foreground person.
- **Unity hookup:** While idle on CAM-THROWER between throws, the presenter may crossfade one RX-AMB variant, never the same one twice in a row, and never during an RX-HOLE or RX-MISS cut. Not tied to `OnScore`.

### RX-AMB-2

- **ID:** RX-AMB-2
- **Type:** PUNCTUATION
- **Purpose:** Ambient energy, variant B. Someone far off walks past the tents. Kids stay far from the lane.
- **Framing and camera:** CAM-THROWER still. Boards locked.
- **Length target:** 4 s.
- **Loop or one-shot:** One-shot.
- **Input mode:** Image-to-video from the approved CAM-THROWER still.
- **Imagine prompt draft:**

```text
Same locked cornhole frame, boards and lane frozen, dusk neon-dark cookout. Far behind the tents someone walks past carrying a tray, a few kids play well away from the lane, the crowd stays small and soft, no hands readable, foreground empty, no bags, no logos, no text, camera locked off, 4 seconds, 16:9
```

- **Acceptance:** Same as RX-AMB-1. The walker never reaches the lane. Kids stay far.
- **Unity hookup:** Same idle pool as RX-AMB-1.

### RX-AMB-3

- **ID:** RX-AMB-3
- **Type:** PUNCTUATION
- **Purpose:** Ambient energy, variant C. Grill smoke and small groups. Almost nobody is watching the game.
- **Framing and camera:** CAM-THROWER still. Boards locked.
- **Length target:** 4 s.
- **Loop or one-shot:** One-shot.
- **Input mode:** Image-to-video from the approved CAM-THROWER still.
- **Imagine prompt draft:**

```text
Same locked cornhole frame, boards and lane frozen, dusk neon-dark cookout. Grill smoke drifts far back, small groups talk among themselves, almost nobody watches the lane, faces small, no hand gesture, foreground empty, no bags, no logos, no text, camera locked off, 4 seconds, 16:9
```

- **Acceptance:** Same as RX-AMB-1.
- **Unity hookup:** Same idle pool as RX-AMB-1.

## When generation is allowed

Do not generate while game work is on hold. When Sme says to start, do it in this order:

1. Text-to-image stills for BG-GOLDEN, BG-OVERCAST, BG-DUSK, CAM-THROWER, CAM-FAR, CAM-NEIGHBOR, and CAM-PARTNER. Stop for plate approval before any video.
2. First+last-frame loops from the approved stills. Dusk camera plates first.
3. Image-to-video reactions from the approved CAM-THROWER still.
4. Wire playback through `MatchPresenter` only after the plates exist. The prototype consumes `unity/Packages/com.iplay.handrig` in https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/4 (package PR https://github.com/unclesme15-a11y/iPlay-StreetDice/pull/3). The purchased asset name and path are still open in Needs Sme.

Review every take against that plate's acceptance lines. A failed take is discarded. Do not paint a hand out of a bad frame and keep it.

## Needs Sme

- **Plate approvals.** The three lights, then each camera still, before any video. Dusk is the default camera grade until another light is chosen.
- **Crowd casting direction.** The prompts follow the cookout crowd in `docs/visual-camera-plan.md`. That direction is still Sme's to confirm or change.
- **Purchased Unity hand asset (name/path: needs Sme).** OPEN. It maps to `Resources/FirstPersonHands/FirstPersonHand_L` and `Resources/FirstPersonHands/FirstPersonHand_R`. The product name of the purchased asset is still not recorded. Also confirm that this asset is the one that plays the Dice gesture set (throw, catch, plant, tap, wave) Cornhole will reuse.
