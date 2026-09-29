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
- **Bag logo:** the iPlay "i▶" mark, extracted from the app icon (`assets/logo/`).
- **Hole sound:** an original game-show ring-in (not the TV show's audio), with two alternates to pick from.
- **Flash speed:** capped at 3 flashes a second, with a reduced-motion version.

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
- **Hosting and budget:** where the server and database run (the code runs anywhere that has Node or Docker and Postgres).
- **Minimum age:** 13+ avoids most children's privacy rules (see `data-and-privacy.md`); confirm with a lawyer.
- **Ranked play and leaderboards:** stats are recorded already; a ranking system is not built.
- **Purchases (for example cosmetic bag colors or boards):** none today. Adding any changes the store paperwork.
- **Match history limit:** keep forever, or delete after N months.
