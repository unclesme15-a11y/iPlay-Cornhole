# Multiplayer Plan

> **Hands:** All hands come from the shared Unity hand rig (`com.iplay.handrig`), composited over Imagine footage. Imagine never generates hands.

## Seats

Every match has 4 seats in 2v2 (2 in 1v1). **Any seat can be a Human or a Bot.** The host fills seats on the Match Setup screen (see `game-rules.md`).

```text
          FAR END
   [ B2 ]  [board]  [ A2 ]      <- your partner (A2) and their partner (B2)

             lane (27 ft)

   [ B1 ]  [board]  [ A1 ]      <- YOU (A1) and your direct opponent (B1)
          NEAR END (your camera)
```

- Each human always sees the game from **their own** pitcher's box. Every phone shows its owner as "the near end".
- The server stores the real positions, and each phone just rotates the table so its owner is at the bottom.

## How Humans And Bots Look The Same

The trick that makes mixing easy: **every seat, human or bot, is shown as a 3D iPlay character.** (Changed November 2026 from video characters; see `face-scan.md`.)

- Bot: the server picks the throw and the bot's roster character plays the throw animation.
- Human: the person swipes on their phone, the server works out the throw, and **the human's character** plays the same throw animation on everyone else's screen.
  - Scanned player who said yes to sharing their face: their own iPlay character, with their face.
  - Anyone else: the roster character they picked.
- The only difference between a human and a bot is who decides the throw. The visuals don't change.

That means you can put **any mix** in a match: you + bot partner vs 2 humans, 2 humans + 2 bots, all bots for practice, and so on.

Roster characters are listed in `characters.md` (4 men and 4 women to start). Two players in the same match can't use the same roster character. Bots get whoever is left. Scanned players never clash, because every scanned character is unique.

## Sending Characters Between Phones

- On joining, each phone sends its player's **finished character** with the seat: face picture on the standard head plus body/outfit/hair choices. Never face measurements.
- The server relays it to the other phones in the match and **keeps nothing**. Phones drop other players' characters when the match ends.
- Size target: under 300 KB per character, so a 2v2 match loads in a couple of seconds on mobile data. Send it during Match Setup and bag color pick, so nobody waits.
- If a character fails to arrive, show that seat as a roster character rather than holding up the match.

## Throw Input (Server-Authoritative)

1. The phone sends only the **swipe**: power, aim angle, arc, and an optional spin.
2. The server adds a small random wobble and runs the bag physics with a seed.
3. The server returns the flight path as frames (the same pattern as `PhysicalRollTransport` in Street Dice) plus the final resting spot.
4. Every phone replays those same frames, so everybody sees the same landing.

The phone can't claim "I scored 3." It only sends the swipe.

## Bot Skill

| Level | In hole | On board | Off / foul |
|-------|---------|----------|------------|
| Rookie | 10% | 45% | 45% |
| Regular | 25% | 50% | 25% |
| Pro | 45% | 45% | 10% |

The server picks the bot's outcome from its level, then finds a throw that produces it. The flight always looks physically real because it comes from the same physics as a human throw.

Bots also use simple strategy: block the hole with a bag when they're ahead, and try to knock an opponent's woody off when they're behind.

## Voice

- Team voice channel plus table voice channel (Vivox, reusing the Street Dice token signer).
- Bots get short recorded "table talk" lines with their reaction animations instead of voice.

## Disconnects

- A human who drops gets 30 s to come back. Their seat is then taken over by a bot at the same skill level until the game ends. The bot keeps showing a **roster character**, not the departed player's face, because that player is no longer there to share it. Nothing is forfeited. There are no wagers in this game.
