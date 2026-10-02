# Art Brief 1: The Board, The Bags, And The iPlay Nameplate

The first in-Unity art: the iPlay-branded cornhole board, the iPlay-branded bags, and **the iPlay nameplate**, a brand piece every iPlay game shares. The goal is as close to real life as a phone can show.

## How real-looking 3D works (read this first)

A 3D object in Unity is a **shape** (the mesh) with **images wrapped around it** (the textures). Realism mostly comes from the textures, so that is what GPT makes. The shapes are simple (a board is a slanted box with a hole; a bag is a flat pillow), and they get built to exact regulation size in Unity, not drawn by GPT.

So you will make two kinds of images:

| Kind | What it is | Example |
|---|---|---|
| **Look reference** | A realistic photo-style picture of the finished thing, to agree on the design | "The board at a cookout, 3/4 view" |
| **Texture sheet** | A flat, straight-down, evenly lit, shadow-free square of the surface itself, which Unity wraps onto the shape | "Close-up of the duck-cloth weave, edge to edge, no shadows" |

Unity also needs a **bump map** (where the surface is raised: the weave, the stitches, the brushed lines) and a **shine map** (what is glossy, what is matte). GPT can't make those reliably. I make them from your texture sheets with a script.

Example with your game: you make one flat square of gray duck cloth. From it I make the bump map (so the weave catches the light) and the shine map (so the cloth is matte). Unity then tints that one fabric into all 12 team colors. So you make **one** fabric image, not twelve.

### Rules for every texture sheet

Paste these at the end of every texture prompt. GPT forgets them otherwise.

> Flat orthographic view straight down, perfectly even soft lighting, no shadows, no highlights, no reflections, no perspective, no vignette, no text, no logos, no border. The texture fills the whole square edge to edge and tiles seamlessly.

- **Square, the biggest size GPT offers** (at least 1024 × 1024). PNG.
- If a seam shows when tiled, send it anyway. I fix seams.
- **Any image with the iPlay logo:** attach `assets/logo/iplay-mark-source.jpg` to the GPT chat and say "use this exact logo, do not redesign it." Otherwise GPT invents a different logo.
- **GPT is unreliable with lettering.** Check every "iPlay" letter by letter. If it is wrong, keep the image anyway: I can put the exact lettering on in code.

### The iPlay look (same as Street Dice)

Dark brushed metal like the app icon, **iPlay cyan** glow (#0DCCF2), **gold** edges and accents, near-black navy (#05080B). Clean and premium, not cartoon.

---

## A. The board

**Real-world spec:** regulation deck 24 × 48 in; 6 in hole centred 9 in from the back edge. The frame is 2×4 thick (about 3.5 in), the back about 12 in off the ground and the front about 3 in. LED strips run down both long sides, along the front edge and in a ring around the hole (`docs/led-board-and-bags.md`). The deck is glossy black; the frame is brushed dark metal.

| # | Image | Kind | File name |
|---|---|---|---|
| A1 | The finished board, hero view | Look reference | `board-ref-hero.png` |
| A2 | The board from straight above | Look reference (deck layout) | `board-ref-top.png` |
| A3 | Glossy black deck surface | Texture | `board-deck-albedo.png` |
| A4 | Brushed dark metal for the frame | Texture | `board-frame-metal.png` |
| A5 | Frosted LED diffuser strip, lights off | Texture | `board-led-diffuser.png` |
| A6 | Scuff and bag-rub wear on the deck | Texture (black and white) | `board-deck-wear.png` |
| A7 | Metal trim ring around the hole | Texture | `board-hole-trim.png` |
| A8 | The deck graphic: logo and nameplate artwork alone | Decal on transparent | `board-deck-decal.png` |
| A9 | Underside, legs and hinge hardware | Texture | `board-underside.png` |

**A1. Hero reference** (attach the logo):
> Photorealistic product photo of a premium regulation cornhole board, 24 by 48 inches, at a sunny summer park cookout, three-quarter view from the front at waist height. Deep glossy black deck with a clear-coat shine reflecting the sky, one 6-inch hole near the top. Frame of brushed dark gunmetal like the attached app icon, with thin cyan LED strips glowing softly along both long sides, the front edge, and in a ring around the hole. The attached iPlay logo printed large on the lower half of the deck in glowing cyan, with a slim brushed-metal "iPlay" nameplate across the front apron. Gold pinstripe edge accents. Real wood and metal detail, slight dust and bag-rub wear on the deck, natural daylight, shallow depth of field. Use this exact logo, do not redesign it.

**A2. Top-view layout reference** (attach the logo):
> Same board as before, viewed perfectly straight down from above, flat orthographic, the whole board filling the frame vertically, even lighting, no perspective, no shadows. Shows the exact layout: hole near the top, logo on the lower half, LED strips down both sides and in a ring around the hole, metal frame around the edge. Use this exact logo.

**A3. Deck surface:**
> Close-up of a deep glossy black painted wood surface with a thick clear coat: very fine orange-peel texture in the lacquer, faint wood grain barely visible under the paint, a few microscopic dust specks. [texture rules]

**A4. Brushed metal:**
> Close-up of dark gunmetal brushed aluminium, fine straight horizontal brush lines, subtle variation, matching the attached iPlay app icon's metal. [texture rules]

**A5. LED diffuser:**
> Close-up of a frosted white polycarbonate LED strip diffuser with the lights switched off, milky and translucent, faint dot pattern of the LEDs visible underneath, thin aluminium channel edges along the top and bottom. Wide strip filling the square. [texture rules, but say "tiles left to right"]

**A6. Wear map:**
> Grayscale texture map: pure black background with soft white streaks and smudges where cornhole bags slide up a board toward the hole, light scuffs and faint dust. Mostly black, wear is subtle. [texture rules]

**A7. Hole trim:**
> Close-up of a polished dark metal ring trim with a thin gold inner edge, the kind set around a hole in a premium board. Straight down, the ring centred and filling the square, transparent or pure black in the middle. [texture rules, without "tiles seamlessly"]

**A8. Deck graphic** (attach the logo, and the nameplate once it is approved):
> The deck artwork alone for a cornhole board, on a transparent background: the attached iPlay logo large and centred, glowing cyan with a soft halo, and the iPlay nameplate below it. Flat graphic, no board, no perspective, no shadows. Use this exact logo.

**A9. Underside:**
> Close-up of the raw underside of a cornhole board: sanded birch plywood with dark gunmetal folding-leg hardware and a black hinge bracket in one corner. [texture rules, without "tiles seamlessly"]

---

## B. The bags

**Real-world spec:** 6 × 6 in, about 16 oz, filled with resin pellets, so they slump flat when they land. **Two sides:** a smooth **duck-cloth** side that slides, and a **suede** side that grips (regulation two-sided bags). A double-stitched border. The **iPlay mark printed in the centre**, about 3.4 in wide: **white on dark bags, black on light bags**. Team B's bags also get a **stitched X** so color-blind players can tell the teams apart.

| # | Image | Kind | File name |
|---|---|---|---|
| B1 | The bags, hero view | Look reference | `bag-ref-hero.png` |
| B2 | Duck-cloth fabric (the slide side), neutral gray | Texture | `bag-duck-albedo.png` |
| B3 | Suede (the grip side), neutral gray | Texture | `bag-suede-albedo.png` |
| B4 | The stitched border seam | Texture strip | `bag-stitch-strip.png` |
| B5 | Screen-print ink grain (for the logo print) | Texture (black and white) | `bag-print-grain.png` |
| B6 | One real bag, both faces flat (front and back) | Look reference | `bag-ref-flat.png` |

**B1. Hero reference** (attach the logo):
> Photorealistic product photo of four premium regulation cornhole bags, 6 by 6 inches, resting slumped on a glossy black cornhole board deck at a summer park. Two cobalt blue bags with the attached iPlay logo screen-printed in white in the centre, two bright yellow bags with the same logo printed in black, and the yellow ones also have a stitched X across the front. Heavy duck-cloth canvas, double-stitched edges, resin-filled so they sag naturally over the board. One bag flipped to show its suede underside. Natural daylight, shallow depth of field. Use this exact logo, do not redesign it.

**B2. Duck cloth:**
> Close-up of heavy cotton duck canvas fabric, tight even weave clearly visible, mid neutral gray (no color cast), slightly worn and soft. [texture rules]

**B3. Suede:**
> Close-up of microsuede fabric, short soft nap with gentle directional shading where it has been brushed, mid neutral gray (no color cast). [texture rules]

**B4. Stitch strip:**
> Close-up of a double row of heavy stitching along the folded seam of a canvas bag, neutral gray fabric with slightly lighter thread, running straight left to right across the middle of the square. [texture rules, but say "tiles left to right"]

**B5. Print grain:**
> Grayscale texture map of screen-printed ink on canvas: white ink with tiny cracks, slight fabric weave showing through, small worn patches, on black. [texture rules]

**B6. Flat bag reference** (attach the logo):
> Photorealistic photo of one cobalt blue cornhole bag laid perfectly flat, shown twice side by side: the duck-cloth front with the attached iPlay logo screen-printed in white, and the suede back. Straight down, even lighting, no shadows, white background. Use this exact logo.

---

## C. The iPlay nameplate (every iPlay game)

**What it is:** one metal plate with the **iPlay** name on it and a **custom sound waveform** blended through it. The same plate appears in every iPlay game, so the brand reads the same everywhere. In Cornhole it sits on the board's front apron and under the logo on the deck. In Street Dice and future games it goes on menus, loading screens and wherever the brand shows.

**The look:** a slim horizontal plate of the same dark brushed metal as the app icon, with bevelled edges and a thin gold rim. The i▶ mark on the left and the word **iPlay** in clean bold lettering. A smooth audio waveform runs the full width behind the lettering, glowing iPlay cyan and fading into gold at the ends, so it looks etched into the metal and lit from inside.

**Why the waveform should be made in code, not by GPT:** it must be **identical in every game**, sharp at any size, and able to move (it can pulse with the ring-in sound when a bag drops in). GPT would draw a slightly different waveform every time. So the plan is:

- **GPT makes the metal plate and the overall look** (C1, C2, C3 below).
- **I build the waveform as an exact vector shape** (one file, any size, the same in every game) and the glow mask Unity uses to light and animate it. GPT's image is the target it has to match.

| # | Image | Kind | File name |
|---|---|---|---|
| C1 | The nameplate design, hero view | Look reference | `nameplate-ref-hero.png` |
| C2 | The nameplate flat, front-on | Look reference (the master layout) | `nameplate-ref-flat.png` |
| C3 | The plate's metal with no lettering or waveform | Texture | `nameplate-metal.png` |
| C4 | Three waveform style options to pick from | Look reference | `nameplate-waveform-options.png` |

**C1. Hero reference** (attach the logo):
> Photorealistic close-up of a premium slim horizontal brand nameplate, about 4 to 1 wide, mounted on the front of a glossy black cornhole board. Dark gunmetal brushed metal like the attached app icon, bevelled edges, a thin polished gold rim. On the left, the attached iPlay logo glowing cyan; next to it the word "iPlay" in clean bold modern lettering. A smooth audio sound waveform runs the full width of the plate behind the lettering, etched into the metal and glowing iPlay cyan from inside, blending into warm gold toward both ends. Subtle reflections, real machined detail, outdoor daylight. Use this exact logo, do not redesign it.

**C2. Flat master:**
> The same nameplate, perfectly front-on, flat orthographic, filling the frame left to right, even lighting, no perspective, no shadows, on a transparent or pure black background. Exact spelling "iPlay".

**C3. Plate metal:**
> Close-up of dark gunmetal brushed metal with fine horizontal brush lines and a very slight satin sheen, matching the attached app icon. [texture rules]

**C4. Waveform options:**
> Three different glowing audio waveform designs stacked on a black background, each a single horizontal line the full width: 1) a smooth flowing sine-like wave that swells in the middle, 2) a spiky sound-meter waveform of thin vertical bars, mirrored top and bottom, 3) a soft layered waveform of three overlapping translucent lines. Each glows cyan in the middle, fading to gold at both ends. Flat, no perspective, no text.

Pick one of C4's three, or describe your own, and I build that one exactly.

---

## What happens after you send them

1. I clean seams, make the bump and shine maps, and set up the materials.
2. I build the board shape (regulation size, real hole, LED channels), the bag shapes (flat, slumped and mid-air), and the nameplate waveform in code.
3. The LED strips and the nameplate waveform glow and animate from the game's own cues (the ring-in burst, the score pulse), so lights and sound stay in sync.
4. I render previews for your approval before anything goes into a build.

**Order:** A1, B1, C1 first (agree on the look), then C4 (pick the waveform), then the texture sheets.
