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

## Seasons

Ranked play runs in **seasons of 3 months**. **Season 1 starts 1 January 2027** (midnight UTC, which is the evening of
31 December in the US), then Season 2 on 1 April, Season 3 on 1 July, and so on.

**Before that it is the Preseason.** Ranked matchmaking and the leaderboard work normally (the app shows
"PRESEASON · SEASON 1 STARTS IN 86 DAYS"), so testers and early players can try them. But nothing from the preseason
is kept: when Season 1 starts, **every rating goes back to exactly 1200**, games and wins go back to zero, and no
preseason board is saved. Example: a friend who tested a lot in December and reached 1700 starts Season 1 at 1200,
same as someone who downloads the game on 1 January. Nobody gets a head start from testing.

When a season ends:

1. **The final standings are saved for good.** Anyone can look back at last season's board, and every player keeps their own history ("Season 1: #12 in singles, #4 with Dre in teams").
2. **Every rating gets a soft reset**: it moves halfway back to 1200. The season's games, wins, losses and streak start again from zero, so **everyone needs 10 games again** to appear on the new board.

Example: Keisha finishes Season 1 at 1640, Travis at 1080. Season 2 starts them at 1420 and 1140. Keisha is still ahead, but a new player has a real chance to catch her. That is what keeps ranked fresh, and it gives top players something to show off each season.

- A match that is still being played when the season ends counts for the new season.
- If the server was off when a season ended, it catches up by itself the next time it starts, one season at a time.
- Settings: `SEASON_ONE_START` (a date), `SEASON_LENGTH_MONTHS` (1, 2, 3, 4, 6 or 12; default 3), `SEASON_SOFT_RESET` (0 = everyone back to 1200, 1 = no reset; default 0.5). **Change them before Season 1 starts**, not in the middle of a season. Moving `SEASON_ONE_START` during the preseason is safe (the preseason just gets longer or shorter).
- When a season closes, the alert webhook gets a message.

## What to watch after launch

- If new players feel stuck, raise the placement speed (40) or lengthen placement past 10 games.
- If the top of the board is too jumpy, lower the veteran speed (20).
- If queues are slow at night, widen the window faster (50 per 5 s).
- If the board is too empty, lower the 10-game or 90-day bar.
