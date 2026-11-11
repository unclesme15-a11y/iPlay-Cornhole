# Imagine Video Plate List

Layered plate spec. Imagine generates the environment and a separate keyed crowd layer. Unity owns the boards completely, and the purchased hand rig owns every player hand. Applying this document does not generate images, video, or Unity assets.

**Tool:** Imagine (Grok Imagine, via SuperGrok / `GenerateImage` and `GenerateVideo`). Kling, Veo, Seedance, and fal are not used for any plate in this list.

**Hands:** every player and thrower hand, and every throw gesture, comes from the Unity rig in package **`com.iplay.handrig`**, composited over the plate. Imagine never generates player or thrower hands. No environment plate, including Thrower View, Neighbor Cut, and the 2v2 partner shot, shows an Imagine hand or an Imagine person in the foreground. Crowd clips may include ordinary body-scale hands as part of a distant figure; those hands stay non-prominent, and the rig is not used to composite them. See [Crowd hands](#crowd-hands).

**Direction (2026-11-11, Smee):** boards and crowd must not be baked into the same Imagine shot. Unity controls the boards completely, with logos applied as decals. The crowd sits far back in the background, at a ratio of **3 women to 1 man**. The environment is a separate layer.

Related docs: `docs/visual-camera-plan.md` (angles and the bag hand-off), `docs/game-rules.md` (singles stand at the same end; 2v2 partners stand at opposite ends), `docs/throwing-controls.md` (aim, pull-back, flick), `docs/led-board-and-bags.md` (Unity-driven board lights). The Unity hookup below is `MatchPresenter` on the prototype branch `claude/cornhole-game-prototype-p9nt6j` (`unity/CornholeGreybox/Assets/Scripts/Unity/MatchPresenter.cs`). That project is not on `main`.

## Status

- This spec replaces the earlier single-shot approach, in which boards and crowd were authored into every Imagine plate. That approach produced board drift, messy logos, and a crowd that sat too close.
- Face Scan desktop hero stills are **done**: `face-scan-hero-desktop-2560x1440.jpg` and `face-scan-hero-desktop-1920x1080.jpg` in the iPlay art folder, upscaled from a 1280-wide Imagine render.
- A 2026-11-10 Face Scan test showed face morphing and a flickering beam on a locked-off still. Environment plates contain no people. Crowd faces stay medium-wide or smaller in the source clip, then Unity scales the keyed layer down and places it far back, so faces are not readable in gameplay.
- Shared Dice and Cornhole hand rig: **approved 2026-11-10, in progress.** Embedded Unity package in iPlay-StreetDice, planned path `unity/Packages/com.iplay.handrig`, branch `cursor/shared-iplay-hand-rig`. Rig PR: https://github.com/unclesme15-a11y/iPlay-StreetDice/pull/3. Cornhole consumes it in https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/4.

## Layers and compositing order

Back to front, during play:

| Order | Layer | Source | Notes |
|---|---|---|---|
| 1 | Environment plate | Imagine still + 8 s loop | Empty park. No boards, no people, no hands. The lane is clear, flat grass so Unity can place boards. |
| 2 | Crowd layer | Imagine chroma-key clips | Keyed off a flat solid chroma-green backdrop and placed **far back** in the background. Idle, cheer, and groan variants swap on this layer only. |
| 3 | Boards | Unity 3D | Unity owns them completely: mesh, logo decals, nameplate, LEDs, hole, rails, scoring. Imagine never generates a board. |
| 4 | Bags | Unity | Every bag in the air or on a board is a Unity projectile. Imagine never generates a bag. |
| 5 | Hands | `com.iplay.handrig` | Purchased rig, composited over the shot. Imagine never generates a player or thrower hand. |
| 6 | HUD | Unity | Scores, prompts, reduce-motion. |

The environment and the crowd are independent. Changing the light, the camera angle, or the crowd reaction does not require regenerating the other layer, and it does not require regenerating a board.

## What Imagine generates

Two groups only:

| Group | Class | What it is |
|---|---|---|
| Environment plates | BACKGROUND | Empty backyard / park plates. Three lights (golden hour, overcast, dusk) plus the four gameplay camera angles, authored in the dusk grade until Sme locks another light. |
| Crowd layer | PUNCTUATION / AMBIENT | Cookout spectators on a flat solid chroma-green backdrop, for keying. Idle, cheer, and groan variants. |

Imagine does not generate boards, board logos, bags, the throwing hand, the opponent's body, or a character clip. Video characters in `docs/characters.md` are a later roster and are outside this list.

## What Unity owns

**Boards.** Unity authors and draws every board in every camera. That includes:

- the 2×4 ft slanted mesh (front edge low, back edge raised, 6 inch hole near the raised back)
- the locked look from `docs/art-briefs/reference/board-bags-material-sheet.png` and `docs/art-briefs/02-gpt-session-round2.md`: mirror-gloss black clear-coat deck, brushed-silver graffiti logo with thick gold edges and blue and gold paint splash, brushed dark gunmetal frame with a thin polished gold pinstripe, polished silver hole rim, unlit-in-authoring LED strips, matte nameplate on the front apron
- **logo and nameplate as decals**, so lettering stays sharp from every angle, including the near board seen from the back (logo upside down to the thrower)
- LED animation (idle chase, gold burst on a hole; `docs/led-board-and-bags.md`)
- hole, rails, and scoring

Because the boards are real 3D objects, they do not drift with a video loop, and the logo is never baked into a plate.

**Bags and hands** stay in Unity, as before. The crowd layer is placed, scaled, and far-backed in Unity after keying.

## Rules

### Length and frame

- Imagine's video model takes **1 to 15 seconds** per clip. Ask for **8 seconds** for environment loops and **4 seconds** for crowd clips. Length, 16:9 and resolution are **settings**, not words in the prompt.
- Environment plates are **seamless loops** of 8 seconds so aiming can run longer than one clip. Unity crossfades to the next play of the same loop.
- Crowd idle clips are also authored as 4 s first+last-frame loops so the far-back layer can hold. Cheer and groan clips are 4 s one-shots; after they play, Unity returns the crowd layer to idle. Do not Extend a crowd clip.
- Frame shape for this list is **16:9 landscape**, matching the prototype's landscape lock and the Face Scan desktop stills (2560×1440 and 1920×1080). Do not use 9:16.
- Generate stills and loops at **720p** (1280×720) when using a last frame or a keyframe; 1080p is not available in those modes.

### Input mode

Lock a still before spending on video.

| Kind | Still | Video mode |
|---|---|---|
| Environment loop | Text-to-image, then approve | **First+last-frame loop.** The same approved still is both the first frame and the last frame. |
| Crowd idle | Text-to-image of the group on chroma green, then approve | **First+last-frame loop** from that still, 4 s. |
| Crowd cheer or groan | The approved idle still for that group | **Image-to-video** from that still, 4 s, one-shot. Do not pin the last frame unless the take drifts off the backdrop; a pinned last frame can make the reaction look like it rewinds. |

**Keyframes.** If an environment loop drifts (tents walk forward, the lawn changes, something appears mid-clip), add **one** keyframe at the midpoint (4 s) with the same approved still, and generate again. Do not pin more than that.

Check loops by extracting the first, mid, and last frames and comparing them to the still (mean absolute error is a useful number; a visual check still decides). Reject a take if a board, a person, or a hand appears in an environment plate, if the camera moves, or if mid-clip geometry does not match the still.

### How each prompt is written

`GenerateImage` has no negative / avoid field and no image-to-image or edit mode. Reference images must live under `/workspace`. Do not attach old plates that have boards or people in them: the model will copy them. Do not attach the board material sheet to an environment or crowd prompt.

1. **Environment still.** Describe the park, the light, and a continuous uniform field of closely mowed green grass. Name the empty foreground and the unoccupied cookout setup in the far background (tents, grill, coolers, empty chairs, string lights). Do not mention boards, bags, a court, a game, a crowd, or hands. A "27-foot strip" in the prompt can come out as a contrasting turf path; prefer "a continuous uniform field of closely mowed green grass of the same color and height throughout," with a clear, flat, vacant area where Unity will place boards.
2. **Environment motion.** The approved still already decides what is in the picture. This prompt only says that the camera is locked, that the lawn stays still, and that the only motion is gentle ambient life (leaves, grill smoke, string lights).
3. **Crowd still.** Describe the group on a seamless flat chroma-key green cyclorama, the count and the 3:1 ratio, full-body or medium-wide, and relaxed idle poses with arms down or bent at the elbow.
4. **Crowd motion.** Say what the group does (talk, cheer with arms low, sag and drop heads). Repeat that arms stay down and that the green backdrop stays uniform and still.

If a later app shows an avoid field, use it. Until then, end environment stills with "empty foreground" rather than a list of banned objects. Naming a thing ("no boards", "no hands") puts it in the model's head.

The look is described in plain words, not house names: Imagine does not know what an "iPlay grade" is and may try to write "iPlay" into the picture. Dusk plates use "low-key cinematic lighting with deep shadows, soft teal and magenta accent lights." Golden hour and overcast keep their own sky.

### Crowd ratio, casting, and hands

Smee locked the ratio on 2026-11-11: **3 women to 1 man**. Groups of 4 are 3 women and 1 man. Groups of 8 are 6 women and 2 men. Casting otherwise follows the cookout crowd in `docs/visual-camera-plan.md`: mostly curvy adult Black women, then Latina, then white, with men in that 3:1 mix. A few kids only if they stay far from the lane and do not break the ratio; the current clips have no kids. If that direction changes, change the crowd words before generating.

#### Crowd hands

The standing rule is unchanged: **Imagine never generates hands for player or thrower hands.** Those always come from `com.iplay.handrig`.

Crowd clips are a full-body layer, so ordinary hands will appear as part of a distant body (a cup held close, an arm hanging at the side). That is acceptable. Keep them non-prominent:

- no wave, clap, point, or raised hand
- no hand-focused gesture, and no close-up of fingers
- cheers read from leaning in, bouncing on the heels, and mouths open, with arms low at the sides
- groans read from a sag, a wince, and heads dropping, not from hands

Unity keys the clip, scales it down, and sits it far back, so those body-scale hands should not read as player hands.

## Playback and Unity

The environment plate on screen is the camera angle for that moment. The 3D boards, the Unity bag, and the purchased hand are drawn in front of it. The keyed crowd sits far behind the boards. `MatchPresenter` is the door (prototype):

| Moment | Call | What the presenter does |
|---|---|---|
| Match opens | `OnMatchOpened` | Load the approved light's environment loop and **CAM-THROWER**. Place the **Unity 3D boards** in the clear grass of that plate (not as invisible colliders stuck to a video board). Show the hand rig, hidden until someone is throwing. Start the crowd layer on a random **CRD-IDLE** loop, keyed and far back. |
| Aim, pull, shake | `OnAimChanged(aim, power, shotId, pulling, handShake)` | Drive the purchased hand. The plate stays **CAM-THROWER**. `handShake` above 1 trembles the rig. The crowd stays on idle. |
| A throw exists | `OnThrowResult` | Play that seat's gesture on the purchased hand. Schedule the camera cut from the rules below. |
| Bag in the air | `OnReplayFrame` | Move the Unity bag. The Imagine plate has no bag. |
| Hole | `OnCue` with `reason: "hole"` (sound `cornhole_hit`) | Swap the crowd layer to a random **CRD-CHEER** variant, then return to idle. The environment plate and the 3D boards do not cut away for the cheer. |
| Miss (off the board) | `OnCue` with `reason: "foul"` (sound `ground_thud`) | Swap the crowd layer to a random **CRD-GROAN** variant, then return to idle. |
| Woody (on the board, not in the hole) | `OnCue` with `reason: "landing"` (sound `bag_thud`) | Stay on the camera plate and the idle crowd. No groan. |
| Inning score | `OnScore` | HUD only. It does not pick a plate or a crowd clip. |
| Reduce motion | `OnCue(..., reduceMotion: true)` | Skip the crowd reaction swap. Keep the camera plate and idle crowd. Optionally freeze the environment on its still. |

Camera cuts for one throw still pick the environment plate. The 3D boards stay in world space, so each camera plate has to be laid out against the same court:

- **Local player, and anyone throwing at the far board:** start on **CAM-THROWER** (or **CAM-NEIGHBOR** when that plate is the one in use). At **0.33 s** after release, cut to **CAM-FAR**. Hold about **1.2 s** after the bag stops, then return to **CAM-THROWER**. Match Setup can turn the board-cam cut off (default is on; `docs/game-rules.md`). When it is off, stay on the plate that showed the release and let the Unity bag carry the flight.
- **Singles, the player beside you:** **CAM-NEIGHBOR** for the gesture, then the same 0.33 s cut to **CAM-FAR**, because both players throw at the far board.
- **2v2, your partner at the opposite end:** **CAM-PARTNER** replaces **CAM-NEIGHBOR**. The purchased hand plays the gesture in that empty far box. They throw at your board, so do not cut to **CAM-FAR**. On release, return to **CAM-THROWER**, where your own board sits in the lower frame and the Unity bag comes in. The whole partner throw and landing stays inside 15 s.
- **2v2, the opponent beside you:** there is no extra Imagine plate. Their purchased-hand gesture enters from the side of **CAM-THROWER** that is not the local player's side, then **CAM-FAR** at 0.33 s. The plate stays empty of people.

The release the presenter uses is the rig's release, not a frame hunted inside an Imagine clip.

On a camera cut, the crowd layer can stay in world space behind the court (preferred: it does not pop) or be re-anchored to the new plate, still far back. Do not let the crowd sit at mid-near or large enough to read faces.

### Unity-side notes

- **Board placement.** Each environment still leaves a clear, flat lawn in the area that used to be occupied by a baked-in board. Place the 3D boards there. CAM-THROWER needs a large near board in the lower left (hole closest to camera, logo upside down from this angle) and a smaller far board down the lane (front and nameplate facing the camera). CAM-FAR is a low, slightly off-axis close view of the far board, with the deck filling the lower half. CAM-NEIGHBOR looks across the near board at the other box on the same end, with empty grass in the lower third for the rig. CAM-PARTNER looks down the lane at the opposite pitcher's box, with the far board beside that box and empty grass in the lower center for the partner hand.
- **Logo decals.** Apply the locked deck logo and the nameplate as Unity decals (or equivalent textures on the 3D board). Do not ask Imagine to paint them.
- **LEDs.** Author the 3D strips dark. Unity animates them at runtime.
- **Keying.** Use a chroma key on the flat green cyc. Soft contact shadows under feet can be kept or keyed softly so the group sits on the far lawn. Reject a clip whose backdrop is uneven enough to leave a fringe.
- **Crowd scale.** Source clips are medium-wide full-body so there is resolution to shrink. In game, the group should read as small, far-back spectators, not as people standing beside the lane.
- **Looping.** Crossfade plays of an environment loop and of a crowd idle loop. Never play the same cheer or groan twice in a row.

### Summary

| ID | Class | Name | Loop or one-shot | Length | Input mode |
|---|---|---|---|---|---|
| BG-GOLDEN | BACKGROUND | Golden hour, empty park | Seamless loop | 8 s | First+last-frame loop |
| BG-OVERCAST | BACKGROUND | Overcast, empty park | Seamless loop | 8 s | First+last-frame loop |
| BG-DUSK | BACKGROUND | Dusk, empty park | Seamless loop | 8 s | First+last-frame loop |
| CAM-THROWER | BACKGROUND | Thrower View, empty lane | Seamless loop | 8 s | First+last-frame loop |
| CAM-FAR | BACKGROUND | Far Board Cam, empty grass | Seamless loop | 8 s | First+last-frame loop |
| CAM-NEIGHBOR | BACKGROUND | Neighbor Cut, empty boxes | Seamless loop | 8 s | First+last-frame loop |
| CAM-PARTNER | BACKGROUND | 2v2 partner shot, empty far box | Seamless loop | 8 s | First+last-frame loop |
| CRD-IDLE-1 | AMBIENT | Crowd idle A, 3W+1M | Seamless loop | 4 s | First+last-frame loop |
| CRD-IDLE-2 | AMBIENT | Crowd idle B, 6W+2M | Seamless loop | 4 s | First+last-frame loop |
| CRD-IDLE-3 | AMBIENT | Crowd idle C, 3W+1M | Seamless loop | 4 s | First+last-frame loop |
| CRD-CHEER-1 | PUNCTUATION | Hole cheer A, from idle 1 | One-shot | 4 s | Image-to-video |
| CRD-CHEER-2 | PUNCTUATION | Hole cheer B, from idle 2 | One-shot | 4 s | Image-to-video |
| CRD-CHEER-3 | PUNCTUATION | Hole cheer C, from idle 3 | One-shot | 4 s | Image-to-video |
| CRD-GROAN-1 | PUNCTUATION | Miss groan A, from idle 1 | One-shot | 4 s | Image-to-video |
| CRD-GROAN-2 | PUNCTUATION | Miss groan B, from idle 2 | One-shot | 4 s | Image-to-video |
| CRD-GROAN-3 | PUNCTUATION | Miss groan C, from idle 3 | One-shot | 4 s | Image-to-video |

The older RX-HOLE, RX-MISS, and RX-AMB IDs, which baked a reaction into a CAM-THROWER plate that already had boards and crowd in it, are retired.

## 1. Environment plates

Empty park plates. Same park, three lights, plus the four gameplay angles in the **dusk** grade, which is the gameplay default until Sme picks another light. Do not build a second full camera set in golden hour or overcast until Sme says that light is the one.

Shared still language: a big open city park, an unoccupied summer cookout setup far back (white, royal-blue, and magenta pop-up canopy tents, a smoking kettle grill, unattended coolers, empty folding chairs, string lights, small teal and magenta accent lights), a continuous uniform field of closely mowed green grass, the foreground and the board-placement area completely clear. Shared motion language is in each plate below.

### BG-GOLDEN

- **ID:** BG-GOLDEN
- **Type:** BACKGROUND
- **Purpose:** Ambient loop of the empty park in warm low sun. Plays behind a match only if Sme locks this light. Until then it is the golden-hour option.
- **Framing and camera:** Wide locked-off view from a static tripod at chest height, off to the side, looking along the area of a 27-foot lane. The entire foreground, lower third, and lane are clear, flat grass. Cookout setup in the far background. No boards, no people.
- **Length target:** 8 s (15 s cap).
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Still prompt** (text-to-image; no board or crowd reference):

```text
Photorealistic wide shot from a static tripod at chest height in a big open city park, summer evening golden hour, warm low sun and long soft shadows across a continuous uniform field of closely mowed green grass of the same color and height throughout. The camera stands off to one side and looks along a long flat stretch of lawn into the middle distance. The entire foreground, the lower third, and that lawn are completely clear, open, and vacant. In the far background a line of mature leafy green trees, an unoccupied summer cookout setup with white, royal-blue, and magenta pop-up canopy tents, warm string lights just starting to glow, a smoking black kettle charcoal grill, unattended blue and red coolers, and empty folding chairs under the tents, small teal and magenta accent lights on the tent frames, soft grill smoke, 35mm lens, empty foreground
```

- **Motion prompt** (video; settings: 8 s, 16:9, 720p):

```text
Static locked-off tripod shot, the camera does not move. Gentle ambient motion only: leaves rustle slightly in the far trees, grill smoke drifts, string lights flicker softly. The lawn stays perfectly still. Nothing appears on the grass.
```

- **Acceptance:** First and last frames match the still. Mid-clip geometry matches the still (retry with a 4 s midpoint keyframe if tents, trees, or the lawn drift). No board, bag, person, or hand in any frame. Lane and foreground stay empty and flat. Grade reads as golden hour.
- **Unity hookup:** `OnMatchOpened` may select this loop as the environment bed after Sme approves the light. It is not a throw camera. The hand rig is not parented to this plate. 3D boards sit on the clear lawn.

### BG-OVERCAST

- **ID:** BG-OVERCAST
- **Type:** BACKGROUND
- **Purpose:** The same empty park under a soft grey sky. An option, not the gameplay default.
- **Framing and camera:** Same wide locked-off view as BG-GOLDEN.
- **Length target:** 8 s (15 s cap).
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Still prompt** (text-to-image; a passing BG-GOLDEN still may be attached as a park-layout reference, never an old plate that contains boards or people):

```text
Photorealistic wide shot from a static tripod at chest height in the same big open city park as the reference, now under a soft overcast grey sky with even flat daylight. A continuous uniform field of closely mowed green grass of the same color and height throughout fills the foreground and midground; the lawn is completely clear, open, and vacant. In the far background a line of mature leafy green trees and an unoccupied summer cookout setup with white, royal-blue, and magenta pop-up canopy tents, a smoking black kettle charcoal grill, unattended blue and red coolers, and empty folding chairs under the tents, small teal and magenta accent lights on the tent frames, soft grill smoke, 35mm lens, empty foreground
```

- **Motion prompt** (video; settings: 8 s, 16:9, 720p): same as BG-GOLDEN.
- **Acceptance:** Same as BG-GOLDEN. Sky reads overcast.
- **Unity hookup:** Same as BG-GOLDEN. Environment bed only, after approval.

### BG-DUSK

- **ID:** BG-DUSK
- **Type:** BACKGROUND
- **Purpose:** Dusk-to-night empty park. This is the light the camera plates use until Sme locks another one.
- **Framing and camera:** Same wide locked-off view as the other background plates.
- **Length target:** 8 s (15 s cap).
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Still prompt** (text-to-image):

```text
Photorealistic wide shot from a static tripod at chest height in a big open city park, dusk turning to night, deep blue sky, low-key cinematic lighting with deep shadows across a continuous uniform field of closely mowed green grass of the same color and height throughout. The camera stands off to one side and looks along a long flat stretch of lawn into the middle distance. The entire foreground, the lower third, and that lawn are completely clear, open, and vacant. In the far background a line of dark mature trees, an unoccupied summer cookout setup with white, royal-blue, and magenta pop-up canopy tents, warm string lights glowing, a smoking black kettle charcoal grill, unattended blue and red coolers, and empty folding chairs under the tents, soft teal and magenta accent lights on the tent frames, grill smoke far back, 35mm lens, empty foreground
```

- **Motion prompt** (video; settings: 8 s, 16:9, 720p): same as BG-GOLDEN, with "far dark trees" and "warm string lights" if useful.
- **Acceptance:** Same as BG-GOLDEN. Practical lights read as dusk, not daylight.
- **Unity hookup:** Default environment bed in `OnMatchOpened` until another light is approved. Crossfade plays of this loop while the match sits on a camera plate of the same light.

### CAM-THROWER

- **ID:** CAM-THROWER
- **Type:** BACKGROUND
- **Purpose:** First-person view while the local player aims and releases, and the view that shows a bag arriving at your own board. The near board is a Unity 3D board in the lower left; the plate itself is empty grass.
- **Framing and camera:** Standing eye height, about 5 feet, 28mm, from your pitcher's box, looking straight down the 27-foot lane. Immediate foreground is a large expanse of empty grass filling the bottom half, with a clear flat patch in the lower left for the near board and plain empty grass along the bottom right for the rig. The same lawn recedes toward a clear flat patch in the middle distance for the far board. Cookout tents sit small and low on the horizon at the far end. No boards, no people.
- **Length target:** 8 s. Must cover one throw and landing inside 15 s.
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Still prompt** (text-to-image; do not attach a wide sideline still as a reference, or the model will copy that angle):

```text
Photorealistic first-person view from a static tripod at standing eye height, about five feet off the ground, 28mm wide lens, the camera standing at one end of a long lawn and looking straight down its length as if down a 27-foot playing lane. The immediate foreground is a large expanse of empty closely mowed green grass filling the entire bottom half of the frame, with a clear flat patch especially in the lower left and plain empty grass along the bottom right. The same uniform grass recedes away from the camera toward the far end of the lane. Small in the distance at the far end of the lawn, low on the horizon, an unoccupied summer cookout of white, royal-blue, and magenta pop-up canopy tents, warm string lights, a smoking kettle grill, unattended coolers and empty folding chairs. Dusk turning to night, deep blue sky filling the top of the frame, low-key cinematic lighting with deep shadows, soft teal and magenta accent lights far back, empty foreground
```

- **Motion prompt** (video; settings: 8 s, 16:9, 720p):

```text
Static locked-off tripod shot, the camera does not move. Gentle ambient motion only: leaves rustle slightly in the far trees, grill smoke drifts, warm string lights flicker softly. The lawn stays perfectly still. The tents stay at the far end of the lawn and do not come closer. Nothing appears on the grass.
```

- **Acceptance:** No board, person, or hand in any frame. Lower-left and lower-right grass stay clear. Tents stay at the far end for the whole loop (retry with a 4 s midpoint keyframe if they walk forward). Loop point is invisible. One 8 s play is longer than release → 0.33 s cut → flight → slide → 1.2 s hold.
- **Unity hookup:** Default plate from `OnMatchOpened` and `OnAimChanged`. Place the near 3D board large in the lower left and the far 3D board down the lane. Local release starts here. `OnReplayFrame` draws the bag leaving the rig toward the far board. At 0.33 s, cut to CAM-FAR when the board-cam setting is on. 2v2 partner landings return here on release. The hand is the purchased rig along the bottom, clear of the near hole: bottom-right for a right-handed player, bottom-left when mirrored.

### CAM-FAR

- **ID:** CAM-FAR
- **Type:** BACKGROUND
- **Purpose:** Close view of the far board so the landing is easy to read. The board itself is Unity 3D in the lower half. Used only for bags thrown at the far board.
- **Framing and camera:** Low, slightly to the side, knee height, 50mm, shallow depth of field. The entire lower half is empty, flat, closely mowed grass. The cookout is soft and far behind. No board, no person, no bag.
- **Length target:** 8 s. The on-screen stay is shorter: from 0.33 s after release through the landing hold (about 1.2 s after the bag stops). The loop must cover that stay.
- **Loop or one-shot:** Seamless loop. Unity cuts into the loop; it does not play a staged landing.
- **Input mode:** First+last-frame loop from one approved still.
- **Still prompt** (text-to-image):

```text
Photorealistic low shot from a static tripod at knee height, slightly off-axis to one side, in a big open city park at dusk. The entire lower half of the frame is a close view of closely mowed green grass, uniform in color and height, empty, flat, and clear. Softly out of focus in the background: an unoccupied summer cookout with white, royal-blue, and magenta pop-up canopy tents, warm string lights, a smoking kettle grill, unattended coolers, empty folding chairs, deep blue dusk sky, low-key cinematic lighting with deep shadows, soft teal and magenta accent lights, shallow depth of field, 50mm lens, empty foreground
```

- **Motion prompt** (video; settings: 8 s, 16:9, 720p):

```text
Static locked-off tripod shot, the camera does not move. The grass in the foreground stays perfectly still. Far behind it, grill smoke drifts, string lights flicker softly, and leaves rustle. Nothing comes onto the lawn.
```

- **Acceptance:** Grass in the lower half stays empty and locked to the still. No board, person, or hand enters the foreground. Background stays soft.
- **Unity hookup:** `OnThrowResult` schedules the cut to this plate at **0.33 s** after release for the local player, the singles neighbor, and the 2v2 opponent who shares your end. Place the far 3D board in the lower half, deck toward camera, hole clear. `OnReplayFrame` drops the Unity bag onto this board. Do not use this plate for the 2v2 partner, who throws at your board. After the 1.2 s hold, return to CAM-THROWER.

### CAM-NEIGHBOR

- **ID:** CAM-NEIGHBOR
- **Type:** BACKGROUND
- **Purpose:** Singles only. The player beside you, one on each side of your board (`docs/game-rules.md`). The person the player sees is the purchased Unity hand, not an Imagine person.
- **Framing and camera:** Closer side angle at standing eye height, 35mm, looking across an empty near-board patch of grass at the other empty standing area on the same end. The lower third is plain empty grass for the rig. Cookout mid-background, not a wide park establishing shot. No boards, no people.
- **Length target:** 8 s, covering one throw and the cut to the landing inside 15 s.
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Still prompt** (text-to-image):

```text
Photorealistic closer side-on view from a static tripod at standing eye height, 35mm lens, the camera near one end of a lawn looking slightly across it rather than out at a wide park vista. Empty closely mowed green grass fills the lower left. A clear empty standing patch of the same grass occupies the right side of the foreground. The lower third of the frame is plain empty grass. Mid-background on the right, not huge, an unoccupied summer cookout of a royal-blue and a magenta pop-up canopy tent, warm string lights, a smoking kettle grill, unattended coolers and empty folding chairs. Dusk turning to night, deep blue sky, low-key cinematic lighting with deep shadows, soft teal and magenta accent lights, empty foreground
```

- **Motion prompt** (video; settings: 8 s, 16:9, 720p): same as CAM-THROWER, without the "tents stay at the far end" line if the tents are mid-background in this angle.
- **Acceptance:** Both standing areas stay empty. No board, hand, or person. The lower band stays clear for the rig. The board Unity places in the lower left does not have to fight baked-in geometry.
- **Unity hookup:** In singles, `OnThrowResult` for the other seat shows the purchased hand in this framing, same gestures as the local throw, with the bag prop. At 0.33 s after that release, cut to CAM-FAR. In 2v2 this plate is not used; CAM-PARTNER replaces it.

### CAM-PARTNER

- **ID:** CAM-PARTNER
- **Type:** BACKGROUND
- **Purpose:** 2v2 only. Replaces Neighbor Cut. A straight-on view of your partner throwing from the opposite end. The throwing hand is the purchased Unity hand composited into the empty far box. The far board is a Unity 3D board beside that box.
- **Framing and camera:** Straight down the lane from your box, standing eye height, 35mm. The lower two thirds and lower center are a large expanse of empty grass. A clear flat standing patch sits in the middle distance, centered or slightly off center. Cookout tents far behind that patch and to the sides, small in frame. No boards, no people, no bag.
- **Length target:** 8 s. The gesture and the return to Thrower View for the landing on your board fit inside 15 s.
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Still prompt** (text-to-image):

```text
Photorealistic straight-on shot from a static tripod at standing eye height, 35mm lens, looking straight down a long stretch of empty closely mowed green grass as if down a 27-foot playing lane. The lower two thirds of the frame and the entire lower center are a large expanse of plain empty grass. In the middle distance, centered, is a clear flat standing patch of the same lawn with nothing on it. Far behind that patch and to the sides, small in frame, an unoccupied summer cookout of white, royal-blue, and magenta pop-up canopy tents, warm string lights, a smoking kettle grill, unattended coolers and empty folding chairs. Dusk turning to night, deep blue sky, low-key cinematic lighting with deep shadows, soft teal and magenta accent lights, empty foreground
```

- **Motion prompt** (video; settings: 8 s, 16:9, 720p): same as CAM-THROWER.
- **Acceptance:** The opposite box stays empty on every frame. No Imagine hand, body, or board. Lower center stays clear. Tents stay far.
- **Unity hookup:** In 2v2, when the partner at the other end throws, `OnThrowResult` plays the purchased hand in this frame. Place the far 3D board beside the empty box, not in the middle of it. On release, cut back to CAM-THROWER and let `OnReplayFrame` land the bag on your board. Do not cut to CAM-FAR for this throw.

## 2. Crowd layer

Separate clips of cookout spectators on a flat solid chroma-green backdrop, keyed and placed far back in Unity. Three idle loops, three hole cheers, and three miss groans. Each reaction is generated from the matching idle group's still, so costumes stay consistent.

Shared still language: seamless chroma-key green cyclorama for both the backdrop and the floor, even soft studio lighting, no park, no sky, no grass, no props, no furniture, full-body, small or medium-wide in the frame with green space around the group, casual summer clothes, drinks held close to the body, arms down or comfortably bent at the elbow, no raised arms, no waving, no pointing, no clapping.

### CRD-IDLE-1

- **ID:** CRD-IDLE-1
- **Type:** AMBIENT
- **Purpose:** Default far-back crowd, group A. Four people, 3 women and 1 man, chatting.
- **Framing and camera:** Medium-wide full-body studio shot, locked off, group small in the frame with space around them.
- **Length target:** 4 s.
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Still prompt** (text-to-image):

```text
Photorealistic medium-wide full-body studio shot of four adult cookout spectators standing together on a seamless chroma-key green cyclorama. The entire background and the floor are a smooth uniform bright chroma-key green, even soft studio lighting, no park, no sky, no grass, no props, no furniture. The group is small in the frame with plenty of green space around them. Exactly three adult women and one adult man: a curvy Black woman, a curvy Latina woman, a curvy white woman, and one Black man, all in casual summer clothes, shorts and tank tops or tees. They stand in a loose cluster chatting, relaxed, weight shifted, drinks held close to their bodies, arms down or comfortably bent at the elbow, no raised arms, no waving, no pointing, no clapping. Faces visible but not close-ups. 35mm lens
```

- **Motion prompt** (video; settings: 4 s, 16:9, 720p):

```text
Static locked-off camera. The four people stay in place on the green backdrop and talk quietly among themselves, shifting their weight slightly and sipping drinks. Arms stay down or comfortably bent at the elbow. Nobody raises a hand, waves, points, or claps. The green backdrop stays perfectly uniform and still.
```

- **Acceptance:** Count and ratio stay 3 women and 1 man on every frame. Backdrop stays a clean, even green. First and last frames match closely enough to loop. Mid-clip motion is ordinary talking, not a cheer or a groan. Hands stay non-prominent. No brand-new person. Faces do not fill the frame.
- **Unity hookup:** Default crowd layer while idle on a camera plate. Crossfade plays of this loop with the other idle variants, never the same one twice in a row, and never during a cheer or groan. Key, scale down, place far back.

### CRD-IDLE-2

- **ID:** CRD-IDLE-2
- **Type:** AMBIENT
- **Purpose:** Default far-back crowd, group B. Eight people in two loose clusters, 6 women and 2 men.
- **Framing and camera:** Wider full-body studio shot, group still small in the frame.
- **Length target:** 4 s.
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Still prompt** (text-to-image):

```text
Photorealistic wide full-body studio shot of eight adult cookout spectators standing on a seamless chroma-key green cyclorama. The entire background and the floor are a smooth uniform bright chroma-key green, even soft studio lighting, no park, no sky, no grass, no props, no furniture. The group is small in the frame with plenty of green space around them, arranged as two loose clusters. Exactly six adult women and two adult men: mostly curvy Black women with Latina and white women mixed in, and two men, all in casual summer clothes. They chat among themselves, relaxed, drinks held close to their bodies, arms down or comfortably bent at the elbow, no raised arms, no waving, no pointing, no clapping. Faces visible but not close-ups. 35mm lens
```

- **Motion prompt** (video; settings: 4 s, 16:9, 720p): same as CRD-IDLE-1, with "eight people" and "two loose clusters."
- **Acceptance:** Count and ratio stay 6 women and 2 men. Otherwise the same as CRD-IDLE-1.
- **Unity hookup:** Same idle pool as CRD-IDLE-1.

### CRD-IDLE-3

- **ID:** CRD-IDLE-3
- **Type:** AMBIENT
- **Purpose:** Default far-back crowd, group C. Four people in a staggered line, 3 women and 1 man, different clothes from group A.
- **Framing and camera:** Medium-wide full-body studio shot.
- **Length target:** 4 s.
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop from one approved still.
- **Still prompt** (text-to-image):

```text
Photorealistic medium-wide full-body studio shot of four adult cookout spectators standing in a staggered loose line on a seamless chroma-key green cyclorama. The entire background and the floor are a smooth uniform bright chroma-key green, even soft studio lighting, no park, no sky, no grass, no props, no furniture. The group is small in the frame with plenty of green space around them. Exactly three adult women and one adult man at the end of the line: a curvy Black woman in a yellow top, a curvy Latina woman in a black tank, a curvy white woman in a denim outfit, and one man in a summer tee, casual cookout clothes. They stand relaxed and talking, drinks held close, arms down or comfortably bent at the elbow, no raised arms, no waving, no pointing, no clapping. Faces visible but not close-ups. 35mm lens
```

- **Motion prompt** (video; settings: 4 s, 16:9, 720p): same as CRD-IDLE-1.
- **Acceptance:** Same as CRD-IDLE-1.
- **Unity hookup:** Same idle pool as CRD-IDLE-1.

### CRD-CHEER-1 / CRD-CHEER-2 / CRD-CHEER-3

- **IDs:** CRD-CHEER-1, CRD-CHEER-2, CRD-CHEER-3
- **Type:** PUNCTUATION
- **Purpose:** Crowd cheer when a bag goes in the hole. Variants A, B, and C use the idle 1, 2, and 3 groups so costumes match.
- **Framing and camera:** Same frame as the matching idle still. Backdrop stays green. People stay in place.
- **Length target:** 4 s.
- **Loop or one-shot:** One-shot.
- **Input mode:** Image-to-video from the approved matching idle still.
- **Motion prompts** (video; settings: 4 s, 16:9, 720p):

CRD-CHEER-1:

```text
Static locked-off camera. The four people stay in place on the green backdrop. They lean in, bounce on their heels and cheer with their arms low at their sides, mouths open, then start to settle. Nobody raises a hand above the shoulder, waves, points, or claps. The green backdrop stays perfectly uniform and still.
```

CRD-CHEER-2: the same, with "eight people" and "two loose clusters."

CRD-CHEER-3:

```text
Static locked-off camera. The four people stay in place on the green backdrop. They turn slightly as if watching a game down the lane, the energy lifts, they cheer with their arms low at their sides, then start to settle. Nobody raises a hand above the shoulder, waves, points, or claps. The green backdrop stays perfectly uniform and still.
```

- **Acceptance:** Count and ratio stay correct. Backdrop stays clean green. The beat reads as a cheer in the first 4 seconds. Arms stay low; fingers never become the subject. Nobody walks forward or off the cyc. Reject mass raised hands.
- **Unity hookup:** `OnCue` reason `hole`. Pick among the three cheers, skipping the one just played. Then return the crowd layer to idle. Skip the swap when `reduceMotion` is true. The environment plate and the 3D boards do not cut away.

### CRD-GROAN-1 / CRD-GROAN-2 / CRD-GROAN-3

- **IDs:** CRD-GROAN-1, CRD-GROAN-2, CRD-GROAN-3
- **Type:** PUNCTUATION
- **Purpose:** A groan when the bag misses the board. Variants A, B, and C use the idle 1, 2, and 3 groups.
- **Framing and camera:** Same frame as the matching idle still.
- **Length target:** 4 s.
- **Loop or one-shot:** One-shot.
- **Input mode:** Image-to-video from the approved matching idle still.
- **Motion prompts** (video; settings: 4 s, 16:9, 720p):

CRD-GROAN-1:

```text
Static locked-off camera. The four people stay in place on the green backdrop. They sag with a short groan, heads drop, then they look away and settle. Arms stay down or comfortably bent at the elbow. Nobody raises a hand, waves, points, or claps. The green backdrop stays perfectly uniform and still.
```

CRD-GROAN-2:

```text
Static locked-off camera. The eight people stay in place on the green backdrop, in two loose clusters. This is a disappointed reaction to a missed throw, not a laugh or a cheer. They wince, shoulders sag, heads drop, faces show disappointment, then they glance at each other and settle. Arms stay down or comfortably bent at the elbow holding drinks. Nobody raises a hand, waves, points, claps, or smiles widely. The green backdrop stays perfectly uniform and still.
```

CRD-GROAN-3:

```text
Static locked-off camera. The four people stay in place on the green backdrop. A short disappointed murmur moves through the group, heads dip, then they go back to talking. Arms stay down or comfortably bent at the elbow. Nobody raises a hand, waves, points, or claps. The green backdrop stays perfectly uniform and still.
```

- **Acceptance:** Count and ratio stay correct. Backdrop stays clean green. The beat reads as a miss, not a cheer or ordinary conversation. Hands stay non-prominent.
- **Unity hookup:** `OnCue` reason `foul` (bag off the board). Pool the three groans. Do not play on reason `landing` (that is a woody). Skip when `reduceMotion` is true. Then return the crowd layer to idle.

## 3. Hand and throw

### Source

All player and thrower hands, and every throw gesture, come from the Unity package **`com.iplay.handrig`**.

The package is owned by Street Dice and consumed by Cornhole. Rig PR: https://github.com/unclesme15-a11y/iPlay-StreetDice/pull/3, planned path `unity/Packages/com.iplay.handrig`. Cornhole consumes it from the prototype Unity project in https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/4. The hand maps to `Resources/FirstPersonHands/FirstPersonHand_L` and `Resources/FirstPersonHands/FirstPersonHand_R` (LeftResourcePath / RightResourcePath on `HandModelContract`). The purchased asset's product name and laptop verification are still open in Needs Sme; the package name is not.

The rig is composited over the Imagine environment plate and the Unity boards. It is the only hand for:

- the local player on CAM-THROWER
- the singles player beside you on CAM-NEIGHBOR
- the 2v2 partner on CAM-PARTNER
- the 2v2 opponent who shares your end, entering from the side of CAM-THROWER

Imagine does not generate a hand for any of those shots, and it does not generate a backup hand. It also does not generate crowd hands from the rig. See [Crowd hands](#crowd-hands).

### Shared hand rig (approved 2026-11-10, in progress)

One iPlay hand rig, **owned by Street Dice** and **consumed by Cornhole** from the prototype Unity project, on the purchased Unity hand asset.

- **Prop slot.** One swappable socket on the hand. Dice puts the die in it. Cornhole puts the bag in it. Grip and release timing stay the same. After release, Cornhole hides the prop and `OnReplayFrame` flies the game bag.
- **Skin and material.** One skin, the purchased asset's skin, shared by both games. The material slot is the one Dice already uses for the hand fade (`CatchSkin.cginc`, `CatchVideo.shader`). Cornhole does not author a second skin.
- **Gesture set.** The same set Dice already drives: the throw motion captured and checked by `ThrowMotionCapture` and `ThrowMotionVerification`, plus catch, plant, tap, and wave. Cornhole maps its own input onto that motion through `OnAimChanged`: drag to aim, pull back for power, flick to release, lean left or right, and `handShake` for the long hold. It does not invent a second vocabulary.
- **Where the shared code lives.** An embedded Unity package in `unclesme15-a11y/iPlay-StreetDice`, on branch `cursor/shared-iplay-hand-rig`. Cornhole's only new script is a thin `MatchPresenter` that binds the bag prop and forwards `OnAimChanged` and `OnThrowResult`. Do not copy the Dice scripts into Cornhole as a fork.

### Why the hand stays in Unity

The 2026-11-10 Face Scan test showed Imagine morphing a face and flickering a beam on a locked-off still. Hands morph the same way. The hand the player watches is the purchased rig, composited over a plate that was generated empty. That is the rule for every environment plate in this list.

## When generation is allowed

Generate in this order. Review every take against that plate's acceptance lines. A failed take is discarded. Retry up to three times per item. Do not paint a board, a person, or a hand out of a bad frame and keep it. Do not commit generated media to git.

1. Text-to-image stills for BG-GOLDEN, BG-OVERCAST, BG-DUSK, CAM-THROWER, CAM-FAR, CAM-NEIGHBOR, and CAM-PARTNER. Confirm each one has no boards, no people, and a clear flat lane. Stop for plate approval before any video if Sme has asked for that gate; otherwise lock a still visually and continue, logging notes.
2. First+last-frame 8 s loops from the approved environment stills. Dusk camera plates first if a choice is required. Midpoint-keyframe a retry if mid-clip geometry drifts.
3. Text-to-image crowd stills for the three idle groups, then 4 s idle loops, then 4 s cheer and groan image-to-video takes from those stills.
4. Wire playback through `MatchPresenter` only after the plates exist: 3D boards with decals in the clear grass, crowd keyed and far back, hands from `com.iplay.handrig`. The prototype consumes the package in https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/4 (package PR https://github.com/unclesme15-a11y/iPlay-StreetDice/pull/3).

A generation log and contact sheet for the 2026-11-11 layered pass live on disk at `/workspace/iplay-art/cornhole/plates-v2/` (not in git). The previous baked-together plates remain in `/workspace/iplay-art/cornhole/plates/` and were not moved.

## Needs Sme

- **Plate approvals.** The seven empty environment stills and loops, and the nine crowd clips, including any notes on the generation log.
- **Camera-plate framing.** CAM-THROWER and CAM-PARTNER are down-the-lane empty lawns. Unity has to place the near board in the lower left of CAM-THROWER and mark the far pitcher's box on CAM-PARTNER; those slots are not pre-drawn in the video. Confirm the framing is usable, or ask for another pass.
- **Set matching across angles.** The three BG lights share one open-park sideline. The dusk camera plates are the same cookout language but not a surveyed match of that sideline (THROWER and PARTNER are more enclosed, NEIGHBOR has the tents closer on the right). Accept, or retry for a tighter match.
- **Crowd scale and placement.** Source clips are medium-wide so Unity can shrink them. Confirm how far back they sit, how many groups are on screen at once, and whether kids should be added later without breaking the 3:1 ratio.
- **Board look on the 3D model.** Logos are Unity decals, so the earlier "accept a messy logo in the wide shots" choice is closed for Imagine plates. The material sheet and the locked brief (`docs/art-briefs/02-gpt-session-round2.md`) still disagree on three Unity-side items that do not affect plates: (1) the sheet's bags carry the "iPLAY" wordmark, but the brief locked the i-and-play-button mark only, no words; (2) the yellow bag's suede underside is black in the sheet, but the brief says the same color as the front; (3) the sheet's nameplate shows the play button replacing the P, but the brief locked the play button inside the P. The Unity bag textures and the final nameplate art still need Sme's pick.
- **Default light.** Dusk remains the gameplay default until another light is chosen. A second full camera set in golden hour or overcast waits on that pick.
- **Purchased Unity hand asset (product name / laptop verification).** The package is `com.iplay.handrig`. The product name of the purchased asset, and laptop verification of the prefabs, are still open. Also confirm that this asset is the one that plays the Dice gesture set (throw, catch, plant, tap, wave) Cornhole will reuse.
