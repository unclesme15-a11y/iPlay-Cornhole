# Cornhole Kling Shot List And Prompts

Rule of thumb from Street Dice: **lock stills with text-to-image first, then make every video clip with image-to-video from that locked still.** That keeps the boards in the same place in every clip, so the Unity invisible boards stay lined up.

## 1. Plates (Stills, No Opponents)

Scene: **big open park, summertime hood BBQ cookout, female-heavy crowd in the distance.** The crowd is background only and never stands in the lane.

If Kling softens or refuses a prompt, keep the descriptions of the women's bodies to "curvy" and "thick-figured". Words about specific body parts get filtered more often.

### Thrower View (Plate 1)

Your own board has to be visible right in front of you in the lower part of the frame. Far-end players throw at it, and there's no camera cut for that board.

```text
First-person point of view standing in a cornhole pitcher's box on flat trimmed grass, eye level about 5 feet, a regulation wooden cornhole board with a round hole on the ground directly in front of the viewer filling the lower left part of the frame, looking straight down a clear 27 foot lane at a matching far cornhole board, wide open green city park at a summertime hood BBQ cookout, bright afternoon sun, grills smoking, pop-up tents, folding tables and coolers in the background, a big relaxed crowd in the distance behind and to the sides of the lane, mostly curvy thick-figured adult Black women, with Latina and white women and some men mixed in, in summer cookout outfits, people talking in small groups and eating, a few little kids playing far off in the background, candid and natural, nobody posing, background slightly soft focus, no people between the boards, no logos, no text, realistic photo, natural lighting, 9:16 vertical
```

### Far Board Cam (Plate 2)

Used only for bags thrown at the far board.

```text
Low close-up camera angle beside a regulation wooden cornhole board with a round hole, same summertime park BBQ cookout on trimmed grass, board fills the lower half of the frame, clean empty board surface, cookout tents and a crowd of mostly curvy adult Black and Latina women soft and blurred in the background, people chatting in small groups, kids playing far off, no bags, no people on the board, no logos, no text, realistic photo, 9:16 vertical
```

### Neighbor Cut (Plate 3)

```text
Side angle from a cornhole pitcher's box looking across the near cornhole board at the opposite pitcher's box on the other side of it, empty box, flat trimmed grass, same summertime park BBQ cookout behind, crowd of mostly curvy adult women chatting in the soft background, no logos, no text, realistic photo, 9:16 vertical
```

## 1b. Background Life Takes (Image-To-Video From Plate 1)

Keep these prompts **short and loose**. Describe the vibe, add one or two small details, and let Kling fill in the rest. Long lists of actions make everything happen at once, and that looks staged.

Always end with: **"camera completely locked off, boards and lane stay empty and unchanged, candid documentary feel, nobody looks at the camera"**.

Make 3-4 takes of `bg_life`, changing just the small details each time:

```text
The cookout carries on naturally in the background, people talking and laughing in small groups, a few little kids chasing each other far off near the trees, someone walks past the tents carrying a cooler, camera completely locked off, boards and lane stay empty and unchanged, candid documentary feel, nobody looks at the camera, 10 seconds
```

Swap-in details for the other takes (pick one or two per take, never all):
- a woman laughs and touches her friend's arm
- a man flips burgers at a grill in the far background
- a kid rides a scooter across the far background
- a couple strolls by holding plates of food
- one woman quickly checks her phone, then puts it away
- two friends take a quick selfie, then go back to talking

### Nearby Reaction (Cornhole Only)

```text
The few people standing closest to the far cornhole board react to a great shot, one claps, one says "ayy" and points, the rest of the cookout keeps going about their business, camera completely locked off, boards and lane stay empty and unchanged, candid documentary feel, 3 seconds
```

## 2. Character Clip Set (Per Video Opponent)

Make one character's full set first (Keisha). Use the same character reference image for every clip. The full roster is in `docs/characters.md`.

### Character Reference Portrait (Text-To-Image, One Per Character)

```text
Full-body photo of <character description from characters.md>, standing on grass at a summertime park BBQ cookout, relaxed natural pose, holding a cornhole bag, plain clothing with no logos or text, bright afternoon sunlight, realistic photo, 9:16 vertical
```

Example (Keisha):

```text
Full-body photo of a 34 year old curvy Black woman with long braids pulled up, wearing a bright yellow sundress, white sneakers and big hoop earrings, standing on grass at a summertime park BBQ cookout, relaxed confident pose, holding a cornhole bag, plain clothing with no logos or text, bright afternoon sunlight, realistic photo, 9:16 vertical
```

| Clip | Length | Plate it starts from | Notes |
|------|--------|----------------------|-------|
| `idle` | 4-5 s loop | Plate 1 (far end) | Standing in the box, bouncing a bag, looking toward camera. Now and then a take where they glance at their phone, but not in most. |
| `stepup` | 2 s | Plate 1 | Squares up, lifts the bag. |
| `throw` | 3 s | Plate 1 | Underhand throw toward camera. The bag must leave frame or be hidden right at release. |
| `react_good` | 2-3 s | Plate 1 | Fist pump, points, nods. |
| `react_bad` | 2-3 s | Plate 1 | Head shake, hands on hips. |
| `react_opponent_scored` | 2-3 s | Plate 1 | "Nice shot" nod or playful frustration. |
| `neighbor_throw` | 3 s | Plate 3 side angle | Same character throwing from beside the camera player. |

### Example Throw Clip Prompt (Image-To-Video From Plate 1)

```text
The character from the reference image stands in the far pitcher's box beside the far cornhole board, facing the camera, steps forward and makes a smooth underhand cornhole toss toward the camera, the bag leaves their hand and immediately exits the top of the frame, camera completely locked off and still, boards and background do not move, realistic, natural motion, 3 seconds
```

Key words to keep in every clip prompt: **"camera completely locked off"**, **"boards and background do not move"**. If the camera drifts, the Unity boards won't line up.

## Notes

- Kling may change the board's position slightly between clips. Reject any clip where the board moves. Check by laying it over the locked still.
- Delete the bag from the video right at release (or pick takes where the hand hides it). Unity always draws the flying bag.
- Keep clothing plain, with no logos or team names.
- Age range for every character is 30-50. Put the exact age in each prompt, or Kling tends to make people look younger.
