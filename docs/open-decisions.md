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
- **Hole sound:** an original game-show ring-in (not the TV show's audio): **the two-bell ding** (`cornhole-hit-alt-ding.wav`).
- **Screen:** landscape only, like Street Dice.
- **Sign-in per phone:** iPhones offer Sign in with Apple, Android phones offer Sign in with Google; guests on both.
- **Ranking numbers:** launch with the current values and tune from real games.
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
- **Match history:** kept indefinitely by default (`MATCH_HISTORY_DAYS` can limit it); a deleted account's name is replaced by "Deleted player".
- **Account deletion without the app:** a web form at `/delete-account`; accounts played in the last 30 days are only deleted from the app (so nobody can delete someone else's).

## Still Open (yours: paperwork, visuals, or the phone test)

- **Vector logo:** an SVG/vector version of the iPlay mark for the final bag print (visuals).
- **Video AI:** Kling as the main tool, with a quick side-by-side test against Veo 3.1 and Seedance 2.0 using the same Plate 1 before generating the full clip set (visuals).
- **Domain name and Storage Box** for the Hetzner box (sign-ups).
- **Age check strength and match-history limit:** decide with a lawyer (the setting for history exists).
- **Throw feel:** the wind strength, the 3° straight zone, the push per degree and the shaky-arm timing are first guesses (`throwing-controls.md`). Tune them in the first real-phone test.
