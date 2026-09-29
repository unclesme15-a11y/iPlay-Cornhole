# The Rating Numbers, Explained

Everything here is in `server/src/ranking/`. All of it is a first guess you can tune after people play.

## The rating itself

- **Everyone starts at 1200.** It is just a starting line. What matters is the *gap* between two players.
- **The gap predicts who wins.** The formula is the classic chess one (Elo):

  | Gap | Stronger player wins about |
  |---|---|
  | 0 | 50% (coin flip) |
  | 100 | 64% |
  | 200 | 76% |
  | 400 | 91% |

  So a 1500 player should beat a 1300 player about 3 times out of 4.
- **After a match, you gain or lose points based on how surprising the result was.** Beat someone you *should* beat and you get a few points. Beat someone much better and you get a lot. Lose to someone much worse and you drop a lot.
- **The floor is 100.** Nobody drops below it.

## How fast it moves ("K", the speed dial)

| Your ranked games so far | Speed (K) | Why |
|---|---|---|
| 0 to 9 ("placement") | 40 | New players move fast so they reach their real level quickly |
| 10 to 29 | 28 | Settling in |
| 30+ | 20 | Veterans move slowly, so one bad night doesn't wreck a season |

**The math:** points = speed × (result − expected). The result is 1 for a win and 0 for a loss; "expected" comes from the table above.

## Examples with your players

- **Two brand-new players (both 1200):** the winner gets **+20**, the loser **−20**. (40 × (1 − 0.5) = 20.)
- **Keisha (1400, veteran) beats Mike (1200, veteran):** she was expected to win 76% of the time, so she gets **+5** and he loses **−5**.
- **Mike pulls the upset:** he gets **+15**, she loses **−15**. Upsets pay three times as much here, because they were three times less likely.
- **A new player (1200, 3 games) beats Keisha (1400, 50 games):** the new player gets **+30** (they're on the fast K of 40); Keisha loses **−15** (she's on the slow K of 20). Points aren't always equal and opposite, on purpose: new players find their level fast without veterans swinging wildly.
- **Climbing:** a veteran beating equal players gains about **+10 a win**, so going from 1200 to 1400 takes roughly 20 more wins than losses against equal opposition. Beating stronger people gets you there faster.

## Teams (duos)

- A **duo** is two specific people. Keisha + Mike have one team rating; Keisha + Dre is a different duo with its own.
- A **new duo starts at the average of the two players' singles ratings.** Keisha (1400) + Mike (1200) start at 1300.
- Both partners see the same change after a match. Your singles rating doesn't move in a team match.

## Fair play rules

- **Walking out (leaving, or dropping for 30 seconds):** your team loses the match, and you wait **10 minutes** before you can queue again. The people you left behind aren't punished.
- **Void:** if someone walks out **before anyone has thrown**, nobody's rating changes at all.
- **Farming guard:** playing the same opponent(s) over and over to trade wins doesn't pay. Within 24 hours:

  | Ranked matches already played against the same people | Points this match |
  |---|---|
  | 0 to 2 | full |
  | 3 to 5 | half |
  | 6+ | none |

## Finding a match

- You're first matched with someone within **±100 points** of you.
- Every **5 seconds** of waiting widens it by **50**, up to **±800**. Close matches come first, and nobody waits forever.
- After **5 minutes** with nobody found, the search stops and the app offers to search again.
- People who blocked each other are never matched.

## Getting on the leaderboard

- **10 ranked games** first (the placement games).
- **Played a ranked game in the last 90 days.** Stop playing and you drop off the board, but your rating is kept, and one game puts you back.
- Banned players are removed at once. Anyone can hide their name from the boards in settings.
- Ties are broken by who has played more games.

## What to watch after launch

- If new players feel stuck, raise the placement speed (40) or lengthen placement past 10 games.
- If the top of the board is too jumpy, lower the veteran speed (20).
- If queues are slow at night, widen the window faster (50 per 5 s).
- If the board is too empty, lower the 10-game or 90-day bar.
