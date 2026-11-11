# Characters (First Build)

> **Hands:** All hands come from the shared Unity hand rig (`com.iplay.handrig`), composited over Imagine footage. Imagine never generates hands.

> **Changed November 2026:** characters are **3D iPlay characters** drawn by Unity, not Kling video clips. This is what lets a player's scanned face appear in the game. See `face-scan.md`.

Every player in a match is a 3D character:

- **Scanned players** play as their own iPlay character (their face, their choices). Same character they use in iPlay Slap.
- **Everyone else** (bots, and humans who skip the scan) uses one of the **8 roster characters** below.

## Roster: 4 Men And 4 Women, Ages 30-50

Same people as before, now built as 3D presets with made-up faces. The names are placeholders and can be changed.

### Women

| Name | Age | Look | Summer outfit | Throw style / personality |
|------|-----|------|---------------|---------------------------|
| **Keisha** | 34 | Black woman, curvy, long braids pulled up | Bright yellow sundress, white sneakers, big hoop earrings | Smooth, confident. Talks trash with a smile. |
| **Tanya** | 46 | Black woman, full-figured, short natural curls | Linen shorts set, sandals, sunglasses pushed up on her head | Auntie energy. Hits woodies all day, cheers loud. |
| **Marisol** | 38 | Latina, curvy, long wavy hair | Denim shorts, fitted tank top, wedge sandals | Quick and competitive. Hypes up her partner. |
| **Jenna** | 42 | White woman, athletic-curvy, blonde ponytail | Tank top, bike shorts, running shoes, visor | Serious form, precise. Quiet fist pump when she scores. |

### Men

| Name | Age | Look | Summer outfit | Throw style / personality |
|------|-----|------|---------------|---------------------------|
| **Dre** | 36 | Black man, tall, lean, low fade with a beard | Plain white tee, basketball shorts, slides with socks | Cool and relaxed. Air-mail specialist. |
| **Big Mike** | 48 | Black man, big build, bald, salt-and-pepper beard | Plain button-up short-sleeve shirt, cargo shorts, apron (grill master) | Grill master who stepped away to play. Big laugh, points at people. |
| **Carlos** | 41 | Latino, stocky, short curly hair, mustache | Plain polo, khaki shorts, sneakers | Steady and methodical. Slow nod when he scores. |
| **Travis** | 33 | White man, average build, backwards cap, scruff | Plain tank top, board shorts, flip-flops | Loose and goofy. Over-celebrates, dances after a cornhole. |

All clothes are **plain, with no logos, team names, or readable text.** Roster faces are invented, never based on a real person.

## One Body System For Everyone

Roster characters and scanned players are built from the **same parts** (the shared iPlay character system, also used by Slap):

- Body shapes covering all sizes, rigged once and reused.
- Outfits, hair and accessories as swappable parts. The roster outfits above become part of the wardrobe anyone can pick.
- A standard rigged head that takes either a roster face or a player's scanned face picture.

So a scanned player and Keisha throw, stand and react the same way. Only the face and the choices differ.

## Animation Set Per Character

Shared by every character (one set, retargeted to every body):

- `idle` (far end), `stepup`, `throw`, `react_good`, `react_bad`, `react_opponent_scored`, `neighbor_throw` (side angle).
- Personality comes from **which variation plays**, not separate animations: Travis gets the big dance on a cornhole, Carlos the slow nod, Tanya the loud cheer. Scanned players pick a reaction style.
- Idles vary: bouncing the bag, stretching, saying something to a partner. Rarely, a glance at a phone.
- Faces use a small set of preset expressions (smile, grimace, shout) on the standard head. No live face tracking in the first build.

Source for motions: motion-capture libraries with commercial-use licences (for example Mixamo), cleaned up and retargeted. Record the licence of every animation used.

## Keeping It From Looking Pasted On

The characters stand on top of a real-video background, so they must match it:

- Light them to the locked plate: summer afternoon sun from the same direction, warm fill, soft contact shadows on the grass.
- Colour-grade characters with the same grade as the plate.
- Far-end characters are about 27 ft away and small on screen, which hides a lot. The Neighbor Cut is the close shot: check it hardest.
- Build Keisha first, all animations, in the Thrower View and Neighbor Cut. If she sits right in the video, do the rest of the roster.
