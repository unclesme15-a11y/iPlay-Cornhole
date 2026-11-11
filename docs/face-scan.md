# Face Scan In Cornhole

> **Hands:** All hands come from the shared Unity hand rig (`com.iplay.handrig`), composited over Imagine footage. Imagine never generates hands.

## Where The Face Scan Is Used Across iPlay

| Game | Face scan? | How |
|------|------------|-----|
| **iPlay Slap** | Yes | First person. You see your opponent's own character, with their face, across from you. |
| **iPlay Cornhole** | Yes | Every player is a 3D iPlay character. Scanned players use their own face. |
| iPlay Cards (Spades, CALI, Solitaire) | **No** | Banned by owner decision. |
| iPlay Street Dice / Cee-Lo & Craps | **No** | Banned by owner decision. |

Owner decision, November 2026. Do not add the face scan to Cards or Dice.

## One Character Per Player

A player makes their **iPlay character** once and uses it in Slap and Cornhole:

1. **Scan.** The phone camera maps the face. This runs on the phone (MediaPipe Face Landmarker, the same tech as the reference scanner in the `MedFac-` repo).
2. **Build.** The phone fits the player's face picture onto a standard rigged iPlay head, picks a matching skin tone, and the player chooses body shape, outfit and hair.
3. **Throw the map away.** The face measurements are deleted from the phone as soon as the character is built. What is kept is the finished character: the face picture on the standard head, plus the player's choices.

Players who don't want to scan pick one of the 8 roster characters (`characters.md`) or build one by hand. Nobody is locked out of playing.

## How Your Face Gets To The Other Players

Your opponents' phones have to draw your character, so the finished character has to travel. It travels the way a seat does, and it is not stored:

1. You join a match. Your phone sends your finished character (small: the face picture + your choices, no face measurements) to the game server with your seat.
2. The server **passes it along** to the other phones in that match only.
3. When the match ends, the other phones drop it and the server keeps nothing.

This is **relay, don't keep**. iPlay's servers never store a player's face.

## Privacy Rules (Do Not Change Without Owner + Counsel Sign-Off)

- The scan and the face measurements never leave the phone.
- Sharing your character's face with opponents is **its own yes** on the consent screen. If a player says no, opponents see that player as a roster character, and the player still sees their own face on their own phone.
- No face data in analytics, crash reports, logs or ad SDKs. No face-swapping into video, ever.
- The scan is turned off in states where it is geo-blocked (see the counsel review draft, Section B). Players there pick a roster character or build one by hand.
- Live expression tracking (your character smiling when you smile) is **not** part of the first build. If it is added later, it needs its own consent screen.

## What This Changes In The Rest Of The Repo

- `characters.md`: the 8 roster characters become 3D presets instead of video clip sets.
- `multiplayer-plan.md`: humans and bots still look the same, because both are 3D characters now.
- `visual-camera-plan.md`: Unity draws every player on top of the video background. The release-frame hand-off is replaced by the character's hand position.
- `roadmap.md`: Phase 4 becomes 3D characters, built on the character system shared with Slap.
