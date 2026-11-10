# Decisions

## Settled

- **Layout:** regulation only. No Face-Off mode.
- **Target score:** picked on the Match Setup screen, default 21.
- **First scene:** big open park, summertime hood BBQ cookout, with a female-heavy crowd in the distance. The background life is random and natural: regular conversation, little kids playing far off, people walking by, and only the occasional phone.
- **Board cam:** on by default, **far board only**. Your own board is right in front of you, so there's no cut for it.
- **Bag colors:** teams pick from a 12-color palette, first come first served, and no two teams can share a color.
- **Characters:** at least 4 men and 4 women for the first build, ages 30-50, summer outfits (see `characters.md`).
- **Wagers:** none, ever.
- **Repo:** its own repo (`iPlay-Cornhole`). Done.

## Still Open

- **Video AI:** **Imagine (Grok Imagine, via SuperGrok)** is the default candidate for all three plates (Thrower View, Far Board Cam, Neighbor Cut) and for later clips, in the neon-dark iPlay look on the summertime park BBQ cookout. An open question remains: whether to test more than one tool on a single plate before generating the full clip set. The earlier named-tool bake-off was dropped on 2026-11-10.

**What the record already shows about Imagine:** image-to-video and first+last-frame loops work. A 2026-11-10 Face Scan test, however, showed face morphing and a flickering beam on a locked-off still. Plates without close-up faces therefore suit Imagine best. Anything that needs a perfectly stable face should be composited: keep the approved still's face locked, and animate only the overlay or the rest of the frame.

On 2026-11-10, Cornhole was still on hold for game work. This document change is a spec update only. No plates or clips were generated as part of it.
