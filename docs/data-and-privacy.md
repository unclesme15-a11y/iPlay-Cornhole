# What The Game Stores About People

This is a plain map of the data the server holds, so you can write an accurate privacy policy and answer the app stores' data questions. **It is not legal advice.** Have a lawyer read your policy before launch.

## The data

| What | Where | Why | How long |
|------|-------|-----|----------|
| **Display name** the player chose (or `Player4821`) | `accounts` | Shown to other players in a match | Until they change it or delete the account |
| **An anonymous account id** | `accounts` | Identifies the player | Until the account is deleted |
| **Guest or full account** flag, created date, last seen | `accounts` | Account management | Until deleted |
| **Apple / Google sign-in link**: only the provider's id for the person | `identities` | So the same person gets the same account on a new phone | Until deleted |
| **Login sessions**: a hash of the token (never the token), when it was made and last used, the phone platform (`ios`/`android`) and app version | `sessions` | Keeping people signed in; support | 90 days after last use, or until logout/deletion |
| **Match results**: who played, seats, scores, and per-player throws, holes, boards and fouls | `matches`, `match_players` | Match history and stats | Kept (see below) |
| **Running totals**: games, wins, losses, leaves, throws, holes, boards, fouls | `player_stats` | The stats screen | Until the account is deleted |
| **18+ confirmation** (the time they confirmed) and the **terms version** they accepted | `accounts` | Every iPlay game is for adults; proving they were asked | Until the account is deleted |
| **Ranked ratings**: singles rating, and one rating per pair of partners (both account ids), with peak, wins, losses, streak, last played | `singles_ratings`, `duo_ratings` | Ranked play and leaderboards | Until the account is deleted (a duo's rating goes when either partner deletes) |
| **Rating before and after** each ranked match | `match_players` | The results screen and history | Kept with the match, no link to a deleted account |
| **Leaderboard visibility** choice | `accounts` | Lets a player hide from public boards | Until the account is deleted |
| **Ranked cooldown** (after walking out of a match) | `ranked_cooldowns` | Fairness | Until it ends, or the account is deleted |
| **Blocks** a player made | `blocks` | So the app can mute people | Until unblocked or deleted |
| **Reports** a player filed: who, the match, the reason, an optional note (up to 500 characters) | `reports` | Moderation | Kept until deleted by staff; the reporter link is removed if the reporter deletes their account |
| **Bans**: reason and end date | `accounts` | Enforcing bans | Until lifted or the account is deleted |
| **Live matches** while running | `live_matches` | Surviving a server restart | Deleted when the match ends (and anything over 2 hours old at startup) |
| **Server logs** | your log host | Debugging | Your log host's retention. The `Authorization` header is never logged. |

## What the game does **not** store

- **No email address, phone number, real name, birthday, address or location.** The server never reads the email that Apple or Google include in a sign-in.
- **No passwords.** Sign-in is Apple, Google, or an anonymous guest.
- **No payment information and no money of any kind.** There are no wagers.
- **No voice recordings.** Voice chat goes through Unity Vivox, not this server. The server only makes a short-lived token that names the player by their **account id** (never their name). Check what Vivox stores in their terms.
- **No date of birth.** The game asks "I am 18 or older" and stores the time they said yes, nothing more.
- **No IP addresses in the database.** IP addresses are used in memory for rate limiting and appear in your host's request logs.
- **No advertising identifiers or analytics in the server.** The **phone** runs the ad SDK, and that SDK collects its own data (see below).

## Players' rights (what is built)

- **Delete my account:** `DELETE /api/me`, meant for a button in the app (Apple **requires** this). It immediately removes the account, sign-in links, sessions, stats and blocks. Their old matches stay in other players' history, with their name replaced by "Deleted player" and no link back to them.
- **Get a copy of my data:** `GET /api/me/export` returns the account, sign-in methods (provider names only), stats, match history, blocks and reports they filed.
- **Rename:** `PATCH /api/me`.
- **Match history retention:** finished matches are kept indefinitely (they belong to all four players). If you want a limit, add a scheduled job that deletes matches older than N months. That is not built.

## Who can see what

- **Anyone signed in** can see the **public leaderboards**: display name, account id, rating, games, wins, losses and streak of players with 10+ ranked games who have not opted out. For teams, both partners' names. Players can hide themselves (`showOnLeaderboards`).
- **Other players in a match** see your display name, seat, character and account id (an opaque number the app needs for blocking and reporting). Ranked opponents also see your rating change on the results screen.
- **Anyone who has a match code** can watch a match and see the same.
- **Staff with the admin token** can see account lookups, reports, and bans.
- **Nobody** can see another player's stats, history, blocks or sign-in methods through the API.

## For the app stores and your policy

- **Apple App Privacy / Google Data Safety:** you collect *identifiers* (an account id, and Apple/Google's user id), *user content* (a display name, optional report notes) and *gameplay data* (match results). None of it is linked to advertising. You do not collect contact info, location or purchases.
- **Apple requirements:** offer Sign in with Apple if you offer Google; provide in-app account deletion (done).
- **Ads (the only income):** the ad SDK on the phone collects device and advertising identifiers and usage data, and shares it with ad networks. In the App Privacy / Data Safety forms you must declare **identifiers (advertising ID), usage data and coarse location (from IP)** for third-party advertising, and iOS needs the **App Tracking Transparency** prompt before personalised ads. In the EU/UK you need a **consent screen (a certified CMP)** before ads load. Update your privacy policy to name the ad provider. Because every player is an adult, you can (and should) turn off the child-directed settings; do not mark the app as directed to children.
- **Adults only (18+):** every iPlay game is for adults, because voice chat is not filtered. That avoids most children's-privacy rules (COPPA, the UK Children's Code), but only if it is real: set the **store age rating to 17+ / Mature (Apple) and Mature 17+ (Google)**, say 18+ in the terms, and keep the sign-up confirmation (built: `confirmAdult`). A tick box is not proof of age. Expect some minors to click it, so act on `underage` reports (built: it is a report reason) by banning the account. Do not add features that attract children. Ask a lawyer whether you also want a stronger age check for your markets.
- **User-generated content and voice:** stores expect a way to **report** and **block** (built) and to act on reports (the staff API, built). Voice is unfiltered, so the phone must mute blocked players (the server tells it who) and show a report button. Have a written process for how quickly reports are reviewed. Public leaderboards show display names, which pass the same name filter as everywhere else.
- **No gambling:** because there are no wagers or purchases, the game should not fall under gambling rules. If you later add cosmetic purchases, revisit this.
