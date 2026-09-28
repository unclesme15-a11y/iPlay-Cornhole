# Multiplayer Plan

## Seats

Every match has 4 seats in 2v2 (2 in 1v1). **Any seat can be a Human or a Video Bot.** The host fills seats on the Match Setup screen (see `game-rules.md`).

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

The trick that makes mixing easy: **every seat, human or bot, is shown as a video character.**

- Video Bot: the server picks the throw and the bot's character clips play.
- Human: the person swipes on their phone, the server works out the throw, and **the video character the human picked as their avatar** plays the same throw clip on everyone else's screen.
- The only difference between a human and a bot is who decides the throw. The visuals don't change.

That means you can put **any mix** in a match: you + bot partner vs 2 humans, 2 humans + 2 bots, all bots for practice, and so on.

Characters are picked from the roster in `characters.md` (4 men and 4 women to start). Two players in the same match can't use the same character. Bots get whoever is left.

If a human doesn't pick an avatar, show a mic/profile marker with a throwing-arm silhouette instead, like the human seats in Street Dice.

## Throw Input (Server-Authoritative)

1. The phone sends only the **swipe**: power, aim angle, arc, and an optional spin.
2. The server adds a small random wobble and runs the bag physics with a seed.
3. The server returns the flight path as frames (the same pattern as `PhysicalRollTransport` in Street Dice) plus the final resting spot.
4. Every phone replays those same frames, so everybody sees the same landing.

The phone can't claim "I scored 3." It only sends the swipe.

## Video Bot Skill

Measured by throwing thousands of bags through the real server physics on an empty board (a test in `server/test/bots.test.ts` keeps these in range):

| Level | In the hole | On the board | Miss / foul |
|-------|-------------|--------------|-------------|
| Rookie | ~9% | ~59% | ~32% |
| Regular | ~23% | ~66% | ~11% |
| Pro | ~46% | ~52% | ~2% |

A bot throws exactly like a human does: it sends a swipe (power, aim, arc), with an aiming error that depends on its level and an occasional wild throw. The server then runs the same physics for it, so a bot can never "cheat" a result and every bot bag looks physically real.

In whole 1v1 matches to 21, a Pro beat a Rookie 120 times out of 120, and two Regular bots split about 55/45, so there is no built-in advantage for either side. An average match runs about 10 innings.

Bots use simple strategy: when their team is ahead with two or fewer bags left, a Regular or Pro bot will sometimes throw a blocker just in front of the hole instead of going for it. Rookies never do.

## Voice

- Team voice channel plus table voice channel (Vivox, reusing the Street Dice token signer).
- Video bots get short "table talk" reaction clips instead of voice.

## Disconnects

- A human who drops gets 30 s to come back. Their seat is then taken over by a Video Bot at the same skill level until the game ends. Nothing is forfeited. There are no wagers in this game. An explicit Leave hands the seat to a bot immediately. If every human has left, the match is abandoned.
