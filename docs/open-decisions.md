# Decisions

## Settled

- **Layout:** regulation only. No Face-Off mode.
- **Target score:** picked on the Match Setup screen, default 21.
- **First scene:** big open park, summertime hood BBQ cookout, with a female-heavy crowd in the distance. The background life is random and natural: regular conversation, little kids playing far off, people walking by, and only the occasional phone.
- **Board cam:** on by default, **far board only**. Your own board is right in front of you, so there's no cut for it.
- **Bag colors:** teams pick from a 12-color palette, first come first served, and no two teams can share a color.
- **Characters:** at least 4 men and 4 women for the first build, ages 30-50, summer outfits (see `characters.md`).
- **Wagers:** none, ever. **Nothing is for sale**; the only income is ads, never shown during a match.
- **Repo:** its own repo (`iPlay-Cornhole`). Done.
- **Bag logo:** the iPlay "i▶" mark, extracted from the app icon (`assets/logo/`).
- **Hole sound:** an original game-show ring-in (not the TV show's audio), with two alternates to pick from.
- **Flash speed:** capped at 3 flashes a second, with a reduced-motion version.

### Idle players (built)

- Three throws in a row that run out the 20 s clock count as walking away: a bot plays for them in casual matches, and in ranked they forfeit (with the 10-minute wait). This stops anyone holding a match hostage by staying connected and doing nothing.

### Adults, ranked, voice and ads (built)

- **Adults only (18+):** every iPlay game is for adults because voice chat isn't filtered. Sign-up needs an "I am 18 or older" confirmation; ranked and voice also need the current terms accepted.
- **Ranked:** singles and duo teams, fixed rules (21, regulation, no bust or skunk, 20 s clock, all human), Elo ratings starting at 1200, parties for duos, walking out is a loss with a 10-minute wait, void if nobody had thrown.
- **Leaderboards:** global singles and teams; 10 ranked games and activity in the last 90 days to appear; players can hide themselves.
- **Voice:** Vivox with a table channel and a team channel, blocked players muted on the blocker's phone.
- **Ads:** **AppLovin MAX**, the same account across every iPlay game. The phone shows them, the server sets the pacing, never during a match.
- **Throwing:** line up with an aim line and landing ring, pull back for distance, flick for accuracy (no timing meter). Wind on by default (Breezy), always Breezy in ranked (`throwing-controls.md`).

### Accounts, data and safety (built without waiting on answers, all changeable)

- **Sign-in:** guests can play at once; Apple and Google are supported on the server and switched on by setting their ids. Guests can attach Apple or Google later and keep everything. To require Apple/Google, set `ALLOW_GUESTS=false`.
- **What is stored:** no email, no real name, no birthday, no location, no payments (see `data-and-privacy.md`). Only the provider's id for the person is kept.
- **One match at a time** per account.
- **Rematch:** 60 seconds to answer; everyone who says yes keeps their seat, character and bag color; anyone who says no becomes a bot; the picks are skipped.
- **Leaving:** leaving mid-match hands the seat to a bot for good. Dropping out for 30 seconds does the same, but you get the seat back if you return in time.
- **Names:** 3 to 20 characters, filtered for profanity and impersonation; one change every 7 days.
- **Restarts:** live matches are saved and restored. One server runs the matches at a time.
- **Match history:** kept indefinitely; a deleted account's name is replaced by "Deleted player".

## Still Open

- **Sound choice:** audition the three hole sounds in the preview page and pick one.
- **Vector logo:** get an SVG/vector version of the iPlay mark for the final bag print.
- **Video AI:** Kling as the main tool, with a quick side-by-side test against Veo 3.1 and Seedance 2.0 using the same Plate 1 before generating the full clip set.
- **Hosting:** your Hetzner box, with the other iPlay games (see `hetzner-deploy.md`). Still open: which domain name, and where the off-box backups go.
- **Ranking numbers:** the starting rating (1200), how fast ratings move (40 / 28 / 20), the matchmaking window, the leaver's 10-minute wait, the 3 / 6 rematch farming limits and the leaderboard rules (10 games, 90 days) are sensible first guesses. Watch real play and tune them (`server/src/ranking/`).
- **Age check strength:** 18+ is a confirmation tick box. Decide with a lawyer whether your markets need more, and set the store age ratings to 17+ / Mature.
- **Throw feel:** the wind strength, the forgiving 3° straight zone, the push per degree and the shaky-arm timing are first guesses (`throwing-controls.md`). Tune them in the first greybox play test.
- **Ads, still to do:** add the consent screen (EU/UK) and Apple's tracking prompt to the app with AppLovin MAX.
- **Match history limit:** keep forever, or delete after N months.
