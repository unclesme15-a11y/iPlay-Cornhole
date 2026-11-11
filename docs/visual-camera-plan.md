# Visual And Camera Plan

> **Hands:** All hands come from the shared Unity hand rig (`com.iplay.handrig`), composited over Imagine footage. Imagine never generates hands.

## The Idea In One Line

The place is real video. The players, the bags, the board hit areas, and the score are Unity. The server decides what counts.

(Changed November 2026: players used to be Kling video clips. They are now 3D iPlay characters, so a player's scanned face can appear in the game. See `face-scan.md`.)

This is close to the Street Dice split. There, Kling makes the bodega and Unity owns the dice. Here, Kling makes the park cookout and its far-off crowd, and Unity owns the players and the bags.

## Camera Setups (Plates)

Every setup is a **locked Kling plate**: one approved still frame of the empty scene, with the pitcher's boxes left clear. Unity places the 3D characters in those boxes and the Unity boards stay lined up.

| # | Name | What you see | When it's used |
|---|------|--------------|----------------|
| 1 | **Thrower View** | First person from your pitcher's box, looking down the lane at the far board, about 27 ft away. **Your own board is visible in the lower part of the frame, right in front of you.** Your hand holding a bag comes in from the bottom-right edge (bottom-left for lefties), so it doesn't cover your board. | Aiming and releasing. Also where you watch far-end players throw at the board right in front of you. No cut needed for that. |
| 2 | **Far Board Cam** | Close-up of the far board, low and slightly to the side. **On by default.** | Only for bags thrown at the **far** board: yours, and your neighbor's. |
| 3 | **Neighbor Cut** | Short side angle of the player sharing your end, on the other side of the board. | When the player beside you throws. In singles this is **always** how you see your opponent, because official singles has both players at the same end. |

Every plate has a matching **invisible Unity board**, meaning a collider plus a hole trigger, placed so it sits exactly on the video board. Bags hit the invisible board, but it looks like they hit the real one in the video.

## Hand-Off Moment (Simpler Now)

Because Unity draws the characters, the bag never has to jump from a video into Unity.

1. The character plays `stepup` then `throw`.
2. The throw animation has a **release event** at the moment the hand opens. The bag is attached to the hand bone until then.
3. At the release event, the bag detaches and flies along the path the server returned.
4. The animation finishes its follow-through, then plays a **reaction** chosen by the result.

One throw animation still covers every outcome. The animation only shows the throw. Unity and the server decide whether it's a cornhole, a woody, or a miss. Tune the throw's arm speed a little to the server's power value so a soft lob doesn't look like a hard slide.

## Characters On The Video

- Place each character's feet on the plate's grass at the pitcher's box, using the same ground plane as the invisible boards.
- Match the plate's light: sun direction, warm fill, and a soft contact shadow under the feet so nobody floats.
- Apply the plate's colour grade to the characters.
- Far-end characters are small on screen (about 27 ft away). The **Neighbor Cut** is the closest shot of a character, so judge the look there.

## Moments That Show Faces

At 27 ft a face is small, so build in a few moments where players actually see each other:

- **Walk-up intro** before the coin toss: a short close shot of each player's character, with name and team colour.
- **Neighbor Cut**: the player beside you is seen from the side, close enough to read their face.
- **Cornhole celebration**: on a +3, a quick close cut of the thrower's character reacting, then back to Thrower View. Woodies and misses stay on the normal view.

A player who did not share their face appears in all of these as their roster character.

## Local Player Throw Flow

1. **Thrower View**: your hand holds the bag at the bottom of the screen (same idea as the Street Dice hand rig).
2. Drag down to wind up. The pull length sets power, and the angle sets aim. A small arc meter shows a flat slide versus a high lob.
3. Let go: the hand swings forward and the bag leaves the screen heading down-lane.
4. About 0.3 s into the flight, **cut to Far Board Cam**. The bag drops into frame and lands, slides, or goes in the hole.
5. Hold for about 1.2 s after it stops, show the result tag (`+3 CORNHOLE`, `WOODY`, `OFF`), then cut back to Thrower View.

Board cam is **on by default**. A **"Stay on me"** setting turns it off for players who'd rather watch the full flight.

## Opponent Throw Flow

- **Far-end players (2v2 only, throwing at you):** stays on Thrower View the whole time. They step up and throw, and the bag flies toward you and lands on the board right in front of you. No camera cut. Then their reaction plays.
- **Neighbor opponent (same end as you):** cut to the **Neighbor Cut** angle and play their throw, then at release cut to **Far Board Cam** for the landing, same as your own throws.

## Bag Visuals

- Each team picks its own bag color from the palette below (see **Bag Color Pick**).
- Soft cloth-like mesh with a small wobble while flying. Bags squash and settle on landing.
- Contact shadow on the board so bags don't look like they're floating on the video.
- **Hole masking:** the hole on each invisible board has a depth mask, so a bag going in really disappears into the video's hole.
- Bags stay on the board for the whole inning (they block and stack), and they're cleared with a quick sweep at the end of the inning.

## Bag Color Pick

Right after Match Setup, every team picks a bag color. **First come, first served.**

- When a team picks a color, it's locked for that match. It goes grey on everyone else's screen with the team's name on it ("Taken by Team A").
- Two teams can never have the same color.
- In 2v2, whichever partner taps first picks for the team, and the other partner sees it right away.
- Bot teams pick **last**, from whatever colors are left.
- 15-second timer. If a team doesn't pick in time, it gets a random free color.

**Palette (12 colors, chosen so no two are easy to mix up on a wood board from 27 ft):**

| Color | Hex |
|-------|-----|
| Black | `#1B1B1B` |
| White | `#F4F4F2` |
| Red | `#C8102E` |
| Orange | `#FF6A13` |
| Yellow | `#FFD100` |
| Kelly Green | `#009A44` |
| Royal Blue | `#1D4ED8` |
| Sky Blue | `#6CC5F0` |
| Purple | `#6B2C91` |
| Hot Pink | `#E0218A` |
| Teal | `#00A5A8` |
| Maroon | `#6D1A2A` |

- On top of the color, each team's bags get a small iPlay stitch pattern (team A plain, team B with a stitched X). That way color-blind players can still tell whose bag is whose.
- The HUD bag counters and the score bar use each team's chosen color.

## HUD

```text
[ Team A 14  |  inning 7  |  Team B 9 ]
[ Bags left:  ■ ■ □ □      ■ ■ ■ □  ]
[ This inning: +4 vs +1 -> Team A +3 ]
```

- Tutorial mode explains cancellation scoring live, using the actual inning's numbers.
- Mic rings on each seat's name tag for voice chat. The tag shows a small portrait of that player's character.

## Environment Look (Locked Direction)

**Scene 1: big open park, summertime hood BBQ cookout.**

- Wide open green park in full summer afternoon sun. The cornhole lane is on flat, trimmed grass with plenty of open space around it.
- Cookout life in the **background only**: grills smoking, pop-up tents, folding tables, coolers, a speaker, string lights or balloons on the tents.
- A **big, female-heavy crowd** off in the distance: mostly Black women, then Latina, then white. Curvy, thick-figured adults in summer cookout outfits (sundresses, shorts, tank tops, sandals), hanging out, dancing, and watching the game. Some men mixed in, but mostly women.
- The crowd stays **behind and to the sides** of the boards, never between them. The lane has to stay clear and readable.
- Background people are slightly soft-focus so the boards and the throwing players stand out.
- No logos, no brand names, no readable text.

## Background Life (Keep It Random)

The background should look like a real cookout that happens to be going on while you play. Nobody in the crowd is performing for the camera, and nobody is doing the same thing at the same time.

**What's going on out there, loosely mixed:**
- Mostly **regular conversation**: small groups standing and talking, somebody laughing hard, someone telling a story with their hands, people eating off paper plates.
- **Little kids running and playing in the distance**: chasing each other, a ball getting kicked around, a kid on a scooter. Always far away and never near the lane.
- **People walking by**: someone carrying a cooler or a tray of food past the tents, a couple strolling across the far background, somebody coming back from the grill.
- Now and then **one person** glances at their phone, takes a quick selfie, or holds it up for a second. That's it. Phones are seasoning, not the meal.

**Rules that keep it from looking fake:**
- **No checklist prompts.** Listing every action makes Kling put all of them front and center at once, and that's what makes it look staged (probably what went wrong with the Codex prompts). Describe the vibe, mention one or two small details, and let the model fill in the rest.
- **At most one or two phones** in any shot. Some shots have none.
- **Nobody stares into the camera** or poses.
- **Not everybody watches the game.** Most people are into their own conversations. Only the few people closest to the lane even look over.

**How the game plays it (randomness):**
- Make **3-4 long background takes** (8-10 s each) from the same locked Plate 1, all with different random life in them.
- Unity picks the next take **at random** and never plays the same take twice in a row, crossfading between them. The background never runs on an obvious loop.
- On a **cornhole** only, a short "nearby reaction" take can play where the handful of people closest to the lane react ("ayy!", a clap, maybe one person who happened to be filming). The rest of the crowd keeps doing their own thing. For woodies and misses, the background doesn't change at all.

**Sound:**
- A long ambient audio bed: overlapping chatter you can't quite make out, music from a speaker far off, grill sizzle, a breeze.
- Random one-shots at random times: a laugh, a kid yelling far away, "you want a plate?", a car horn, a dog bark. Unity fires them on random timers so no two minutes sound the same.

Later scenes (after this one is locked): backyard, rooftop, beach.
