# What The Game Stores About People

This is a plain map of the data the server holds, so you can write an accurate privacy policy and answer the app stores' data questions. **It is not legal advice.** Have a lawyer read your policy before launch, especially if children can play.

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
| **Blocks** a player made | `blocks` | So the app can mute people | Until unblocked or deleted |
| **Reports** a player filed: who, the match, the reason, an optional note (up to 500 characters) | `reports` | Moderation | Kept until deleted by staff; the reporter link is removed if the reporter deletes their account |
| **Bans**: reason and end date | `accounts` | Enforcing bans | Until lifted or the account is deleted |
| **Live matches** while running | `live_matches` | Surviving a server restart | Deleted when the match ends (and anything over 2 hours old at startup) |
| **Server logs** | your log host | Debugging | Your log host's retention. The `Authorization` header is never logged. |

## What the game does **not** store

- **No email address, phone number, real name, birthday, address or location.** The server never reads the email that Apple or Google include in a sign-in.
- **No passwords.** Sign-in is Apple, Google, or an anonymous guest.
- **No payment information and no money of any kind.** There are no wagers.
- **No voice recordings.** Voice chat (when added) goes through a voice provider, not this server. Check what that provider stores.
- **No IP addresses in the database.** IP addresses are used in memory for rate limiting and appear in your host's request logs.
- **No advertising identifiers or analytics** in the server.

## Players' rights (what is built)

- **Delete my account:** `DELETE /api/me`, meant for a button in the app (Apple **requires** this). It immediately removes the account, sign-in links, sessions, stats and blocks. Their old matches stay in other players' history, with their name replaced by "Deleted player" and no link back to them.
- **Get a copy of my data:** `GET /api/me/export` returns the account, sign-in methods (provider names only), stats, match history, blocks and reports they filed.
- **Rename:** `PATCH /api/me`.
- **Match history retention:** finished matches are kept indefinitely (they belong to all four players). If you want a limit, add a scheduled job that deletes matches older than N months. That is not built.

## Who can see what

- **Other players in a match** see your display name, seat, character and account id (an opaque number the app needs for blocking and reporting).
- **Anyone who has a match code** can watch a match and see the same.
- **Staff with the admin token** can see account lookups, reports, and bans.
- **Nobody** can see another player's stats, history, blocks or sign-in methods through the API.

## For the app stores and your policy

- **Apple App Privacy / Google Data Safety:** you collect *identifiers* (an account id, and Apple/Google's user id), *user content* (a display name, optional report notes) and *gameplay data* (match results). None of it is linked to advertising. You do not collect contact info, location or purchases.
- **Apple requirements:** offer Sign in with Apple if you offer Google; provide in-app account deletion (done).
- **Children:** if children under 13 (US COPPA) or under 16 (EU/UK, varies) can play, you have extra obligations: parental consent, no unnecessary data, and a policy written for it. The simplest route is a **13+ minimum age** in the store listing and the terms. Ask a lawyer before deciding. An age gate in the app is not built.
- **User-generated content and voice:** stores expect a way to **report** and **block** (built) and to act on reports (the staff API, built). Have a written process for how quickly reports are reviewed.
- **No gambling:** because there are no wagers or purchases, the game should not fall under gambling rules. If you later add cosmetic purchases, revisit this.
