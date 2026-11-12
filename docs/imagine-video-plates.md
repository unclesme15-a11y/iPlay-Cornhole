# Imagine Video Plate List

Layered plate spec. Imagine generates the environment and a separate keyed crowd layer. Unity owns the boards completely, and the purchased hand rig owns every player hand. Applying this document does not generate images, video, or Unity assets. Generated media is not committed to git.

**Tool:** Imagine (Grok Imagine, via SuperGrok / `GenerateImage` and `GenerateVideo`). Kling, Veo, and Seedance are not used. **fal is frozen** and is not used for any plate in this list.

**Hands:** every player and thrower hand, and every throw gesture, comes from the Unity rig in package **`com.iplay.handrig`**, composited over the plate. Imagine never generates player or thrower hands. No environment plate, including Thrower View, Neighbor Cut, and the 2v2 partner shot, shows an Imagine hand or an Imagine person in the foreground. Crowd clips may include ordinary body-scale hands as part of a distant figure; those hands stay non-prominent, and the rig is not used to composite them. See [Crowd hands](#crowd-hands).

**Direction (2026-11-11, Smee):** boards and crowd must not be baked into the same Imagine shot. Unity controls the boards completely, with logos applied as decals. The crowd sits far back in the background, at a ratio of **3 women to 1 man**. The environment is a separate layer.

**Approved set (2026-11-12, Smee):** the current plate set is approved. Daytime only. Fifteen environment plates (five angles × three looks) and nine chroma-key crowd clips. **BG-DUSK is retired.** No dusk or night plate is in the set, and no future plate may be dusk or night.

Related docs: `docs/visual-camera-plan.md` (angles and the bag hand-off), `docs/game-rules.md` (singles stand at the same end; 2v2 partners stand at opposite ends), `docs/throwing-controls.md` (aim, pull-back, flick), `docs/led-board-and-bags.md` (Unity-driven board lights). The Unity hookup below is `MatchPresenter` on the prototype branch `claude/cornhole-game-prototype-p9nt6j` (`unity/CornholeGreybox/Assets/Scripts/Unity/MatchPresenter.cs`). That project is not on `main`.

## Status

- Smee approved the current Cornhole plate set on 2026-11-12: 15 daytime environment plates and 9 crowd clips, described below.
- This spec replaces the earlier single-shot approach, in which boards and crowd were authored into every Imagine plate. That approach produced board drift, messy logos, and a crowd that sat too close. It also replaces the dusk camera grade. BG-DUSK and the night camera plates are retired, not replaced with night versions.
- Face Scan desktop hero stills are **done**: `face-scan-hero-desktop-2560x1440.jpg` and `face-scan-hero-desktop-1920x1080.jpg` in the iPlay art folder, upscaled from a 1280-wide Imagine render.
- A 2026-11-10 Face Scan test showed face morphing and a flickering beam on a locked-off still. Environment plates contain no people. Crowd faces stay small in the source clip (about half the earlier on-screen height), then Unity places the keyed layer far back behind the boards.
- Shared Dice and Cornhole hand rig: **approved 2026-11-10, in progress.** Embedded Unity package in iPlay-StreetDice, planned path `unity/Packages/com.iplay.handrig`, branch `cursor/shared-iplay-hand-rig`. Rig PR: https://github.com/unclesme15-a11y/iPlay-StreetDice/pull/3. Cornhole consumes it in https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/4.

## Layers and compositing order

Back to front, during play:

| Order | Layer | Source | Notes |
|---|---|---|---|
| 1 | Environment plate | Imagine still + loop | Empty daytime park. No boards, no people, no hands, no logos, no text. Cookout props only on the right of the lane. A photoreal chalk centerline is the snap line for Unity's boards. |
| 2 | Crowd layer | Imagine chroma-key clips | Keyed off a flat solid chroma-green backdrop and placed **far back, behind the boards**. Idle, cheer, and groan variants swap on this layer only. |
| 3 | Boards | Unity 3D | Unity owns them completely: mesh, logo decals, nameplate, LEDs, hole, rails, scoring. Imagine never generates a board. Boards align to the chalk centerline. |
| 4 | Bags | Unity | Every bag in the air or on a board is a Unity projectile. Imagine never generates a bag. |
| 5 | Hands | `com.iplay.handrig` | Purchased rig, composited over the shot. Imagine never generates a player or thrower hand. |
| 6 | HUD | Unity | Scores, prompts, reduce-motion. |

The environment and the crowd are independent. Swapping the look inside one angle does not move the boards. Changing the crowd reaction does not require regenerating the park or the boards.

## What Imagine generates

Two groups only:

| Group | Class | What it is |
|---|---|---|
| Environment plates | BACKGROUND | Empty daytime park. **5 angles × 3 looks = 15 plates.** Angles: BG, CAM-THROWER, CAM-FAR, CAM-NEIGHBOR, CAM-PARTNER. Looks: GOLDEN, OVERCAST, SUNNY. |
| Crowd layer | AMBIENT / PUNCTUATION | Nine logo-free chroma-key clips: CRD-IDLE-1..3, CRD-CHEER-1..3, CRD-GROAN-1..3. |

Imagine does not generate boards, board logos, bags, the throwing hand, the opponent's body, or a character clip. Video characters in `docs/characters.md` are a later roster and are outside this list.

## What Unity owns

**Boards.** Unity authors and draws every board in every camera. That includes:

- the 2×4 ft slanted mesh (front edge low, back edge raised, 6 inch hole near the raised back)
- the locked look from `docs/art-briefs/reference/board-bags-material-sheet.png` and `docs/art-briefs/02-gpt-session-round2.md`: mirror-gloss black clear-coat deck, brushed-silver graffiti logo with thick gold edges and blue and gold paint splash, brushed dark gunmetal frame with a thin polished gold pinstripe, polished silver hole rim, unlit-in-authoring LED strips, matte nameplate on the front apron
- **logo and nameplate as decals**, so lettering stays sharp from every angle, including the near board seen from the back (logo upside down to the thrower)
- LED animation (idle chase, gold burst on a hole; `docs/led-board-and-bags.md`)
- hole, rails, and scoring

Because the boards are real 3D objects, they do not drift with a video loop, and the logo is never baked into a plate. Unity aligns each board to the photoreal chalk centerline in the environment plate.

**Bags and hands** stay in Unity, as before. The crowd layer is keyed and placed far back behind the boards.

## Rules

### Standing environment rules

Smee, 2026-11-11, still in force on the approved set:

- **Daytime only.** No dusk or night plates. Any future plate is natural daylight.
- **Cookout only on the right.** In every plate the tents, grill, coolers, and chairs sit only on the **right** side of the lane / play area, never on both sides. The left side of the background is trees and open lawn only.
- **Empty of game objects.** No boards, no people, no hands, no logos, no text.
- **Chalk centerline.** A photoreal chalk line, not a CGI overlay, so Unity can snap boards to it. Down-lane angles send the line to the vanishing point at frame center (**x ≈ 640** on a 1280-wide frame). CAM-NEIGHBOR is a side angle: one continuous line, no T-markers. CAM-PARTNER has no marked far pitcher's box (its crossbar is a T-marker, not a box).

### Looks

All three looks are approved. Within one angle the three looks share camera position, centerline, and tent layout, so Unity can swap lighting without moving the boards.

| Look | Light |
|---|---|
| **GOLDEN** | Warm low sun, amber sky, long soft shadows. |
| **OVERCAST** | Grey cloud cover, flat even daylight. |
| **SUNNY** | Bright blue-sky afternoon, soft white clouds. |

**Naming.** On disk, not in git: `environment/<ANGLE>-<LOOK>-still.jpg` and `environment/<ANGLE>-<LOOK>.mp4`. ANGLE is `BG`, `CAM-THROWER`, `CAM-FAR`, `CAM-NEIGHBOR`, or `CAM-PARTNER`. LOOK is `GOLDEN`, `OVERCAST`, or `SUNNY`.

**Alignment (approved stills).** Down-lane centerlines agree across the three looks of an angle to about **1 px**. CAM-NEIGHBOR's line agrees to about **1 px** mid-frame and about **3 px** at the far (right) edge (measured spread 2.7 px at x = 1279). A global edge-map shift, where it exists, is a single 2 px step and does not move the tents off the right side of the lane.

### Length and frame

Length, 16:9, and resolution are **settings**, not words in the prompt. 1080p is not available when a last frame or a keyframe is set. Every official clip is 720p.

**Environment loop recipe** (all 15 loops):

- 1280×720, 16:9
- **8.04 s**, **24 fps**, **193 frames**
- First frame = last frame = the approved still
- One **4 s midpoint keyframe** of that same still, so the chalk line does not wobble mid-clip

**Crowd recipe** (all 9 clips):

- 1280×720, 16:9
- **4.04 s**, **24 fps**, **97 frames**
- First frame = last frame
- Idle loops also pin a **2 s midpoint keyframe** of the idle still
- Cheer and groan pin first and last to the matching idle still and do **not** pin a midpoint, so the mid action can play, then the clip returns to the idle pose for looping

Frame shape for this list is **16:9 landscape**. Do not use 9:16.

### Input mode

| Kind | Still | Video mode |
|---|---|---|
| Environment loop | The approved still for that angle and look | **First+last-frame loop** plus a 4 s midpoint keyframe. First = last = still. |
| A new look of an existing angle | Relight of that angle's own still only | Same loop recipe. Do not use another angle as the reference. |
| Crowd idle | Logo-free group on flat chroma green, at the approved half height | **First+last-frame loop** plus a 2 s midpoint keyframe. |
| Crowd cheer or groan | The matching idle still | **Image-to-video**, first and last pinned to that idle still, no midpoint. The clip returns to idle. |

Check an environment loop by comparing first, mid, and last frames to the still, and by refitting the chalk line. Reject a take if a board, a person, a hand, a logo, or text appears, if the camera moves, if tents cross to the left of the lane, if the line wobbles, or if the light changes mid-clip.

### How each prompt is written

`GenerateImage` has no negative / avoid field and no image-to-image or edit mode. Do not attach old plates that have boards, people, or night lighting: the model will copy them. Do not attach the board material sheet to an environment or crowd prompt. Do not attach a BG still as a "same park" reference for a camera plate; that copies the wide sideline into THROWER, NEIGHBOR, and PARTNER.

1. **Environment still.** Daytime light, a continuous field of closely mowed green grass, the cookout only on the right of the lane, trees and open lawn on the left, and the chalk line for that angle. A "27-foot strip" in the prompt can come out as a contrasting turf path. The lane redo does use a slightly darker mown stripe **plus** a thin chalk centerline; it does not use a turf runner.
2. **A new look.** One reference: the same angle's existing still. Ask for the exact same photograph (camera, lens, framing, horizon, chalk line, mown stripes, tree line, and the tents, grill, coolers, and chairs in the same places on the right). Only the lighting changes.
3. **Environment motion.** Locked-off tripod. The light does not change. Leaves sway, grill smoke drifts, tents on the right ripple slightly, the chalk line stays still and straight. Nothing enters the frame.
4. **Crowd still.** The group on a seamless flat chroma-key green cyclorama, the count and the 3:1 ratio, logo-free clothes, arms down. People are about half the earlier on-screen height, with more green around them.
5. **Crowd motion.** Idle: quiet talking, arms down. Cheer: lean in, mouths open, arms low, then settle back to the start. Groan: sag or bow, heads down, arms down, then settle back to the start. The green backdrop stays uniform.

The look is described in plain words, not house names: Imagine does not know what an "iPlay grade" is and may try to write "iPlay" into the picture.

### Crowd ratio, casting, and hands

Smee locked the ratio on 2026-11-11: **3 women to 1 man**. Groups of 4 are 3 women and 1 man (CRD-*-1 and CRD-*-3). Groups of 8 are 6 women and 2 men (the **-2** clips). Casting otherwise follows the cookout crowd in `docs/visual-camera-plan.md`: mostly curvy adult Black women, then Latina, then white, with men in that 3:1 mix. The approved clips have no kids. Clothes are logo-free (the earlier Nike swoosh on CRD-IDLE-1 is not in the official clips).

Official crowd scale is **double the previous camera distance**: people are about **half** their former on-screen height. Measured on the approved stills: IDLE-1 about 291 px (half of 581), IDLE-2 about 228 px (half of 455), IDLE-3 about 269 px (half of 535), on a 720-tall frame. Imagine, given the closer still as a reference, stayed near 75% of the old height, so the official stills are the logo-free people composited at exact half height onto a seamless flat chroma-green cyc. Unity places that layer far back, behind the boards.

#### Crowd hands

The standing rule is unchanged: **Imagine never generates hands for player or thrower hands.** Those always come from `com.iplay.handrig`.

Crowd clips are a full-body layer, so ordinary hands will appear as part of a distant body (a cup held close, an arm hanging at the side). That is acceptable. Keep them non-prominent:

- no wave, clap, point, or raised hand
- no hand-focused gesture, and no close-up of fingers
- cheers read from leaning in and mouths open, with arms low at the sides
- groans read from a sag, a bow, or heads dropping, not from hands

## Playback and Unity

The environment plate on screen is one angle in the chosen look. Swapping GOLDEN, OVERCAST, and SUNNY inside that angle does not move the boards. The 3D boards, the Unity bag, and the purchased hand are drawn in front of the plate. The keyed crowd sits far behind the boards. `MatchPresenter` is the door (prototype):

| Moment | Call | What the presenter does |
|---|---|---|
| Match opens | `OnMatchOpened` | Load **CAM-THROWER** in the chosen daytime look (GOLDEN, OVERCAST, or SUNNY). Place the **Unity 3D boards** on the chalk centerline (not as invisible colliders stuck to a video board). Show the hand rig, hidden until someone is throwing. Start the crowd layer on a random **CRD-IDLE** loop, keyed and far back behind the boards. |
| Aim, pull, shake | `OnAimChanged(aim, power, shotId, pulling, handShake)` | Drive the purchased hand. The plate stays **CAM-THROWER** in the current look. `handShake` above 1 trembles the rig. The crowd stays on idle. |
| A throw exists | `OnThrowResult` | Play that seat's gesture on the purchased hand. Schedule the camera cut from the rules below. Keep the same look. |
| Bag in the air | `OnReplayFrame` | Move the Unity bag. The Imagine plate has no bag. |
| Hole | `OnCue` with `reason: "hole"` (sound `cornhole_hit`) | Swap the crowd layer to a random **CRD-CHEER** variant. The clip itself returns to the idle pose. Then return the layer to an idle loop. The environment plate and the 3D boards do not cut away. |
| Miss (off the board) | `OnCue` with `reason: "foul"` (sound `ground_thud`) | Swap the crowd layer to a random **CRD-GROAN** variant, then return to idle. |
| Woody (on the board, not in the hole) | `OnCue` with `reason: "landing"` (sound `bag_thud`) | Stay on the camera plate and the idle crowd. No groan. |
| Inning score | `OnScore` | HUD only. It does not pick a plate or a crowd clip. |
| Reduce motion | `OnCue(..., reduceMotion: true)` | Skip the crowd reaction swap. Keep the camera plate and idle crowd. Optionally freeze the environment on its still. |

Camera cuts for one throw pick the environment plate in the **current look**. The 3D boards stay in world space:

- **Local player, and anyone throwing at the far board:** start on **CAM-THROWER** in the current look (or **CAM-NEIGHBOR** in that same look when that plate is the one in use). At **0.33 s** after release, cut to **CAM-FAR** in that look. Hold about **1.2 s** after the bag stops, then return to **CAM-THROWER** in that look. Match Setup can turn the board-cam cut off (default is on; `docs/game-rules.md`). When it is off, stay on the plate that showed the release and let the Unity bag carry the flight.
- **Singles, the player beside you:** **CAM-NEIGHBOR** in the current look for the gesture, then the same 0.33 s cut to **CAM-FAR** in that look, because both players throw at the far board.
- **2v2, your partner at the opposite end:** **CAM-PARTNER** in the current look replaces Neighbor Cut. The purchased hand plays the gesture over the empty far lawn. There is no marked far box in the plate. They throw at your board, so do not cut to **CAM-FAR**. On release, return to **CAM-THROWER** in that look and let the Unity bag come in. The whole partner throw and landing stays inside 15 s.
- **2v2, the opponent beside you:** there is no extra Imagine plate. Their purchased-hand gesture enters from the side of **CAM-THROWER** that is not the local player's side, then **CAM-FAR** at 0.33 s. The plate stays empty of people.

The release the presenter uses is the rig's release, not a frame hunted inside an Imagine clip.

On a camera cut, the crowd layer can stay in world space behind the court (preferred: it does not pop) or be re-anchored to the new plate, still far back behind the boards. Do not let the crowd sit beside the lane or large enough to read faces.

### Unity-side notes

- **Board placement.** Snap the 3D boards to the chalk centerline. Down-lane plates (BG, CAM-THROWER, CAM-FAR, CAM-PARTNER) put the vanishing point at frame center (x ≈ 640 at 1280 wide). CAM-THROWER is a centered down-the-lane lawn: Unity places the near board in the lower left of that empty grass (hole closest to camera, logo upside down from this angle) and the far board down the line. CAM-FAR is a low close view; the line itself is centered, and the "off-axis" read is the camera height. CAM-NEIGHBOR looks across the lane; the line runs from lower right toward mid-left, with no T-markers, and the lower third is empty grass for the rig. CAM-PARTNER looks straight down the lane with empty mid-distance grass and a T-marker, not a painted pitcher's box. Place the partner hand and the far board from the line.
- **Look swap.** GOLDEN, OVERCAST, and SUNNY of one angle are pixel-aligned. Change the light by swapping the plate. Do not re-seat the boards.
- **Logo decals.** Apply the locked deck logo and the nameplate as Unity decals (or equivalent textures on the 3D board). Do not ask Imagine to paint them. Environment plates have no logos and no text.
- **LEDs.** Author the 3D strips dark. Unity animates them at runtime.
- **Keying.** Use a chroma key on the flat green cyc. Soft contact shadows under feet can be kept or keyed softly. Reject a clip whose backdrop is uneven enough to leave a fringe.
- **Crowd scale.** The source clips are already at about half the earlier person height. Place them far back, behind the boards.
- **Looping.** Crossfade plays of an environment loop and of a crowd idle loop. Never play the same cheer or groan twice in a row. After a cheer or groan, return to idle.

### Summary

| ID | Class | Name | Loop or one-shot | Length | Input mode |
|---|---|---|---|---|---|
| BG-GOLDEN | BACKGROUND | Wide park, warm low sun | Seamless loop | 8.04 s | First+last+4 s keyframe |
| BG-OVERCAST | BACKGROUND | Wide park, grey sky | Seamless loop | 8.04 s | First+last+4 s keyframe |
| BG-SUNNY | BACKGROUND | Wide park, blue-sky afternoon | Seamless loop | 8.04 s | First+last+4 s keyframe |
| CAM-THROWER-GOLDEN | BACKGROUND | Thrower View, warm low sun | Seamless loop | 8.04 s | First+last+4 s keyframe |
| CAM-THROWER-OVERCAST | BACKGROUND | Thrower View, grey sky | Seamless loop | 8.04 s | First+last+4 s keyframe |
| CAM-THROWER-SUNNY | BACKGROUND | Thrower View, blue-sky afternoon | Seamless loop | 8.04 s | First+last+4 s keyframe |
| CAM-FAR-GOLDEN | BACKGROUND | Far Board Cam, warm low sun | Seamless loop | 8.04 s | First+last+4 s keyframe |
| CAM-FAR-OVERCAST | BACKGROUND | Far Board Cam, grey sky | Seamless loop | 8.04 s | First+last+4 s keyframe |
| CAM-FAR-SUNNY | BACKGROUND | Far Board Cam, blue-sky afternoon | Seamless loop | 8.04 s | First+last+4 s keyframe |
| CAM-NEIGHBOR-GOLDEN | BACKGROUND | Neighbor Cut, warm low sun | Seamless loop | 8.04 s | First+last+4 s keyframe |
| CAM-NEIGHBOR-OVERCAST | BACKGROUND | Neighbor Cut, grey sky | Seamless loop | 8.04 s | First+last+4 s keyframe |
| CAM-NEIGHBOR-SUNNY | BACKGROUND | Neighbor Cut, blue-sky afternoon | Seamless loop | 8.04 s | First+last+4 s keyframe |
| CAM-PARTNER-GOLDEN | BACKGROUND | Partner shot, warm low sun | Seamless loop | 8.04 s | First+last+4 s keyframe |
| CAM-PARTNER-OVERCAST | BACKGROUND | Partner shot, grey sky | Seamless loop | 8.04 s | First+last+4 s keyframe |
| CAM-PARTNER-SUNNY | BACKGROUND | Partner shot, blue-sky afternoon | Seamless loop | 8.04 s | First+last+4 s keyframe |
| CRD-IDLE-1 | AMBIENT | Crowd idle A, 3W+1M | Seamless loop | 4.04 s | First+last+2 s keyframe |
| CRD-IDLE-2 | AMBIENT | Crowd idle B, 6W+2M | Seamless loop | 4.04 s | First+last+2 s keyframe |
| CRD-IDLE-3 | AMBIENT | Crowd idle C, 3W+1M | Seamless loop | 4.04 s | First+last+2 s keyframe |
| CRD-CHEER-1 | PUNCTUATION | Hole cheer A, from idle 1 | Returns to idle | 4.04 s | First+last = idle still |
| CRD-CHEER-2 | PUNCTUATION | Hole cheer B, from idle 2 | Returns to idle | 4.04 s | First+last = idle still |
| CRD-CHEER-3 | PUNCTUATION | Hole cheer C, from idle 3 | Returns to idle | 4.04 s | First+last = idle still |
| CRD-GROAN-1 | PUNCTUATION | Miss groan A, from idle 1 | Returns to idle | 4.04 s | First+last = idle still |
| CRD-GROAN-2 | PUNCTUATION | Miss groan B, from idle 2 | Returns to idle | 4.04 s | First+last = idle still |
| CRD-GROAN-3 | PUNCTUATION | Miss groan C, from idle 3 | Returns to idle | 4.04 s | First+last = idle still |

The older RX-HOLE, RX-MISS, and RX-AMB IDs are retired. BG-DUSK is retired. The dusk-only IDs CAM-THROWER, CAM-FAR, CAM-NEIGHBOR, and CAM-PARTNER (no look suffix) are retired; each angle now has GOLDEN, OVERCAST, and SUNNY.

### Non-blocking notes

These are recorded on the approved set. They do not block use.

- The GOLDEN camera plates are slightly warmer (more amber) than BG-GOLDEN.
- CAM-THROWER-GOLDEN and CAM-PARTNER-GOLDEN show the sun disc in frame.
- BG uses its own tree line and tent cluster. The CAM angles are a different set (THROWER and PARTNER are more enclosed; NEIGHBOR has the tents closer on the right). Within one angle, the three looks match.

## 1. Environment plates

Fifteen approved plates. Same five angles, three daytime looks. Files are named `environment/<ANGLE>-<LOOK>-still.jpg` and `environment/<ANGLE>-<LOOK>.mp4`.

| Angle \ Look | GOLDEN | OVERCAST | SUNNY |
|---|---|---|---|
| BG (down-lane wide) | BG-GOLDEN | BG-OVERCAST | BG-SUNNY |
| CAM-THROWER | CAM-THROWER-GOLDEN | CAM-THROWER-OVERCAST | CAM-THROWER-SUNNY |
| CAM-FAR | CAM-FAR-GOLDEN | CAM-FAR-OVERCAST | CAM-FAR-SUNNY |
| CAM-NEIGHBOR | CAM-NEIGHBOR-GOLDEN | CAM-NEIGHBOR-OVERCAST | CAM-NEIGHBOR-SUNNY |
| CAM-PARTNER | CAM-PARTNER-GOLDEN | CAM-PARTNER-OVERCAST | CAM-PARTNER-SUNNY |

Shared acceptance for every environment plate: daytime; tents, grill, coolers, and chairs only on the right of the lane; left background is trees and open lawn; no boards, people, hands, logos, or text; chalk line present and stable through the loop; 1280×720, 8.04 s, 24 fps, 193 frames; first = last = still.

**Relight prompt** for a new look of an angle that already has a still. Use only that angle's still as the reference. Swap the look sentence.

```text
The exact same photograph as the reference image, with identical camera position, lens, framing and horizon height; the same white chalk centerline and crossbar in exactly the same place; the same mown stripes, the same tree line, and the same white, royal-blue and magenta canopy tents, kettle grill with smoke, coolers and empty chairs in exactly the same positions on the right side of the lawn. Only the lighting changes:
```

For NEIGHBOR, say "continuous white chalk line running diagonally" and do not ask for a crossbar. For BG, say the darker mown stripe, the near-end chalk T-bar, and the tent cluster just right of the centerline.

Look sentences:

```text
GOLDEN:   summer evening golden hour, warm low sun glowing through the trees, warm amber and pale peach sky, long soft warm shadows across the grass, golden rim light on the tents. Empty lawn, no people, photorealistic
OVERCAST: soft overcast grey sky with full even cloud cover, flat diffuse daylight, no hard shadows, slightly muted colors. Empty lawn, no people, photorealistic
SUNNY:    bright sunny summer afternoon, clear blue sky with a few soft white clouds, crisp natural sunlight and shadows, vivid green grass. Empty lawn, no people, photorealistic
```

**Loop prompt** (swap the look words):

```text
Locked-off static tripod shot of an empty park lawn at <look>. The camera does not move and the light does not change. Gentle ambient motion only: leaves sway softly in the far trees, thin smoke drifts slowly up from the kettle grill, canopy tents on the right ripple very slightly in a light breeze, grass barely stirs. The white chalk line stays perfectly still and straight. No people, no objects enter the frame.
```

Settings: `image_path` = `last_frame_path` = the still, a 4 s keyframe of the same still, 8 s, 16:9, 720p.

### BG

- **IDs:** BG-GOLDEN, BG-OVERCAST, BG-SUNNY
- **Type:** BACKGROUND
- **Purpose:** Wide down-lane view of the empty park. BG-GOLDEN and BG-OVERCAST are the lane-line originals. BG-SUNNY is a relight of BG-OVERCAST. This is the environment bed, not a throw camera. BG-DUSK is retired.
- **Framing and camera:** Chest-height tripod, looking along the lawn into the middle distance. A darker mown stripe plus a thin pale chalk centerline and a near-end T-bar. The chalk starts at the T-bar, not at the very bottom edge. The line's far end is at frame center (x ≈ 640). Tents, grill, coolers, and chairs sit just right of the line. Left background is trees and open lawn. BG keeps its own tree line and tent cluster, including small teal and magenta accent lights, and it is not a surveyed match of the CAM angles.
- **Length target:** 8.04 s, 24 fps, 193 frames, 1280×720.
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop plus a 4 s midpoint keyframe.
- **Unity hookup:** Optional wide environment bed in the chosen look. It is not a throw camera. The hand rig is not parented to this plate. 3D boards, if shown, sit on the chalk line.

### CAM-THROWER

- **IDs:** CAM-THROWER-GOLDEN, CAM-THROWER-OVERCAST, CAM-THROWER-SUNNY
- **Type:** BACKGROUND
- **Purpose:** First-person view while the local player aims and releases, and the view that shows a bag arriving at your own board. The plate is empty grass. Unity places both boards on the chalk line. CAM-THROWER-SUNNY is the daytime original; GOLDEN and OVERCAST are relights of it.
- **Framing and camera:** Standing eye height, about 5 feet, 28mm, looking straight down the lane. A large expanse of empty grass fills the bottom half. One thin pale chalk line runs from the bottom center to the far end at frame center, with a short chalk T-mark near the bottom and a slightly darker mown stripe along the line. Cookout props are small at the far end, all to the right of the line (leftmost tent edge near x ≈ 950). Left background is trees only.
- **Length target:** 8.04 s. One play covers release → 0.33 s cut → flight → slide → 1.2 s hold.
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop plus a 4 s midpoint keyframe.
- **Still prompt** (SUNNY original, text only, no reference):

```text
Photorealistic first-person view from a static tripod at standing eye height, about five feet off the ground, 28mm wide lens, the camera standing at one end of a long empty park lawn and looking straight down its length as if down a 27-foot playing lane. Bright natural summer daylight, late afternoon sun, clear blue sky with a few soft white clouds, crisp natural shadows. A large expanse of empty closely mowed green grass fills the entire bottom half of the frame. Running dead straight from the bottom center of the frame to the far end of the lawn at the exact horizontal center of the image is one thin pale white chalk line painted on the grass, with a short chalk crossbar T-mark near the bottom. A slightly darker mown stripe runs along the chalk line. The left half of the far background is only a line of mature leafy green trees and open grass. Only on the right side of the far background, small in the distance, to the right of the chalk line, an unoccupied summer cookout of white, royal-blue, and magenta pop-up canopy tents, a smoking black kettle charcoal grill with a soft plume of grey smoke, unattended blue and red coolers and empty folding chairs. Empty lawn, nothing on the grass, photographic realism
```

- **Unity hookup:** Default gameplay plate from `OnMatchOpened` and `OnAimChanged`, in the chosen look. Place the near 3D board in the lower-left grass and the far 3D board down the line. Local release starts here. `OnReplayFrame` draws the bag leaving the rig toward the far board. At 0.33 s, cut to CAM-FAR of the same look when the board-cam setting is on. The hand is the purchased rig along the bottom, clear of the near hole: bottom-right for a right-handed player, bottom-left when mirrored.

### CAM-FAR

- **IDs:** CAM-FAR-GOLDEN, CAM-FAR-OVERCAST, CAM-FAR-SUNNY
- **Type:** BACKGROUND
- **Purpose:** Close view of the far board so the landing is easy to read. The board is Unity 3D. Used only for bags thrown at the far board. CAM-FAR-SUNNY is the daytime original; the other two looks are relights.
- **Framing and camera:** Knee height, slightly off-axis, 50mm, shallow depth of field. The lower half is empty close grass. A bright chalk line runs from bottom center to the horizon at frame center, with a short T-marker in the mid-ground. Tents are soft and entirely right of the line (white tent left edge near x ≈ 790). Left background is trees only. The line is centered; "off-axis" is the low camera, not a shifted lane.
- **Length target:** 8.04 s. The on-screen stay is shorter: from 0.33 s after release through about 1.2 s after the bag stops.
- **Loop or one-shot:** Seamless loop. Unity cuts into the loop; it does not play a staged landing.
- **Input mode:** First+last-frame loop plus a 4 s midpoint keyframe.
- **Still prompt** (SUNNY original, text only):

```text
Photorealistic low shot from a static tripod at knee height, slightly off-axis to one side, in a big open city park in bright natural summer daylight, clear blue sky with soft white clouds. The entire lower half of the frame is a close view of closely mowed green grass, uniform in color and height, empty, flat, and clear. One bright white chalk line painted on the grass runs dead straight from the bottom center of the frame away from the camera toward the horizon at the exact horizontal center of the image, with a short chalk crossbar T-marker in the mid-ground. Softly out of focus in the background: mature leafy green trees, and only on the right side of the frame, to the right of the chalk line, an unoccupied summer cookout with white, royal-blue, and magenta pop-up canopy tents, a smoking black kettle charcoal grill with soft grey smoke, unattended blue and red coolers, empty folding chairs. The left background is only trees and lawn. Shallow depth of field, 50mm lens, sunlit, empty foreground, photographic realism
```

- **Unity hookup:** `OnThrowResult` schedules the cut to this plate, same look, at **0.33 s** after release for the local player, the singles neighbor, and the 2v2 opponent who shares your end. Place the far 3D board on the line in the lower half, deck toward camera, hole clear. `OnReplayFrame` drops the Unity bag onto this board. Do not use this plate for the 2v2 partner. After the 1.2 s hold, return to CAM-THROWER of the same look.

### CAM-NEIGHBOR

- **IDs:** CAM-NEIGHBOR-GOLDEN, CAM-NEIGHBOR-OVERCAST, CAM-NEIGHBOR-SUNNY
- **Type:** BACKGROUND
- **Purpose:** Singles only. The player beside you, one on each side of your board (`docs/game-rules.md`). The person the player sees is the purchased Unity hand, not an Imagine person. CAM-NEIGHBOR-SUNNY is the daytime original; the other two looks are relights.
- **Framing and camera:** Standing eye height, 35mm, beside the lane, looking across it at an angle, not straight down it. One continuous thin chalk line runs from the lower right (about x 1279, y 686 on the SUNNY still) toward the mid-left (about x 118, y 412), slope about 0.235. **No T-markers and no crossbars.** Tents, grill, coolers, and chairs sit on the right half, on the far side of the line, larger and closer than on the down-lane plates. Left background is trees and open lawn. The lower third is plain empty grass for the rig.
- **Length target:** 8.04 s, covering one throw and the cut to the landing.
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop plus a 4 s midpoint keyframe.
- **Still prompt** (SUNNY original, text only):

```text
Photorealistic closer side-on view from a static tripod at standing eye height, 35mm lens, the camera standing beside a long playing lane on a park lawn and looking across it at an angle, not straight down it. Bright natural summer daylight, clear blue sky with soft white clouds, sunlit closely mowed green grass with natural shadows. One continuous thin bright white chalk line painted on the grass runs dead straight diagonally from the lower right of the frame toward the middle left, receding into the distance, with no crossbars. The lower third of the frame is plain empty grass. Mid-background on the right side of the frame, not huge, an unoccupied summer cookout of white, royal-blue, and magenta pop-up canopy tents, a smoking black kettle charcoal grill with soft grey smoke, unattended blue and red coolers and empty folding chairs. The left background is only mature leafy green trees and open lawn. Empty lawn, nothing on the grass, photographic realism
```

- **Unity hookup:** In singles, `OnThrowResult` for the other seat shows the purchased hand in this framing, same look, same gestures as the local throw, with the bag prop. At 0.33 s after that release, cut to CAM-FAR of the same look. In 2v2 this plate is not used; CAM-PARTNER of the same look replaces it.

### CAM-PARTNER

- **IDs:** CAM-PARTNER-GOLDEN, CAM-PARTNER-OVERCAST, CAM-PARTNER-SUNNY
- **Type:** BACKGROUND
- **Purpose:** 2v2 only. Replaces Neighbor Cut. A straight-on view down the lane toward where the partner throws. The throwing hand is the purchased Unity hand. There is **no marked opposite pitcher's box**. The far board is a Unity 3D board placed from the chalk line. CAM-PARTNER-SUNNY is the daytime original; the other two looks are relights.
- **Framing and camera:** Standing eye height, 35mm, straight down the lawn. The lower two thirds are empty grass. One thin chalk line runs from bottom center to the far end at frame center, with a short crossbar in the middle distance. That crossbar is a T-marker, not a box. Tents at the far end are only on the right of the line (white tent left edge near x ≈ 955). Left background is trees and open lawn across the width behind them. This replaces the night plate that had tents on both sides.
- **Length target:** 8.04 s. The gesture and the return to Thrower View fit inside 15 s.
- **Loop or one-shot:** Seamless loop.
- **Input mode:** First+last-frame loop plus a 4 s midpoint keyframe.
- **Still prompt** (SUNNY original, text only):

```text
Photorealistic straight-on shot from a static tripod at standing eye height, 35mm lens, looking straight down a long stretch of empty closely mowed green grass in a big open city park as if down a 27-foot playing lane. Bright natural summer daylight, clear blue sky with soft white clouds, sunlit lawn, natural shadows. The lower two thirds of the frame are a large expanse of plain empty grass with a uniform color. One thin pale white chalk line is painted dead straight on the grass from the bottom center of the frame to the far end of the lawn at the exact horizontal center of the image, with a short chalk crossbar near the middle distance. In the far background a line of mature leafy green trees across the whole width. Only on the right side of the far background, entirely to the right of the chalk line, small in frame, an unoccupied summer cookout of white, royal-blue, and magenta pop-up canopy tents, a smoking black kettle charcoal grill with soft grey smoke, unattended blue and red coolers and empty folding chairs. The left side of the background is only trees and open lawn. Empty lawn, nothing on the grass, photographic realism
```

- **Unity hookup:** In 2v2, when the partner at the other end throws, `OnThrowResult` plays the purchased hand over the empty mid-distance grass, same look. Place the far 3D board from the chalk line, not in a painted box. On release, cut back to CAM-THROWER of the same look and let `OnReplayFrame` land the bag on your board. Do not cut to CAM-FAR for this throw.

## 2. Crowd layer

Nine approved clips. Cookout spectators on a flat solid chroma-green backdrop, keyed and placed far back in Unity, behind the boards. Three idle loops, three hole cheers, and three miss groans. Each reaction uses the matching idle group's still, so costumes stay consistent. All nine are logo-free.

Files: `crowd/<ID>-still.jpg` for the three idles, and `crowd/<ID>.mp4` for all nine. 1280×720, 4.04 s, 24 fps, 97 frames. People are about half the former on-screen height (double the previous camera distance), with more green around the group.

Shared still language: seamless chroma-key green cyclorama for both the backdrop and the floor, even soft studio lighting, no park, no sky, no grass, no props, no furniture, full-body, logo-free casual summer clothes, drinks held close to the body, arms down or comfortably bent at the elbow, no raised arms, no waving, no pointing, no clapping.

### CRD-IDLE-1

- **ID:** CRD-IDLE-1
- **Type:** AMBIENT
- **Purpose:** Default far-back crowd, group A. Four people, 3 women and 1 man, chatting. Logo-free (plain shorts, no swoosh): black tank, maroon tank, olive tank, grey tee.
- **Framing and camera:** Full-body, locked off, group at about 291 px tall on the 720-tall frame, green filling most of the frame.
- **Length target:** 4.04 s, 24 fps, 97 frames.
- **Loop or one-shot:** Seamless loop. First = last = still, plus a 2 s midpoint keyframe.
- **Input mode:** First+last-frame loop from the half-height still.
- **Still prompt:**

```text
Photorealistic full-body studio shot of four adult cookout spectators standing together on a seamless chroma-key green cyclorama, the people only about half as tall in frame as a medium group shot, with a large amount of flat green around them. The entire background and the floor are a smooth uniform bright chroma-key green, even soft studio lighting, no park, no sky, no grass, no props, no furniture. Exactly three adult women and one adult man: a curvy Black woman, a curvy Latina woman, a curvy white woman, and one Black man, all in casual summer clothes with no logos and no text, shorts and tank tops or tees. They stand in a loose cluster chatting, relaxed, weight shifted, drinks held close to their bodies, arms down or comfortably bent at the elbow, no raised arms, no waving, no pointing, no clapping. Faces small, not close-ups.
```

- **Motion prompt:**

```text
Static locked-off camera. The four people stay in place on the green backdrop and talk quietly among themselves, shifting their weight slightly and sipping drinks. Arms stay down or comfortably bent at the elbow. Nobody raises a hand, waves, points, or claps. The green backdrop stays perfectly uniform and still.
```

- **Acceptance:** Count and ratio stay 3 women and 1 man. No logos or text. Height stays near half the old medium shot. Backdrop stays a clean, even green. First and last match the still. Mid-clip motion is ordinary talking. Hands stay non-prominent.
- **Unity hookup:** Default crowd layer while idle. Crossfade plays of this loop with the other idle variants, never the same one twice in a row, and never during a cheer or groan. Key and place far back, behind the boards.

### CRD-IDLE-2

- **ID:** CRD-IDLE-2
- **Type:** AMBIENT
- **Purpose:** Default far-back crowd, group B. Eight people in two loose clusters, **6 women and 2 men**. About 228 px tall.
- **Framing and camera:** Wider full-body studio shot, still small in the frame, more green around them.
- **Length target:** 4.04 s.
- **Loop or one-shot:** Seamless loop. First = last = still, plus a 2 s midpoint keyframe.
- **Input mode:** First+last-frame loop from the half-height still.
- **Still prompt:**

```text
Photorealistic wide full-body studio shot of eight adult cookout spectators standing on a seamless chroma-key green cyclorama, the people only about half as tall in frame as a medium group shot, with a large amount of flat green around them. The entire background and the floor are a smooth uniform bright chroma-key green, even soft studio lighting, no park, no sky, no grass, no props, no furniture. The group is arranged as two loose clusters. Exactly six adult women and two adult men: mostly curvy Black women with Latina and white women mixed in, and two men, all in casual summer clothes with no logos and no text. They chat among themselves, relaxed, drinks held close to their bodies, arms down or comfortably bent at the elbow, no raised arms, no waving, no pointing, no clapping. Faces small, not close-ups.
```

- **Motion prompt:** same as CRD-IDLE-1, with "eight people" and "two loose clusters."
- **Acceptance:** Count and ratio stay 6 women and 2 men. Otherwise the same as CRD-IDLE-1.
- **Unity hookup:** Same idle pool as CRD-IDLE-1.

### CRD-IDLE-3

- **ID:** CRD-IDLE-3
- **Type:** AMBIENT
- **Purpose:** Default far-back crowd, group C. Four people in a staggered line, 3 women and 1 man, different clothes from group A (yellow tank, black tank, denim overalls, sage tee). About 269 px tall.
- **Framing and camera:** Full-body studio shot, small in the frame.
- **Length target:** 4.04 s.
- **Loop or one-shot:** Seamless loop. First = last = still, plus a 2 s midpoint keyframe.
- **Input mode:** First+last-frame loop from the half-height still.
- **Still prompt:**

```text
Photorealistic full-body studio shot of four adult cookout spectators standing in a staggered loose line on a seamless chroma-key green cyclorama, the people only about half as tall in frame as a medium group shot, with a large amount of flat green around them. The entire background and the floor are a smooth uniform bright chroma-key green, even soft studio lighting, no park, no sky, no grass, no props, no furniture. Exactly three adult women and one adult man at the end of the line: a curvy Black woman in a yellow top, a curvy Latina woman in a black tank, a curvy white woman in a denim outfit, and one man in a summer tee, casual cookout clothes with no logos and no text. They stand relaxed and talking, drinks held close, arms down or comfortably bent at the elbow, no raised arms, no waving, no pointing, no clapping. Faces small, not close-ups.
```

- **Motion prompt:** same as CRD-IDLE-1.
- **Acceptance:** Same as CRD-IDLE-1.
- **Unity hookup:** Same idle pool as CRD-IDLE-1.

### CRD-CHEER-1 / CRD-CHEER-2 / CRD-CHEER-3

- **IDs:** CRD-CHEER-1, CRD-CHEER-2, CRD-CHEER-3
- **Type:** PUNCTUATION
- **Purpose:** Crowd cheer when a bag goes in the hole. Variants use idle groups 1, 2, and 3 so costumes match. The clip returns to the idle pose so it can loop. CHEER-2 is 6W+2M. CHEER-1 and CHEER-3 are 3W+1M.
- **Framing and camera:** Same frame as the matching idle still. Backdrop stays green. People stay in place and at the far scale.
- **Length target:** 4.04 s.
- **Loop or one-shot:** Returns to idle. First = last = the idle still. No midpoint keyframe, so the mid cheer can play.
- **Input mode:** Image-to-video from the matching half-height idle still, both ends pinned.
- **Motion prompts:**

CRD-CHEER-1:

```text
Static locked-off camera. The four people stay in place on the green backdrop. They lean in and cheer with their arms low at their sides, mouths open, then settle back to the starting pose. Nobody raises a hand above the shoulder, waves, points, or claps. The green backdrop stays perfectly uniform and still.
```

CRD-CHEER-2: the same, with "eight people" and "two loose clusters."

CRD-CHEER-3:

```text
Static locked-off camera. The four people stay in place on the green backdrop. They turn slightly as if watching a game down the lane, the energy lifts, they cheer with their arms low at their sides, then settle back to the starting pose. Nobody raises a hand above the shoulder, waves, points, or claps. The green backdrop stays perfectly uniform and still.
```

- **Acceptance:** Count and ratio stay correct. No logos. Backdrop stays clean green. The middle reads as a cheer. Arms stay low. First and last match the idle still. The approved CHEER-3 reads more as a squat than an upright cheer; arms stay low.
- **Unity hookup:** `OnCue` reason `hole`. Pick among the three cheers, skipping the one just played. Then return the crowd layer to idle. Skip the swap when `reduceMotion` is true. The environment plate and the 3D boards do not cut away.

### CRD-GROAN-1 / CRD-GROAN-2 / CRD-GROAN-3

- **IDs:** CRD-GROAN-1, CRD-GROAN-2, CRD-GROAN-3
- **Type:** PUNCTUATION
- **Purpose:** A groan when the bag misses the board. Variants use idle groups 1, 2, and 3. The clip returns to the idle pose. GROAN-2 is 6W+2M. GROAN-1 is a strong synchronized bow. GROAN-2 and GROAN-3 are milder.
- **Framing and camera:** Same frame as the matching idle still.
- **Length target:** 4.04 s.
- **Loop or one-shot:** Returns to idle. First = last = the idle still. No midpoint keyframe.
- **Input mode:** Image-to-video from the matching half-height idle still, both ends pinned.
- **Motion prompts:**

CRD-GROAN-1:

```text
Static locked-off camera. The four people stay in place on the green backdrop. They sag into a short synchronized groan, heads drop, then they settle back to the starting pose. Arms stay down or comfortably bent at the elbow. Nobody raises a hand, waves, points, or claps. The green backdrop stays perfectly uniform and still.
```

CRD-GROAN-2:

```text
Static locked-off camera. The eight people stay in place on the green backdrop, in two loose clusters. This is a disappointed reaction to a missed throw, not a laugh or a cheer. They wince, shoulders sag, heads drop, faces show disappointment, then they settle back to the starting pose. Arms stay down or comfortably bent at the elbow holding drinks. Nobody raises a hand, waves, points, claps, or smiles widely. The green backdrop stays perfectly uniform and still.
```

CRD-GROAN-3:

```text
Static locked-off camera. The four people stay in place on the green backdrop. A short disappointed murmur moves through the group, heads dip, then they settle back to the starting pose. Arms stay down or comfortably bent at the elbow. Nobody raises a hand, waves, points, or claps. The green backdrop stays perfectly uniform and still.
```

- **Acceptance:** Count and ratio stay correct. No logos. Backdrop stays clean green. The middle reads as a miss, not a cheer. Hands stay non-prominent. First and last match the idle still.
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

## When regenerating

The 15 environment plates and 9 crowd clips are already approved. Do not regenerate them unless a plate is rejected later. Do not commit generated media to git. Do not paint a board, a person, a hand, or a CGI chalk line onto a frame and keep it. fal stays frozen.

If a plate has to be replaced:

1. Stay in daytime. Keep tents, grill, coolers, and chairs on the right only. Keep the chalk line for that angle. Relight from that angle's own still when only the look changes.
2. Environment loops use the 8.04 s / 24 fps / 193-frame recipe, first = last = still, plus a 4 s midpoint keyframe.
3. Crowd stays logo-free, 3:1 (6W+2M on the -2 clips), at about half the former height, 4.04 s. Idle pins a 2 s keyframe. Cheer and groan pin both ends to the idle still and return to that pose.
4. Wire playback through `MatchPresenter`: 3D boards with decals snapped to the chalk line, crowd keyed and far back behind the boards, hands from `com.iplay.handrig`. The prototype consumes the package in https://github.com/unclesme15-a11y/iPlay-Cornhole/pull/4 (package PR https://github.com/unclesme15-a11y/iPlay-StreetDice/pull/3).

The generation log for this set is on disk under the plates-v2 folder (not in git). The previous baked-together plates remain in `/workspace/iplay-art/cornhole/plates/` and were not moved.

## Needs Sme

- **Plate set.** Approved 2026-11-12. The fifteen daytime environment plates and the nine crowd clips above are the current set. BG-DUSK is retired.
- **Board look on the 3D model.** Logos are Unity decals, so Imagine plates do not carry them. The material sheet and the locked brief (`docs/art-briefs/02-gpt-session-round2.md`) still disagree on three Unity-side items that do not affect plates: (1) the sheet's bags carry the "iPLAY" wordmark, but the brief locked the i-and-play-button mark only, no words; (2) the yellow bag's suede underside is black in the sheet, but the brief says the same color as the front; (3) the sheet's nameplate shows the play button replacing the P, but the brief locked the play button inside the P. The Unity bag textures and the final nameplate art still need Sme's pick.
- **Purchased Unity hand asset (product name / laptop verification).** OPEN. The package is `com.iplay.handrig`. The hand maps to `Resources/FirstPersonHands/FirstPersonHand_L` and `Resources/FirstPersonHands/FirstPersonHand_R`. The product name of the purchased asset, and laptop verification of the prefabs, are still open. Also confirm that this asset is the one that plays the Dice gesture set (throw, catch, plant, tap, wave) Cornhole will reuse.
