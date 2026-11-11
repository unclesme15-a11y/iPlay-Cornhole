# Decisions

> **Hands:** All hands come from the shared Unity hand rig (`com.iplay.handrig`), composited over Imagine footage. Imagine never generates hands.

## Settled

- **Layout:** regulation only. No Face-Off mode.
- **Target score:** picked on the Match Setup screen, default 21.
- **First scene:** big open park, summertime hood BBQ cookout, with a female-heavy crowd in the distance. The background life is random and natural: regular conversation, little kids playing far off, people walking by, and only the occasional phone.
- **Board cam:** on by default, **far board only**. Your own board is right in front of you, so there's no cut for it.
- **Bag colors:** teams pick from a 12-color palette, first come first served, and no two teams can share a color.
- **Characters:** at least 4 men and 4 women for the first build, ages 30-50, summer outfits (see `characters.md`).
- **Face scan (November 2026):** Cornhole uses the iPlay face scan. Every player is a 3D iPlay character drawn by Unity, shared with iPlay Slap; scanned players use their own face. Imagine video is for the setting and crowd only. Cards and Dice do not use the face scan. See `face-scan.md`.
- **Video AI:** **Imagine** is the only tool. No side-by-side test against Veo or Seedance — Imagine replaced Kling across the board (November 2026).
- **Wagers:** none, ever.
- **Repo:** its own repo (`iPlay-Cornhole`). Done.

## Still Open

- **Character look:** how realistic the 3D characters should be (photo-real vs. stylized-real). Decide with Slap, since both games share the characters. Test Keisha over Plate 1 before committing.
- **Live expressions:** whether a player's real expressions (smile, shout) should drive their character later. Not in the first build; needs its own consent screen.
- **Friends in the crowd:** whether opted-in friends watching a match can appear as characters standing near the lane. Later, if at all.
