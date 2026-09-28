# Video Characters (First Build)

8 characters to start: **4 men and 4 women, ages 30-50**, all dressed for a hot summer cookout. Every character is available both as a video bot and as a human player's avatar.

The names are placeholders and can be changed.

## Women

| Name | Age | Look | Summer outfit | Throw style / personality |
|------|-----|------|---------------|---------------------------|
| **Keisha** | 34 | Black woman, curvy, long braids pulled up | Bright yellow sundress, white sneakers, big hoop earrings | Smooth, confident. Talks trash with a smile. |
| **Tanya** | 46 | Black woman, full-figured, short natural curls | Linen shorts set, sandals, sunglasses pushed up on her head | Auntie energy. Hits woodies all day, cheers loud. |
| **Marisol** | 38 | Latina, curvy, long wavy hair | Denim shorts, fitted tank top, wedge sandals | Quick and competitive. Hypes up her partner. |
| **Jenna** | 42 | White woman, athletic-curvy, blonde ponytail | Tank top, bike shorts, running shoes, visor | Serious form, precise. Quiet fist pump when she scores. |

## Men

| Name | Age | Look | Summer outfit | Throw style / personality |
|------|-----|------|---------------|---------------------------|
| **Dre** | 36 | Black man, tall, lean, low fade with a beard | Plain white tee, basketball shorts, slides with socks | Cool and relaxed. Air-mail specialist. |
| **Big Mike** | 48 | Black man, big build, bald, salt-and-pepper beard | Plain button-up short-sleeve shirt, cargo shorts, apron in some clips (grill master) | Grill master who stepped away to play. Big laugh, points at people. |
| **Carlos** | 41 | Latino, stocky, short curly hair, mustache | Plain polo, khaki shorts, sneakers | Steady and methodical. Slow nod when he scores. |
| **Travis** | 33 | White man, average build, backwards cap, scruff | Plain tank top, board shorts, flip-flops | Loose and goofy. Over-celebrates, dances after a cornhole. |

All clothes are **plain, with no logos, team names, or readable text.**

## Clip Set Per Character

Each character needs the same set (details in `artifacts/kling/cornhole-prompts.md`):

- `idle` (far end), `stepup`, `throw`, `react_good`, `react_bad`, `react_opponent_scored`, `neighbor_throw` (side angle).
- Idles should feel natural and a little different each time: bouncing the bag, stretching, saying something to their partner. Once in a while one of them glances at their phone, but only rarely.

That's 7 clips x 8 characters = **56 character clips** for the first build, plus 3-4 background life takes and 1 nearby-reaction take.

## Keeping Each Character Consistent

- Make one **reference portrait** per character first (text-to-image), and approve it.
- Use that same reference image in every clip for that character (Kling's character/element reference), so the face, body, and outfit don't change between clips.
- Build Keisha first, all 7 clips. If she looks right in the game, do the other 7.
