# Outline 1 — iPlay admin dashboard (all games, one private page)

## In plain words

Today, handling a player report in Cornhole means typing `curl` commands with a secret token. This builds a private
website (for example `admin.iplay.games`) where the owner logs in once and sees, for **every iPlay game**:

- Is each game's server up? How many matches are live right now? Is maintenance mode on?
- Open player reports → look at the reported player → ban for N days / permanently, or dismiss.
- Website deletion requests → find the account → delete it → mark the request done.
- Search a player by name, see their stats, unban them.
- Flip maintenance mode before an update.

Example: a Cornhole player reports "TrashTalker99" for harassment. The owner opens the dashboard on their phone, taps
the report, sees TrashTalker99 has 4 reports against them, taps "Ban 7 days" and types a reason. Done — no terminal.

## Non-goals (v1)

- No player-facing pages. Owner (and later a few moderators) only.
- No editing game balance or economy.
- No direct database access from the dashboard — it only talks to each game's admin API.

## Architecture

```
Browser ──HTTPS──▶ Dashboard app (one deploy) ──HTTPS + per-game ADMIN_TOKEN──▶ Cornhole server  /admin/*
                         │                                                    ─▶ Street Dice server /admin/*
                         └─ its own small DB (dashboard users, sessions, audit) ─▶ future games…
```

- **The browser never sees a game's `ADMIN_TOKEN`.** The dashboard server holds them and proxies calls.
- Games are listed in config, e.g. `GAMES='[{"id":"cornhole","name":"iPlay Cornhole","url":"https://api.cornhole.iplay.games","token":"…"}, …]'`
  (tokens from env/secrets, never committed).
- Suggested stack: Node 22 + TypeScript + Fastify (same as the game servers) serving a small server-rendered or
  React/Vite UI. Postgres or SQLite for the dashboard's own tables. Docker image, deployed next to the games
  (see `docs/hetzner-deploy.md` for the existing compose/nginx pattern).

## Game admin contract v1

Every game server implements these under `/admin`, authenticated with `Authorization: Bearer <ADMIN_TOKEN>`
(constant-time compare, minimum 32 chars, admin routes return 404 when the token is not configured). Errors use the
games' usual shape `{ "error": { "code": "...", "message": "..." } }`. Every write is audit-logged on the game side.

| Method & path | Body / query | Returns | Cornhole today |
|---|---|---|---|
| `GET /admin/status` | — | `{ game, version, liveMatches, maintenance, accounts, openReports, openDeletionRequests, startedAt }` | Has `liveMatches, maintenance, accounts, openReports`. **Add** `game`, `version`, `openDeletionRequests`, `startedAt`. |
| `GET /admin/accounts?name=` | name 1–40 chars | `{ accounts: [{ id, displayName, isGuest, createdAt, lastSeenAt }] }` | Done (exact, case-insensitive). **Add** optional `?id=` and prefix search. |
| `GET /admin/accounts/:id` | — | `{ account: { id, displayName, status, banReason, bannedUntil, createdAt, lastSeenAt }, stats, activeMatchId, reportsAgainst }` | Done. `stats` is game-specific — dashboard shows it as a key/value table. |
| `POST /admin/accounts/:id/ban` | `{ reason, days? }` (no days = permanent) | `{ account }` | Done. Takes effect immediately (kicks from match, drops cached session). |
| `POST /admin/accounts/:id/unban` | — | `{ account }` | Done. |
| `POST /admin/accounts/:id/delete` | — | `{ deleted: true }` | Done. |
| `GET /admin/reports?status=open` | status, limit, offset | `{ reports: [{ id, reason, note, status, createdAt, reporter{id,name}, reported{id,name}, matchId }] }` | Done (check field names match). |
| `POST /admin/reports/:id` | `{ status: "resolved"\|"dismissed", note? }` | `{ id, status }` | Done. |
| `GET /admin/deletion-requests?status=open` | status | `{ requests: [...] }` | Done. |
| `POST /admin/deletion-requests/:id` | `{ status: "done"\|"rejected", note? }` | `{ id, status }` | Done. |
| `POST /admin/maintenance` | `{ enabled }` | `{ maintenance }` | Done. |
| `GET /admin/stats/daily?date=YYYY-MM-DD` | see Outline 2 | daily numbers | **New** (Outline 2). |
| `GET /admin/contract` | — | `{ version: 1, features: ["reports","deletion","maintenance","stats.daily", …] }` | **New.** Lets the dashboard hide buttons a game does not support. |

Once the iPlay account exists (Outline 7), bans and deletes move to the account service and the per-game ban becomes
"ban from this game only". Keep both buttons.

## Dashboard features (v1)

1. **Home** — one card per game: up/down (status call succeeds within 3 s), version, live matches, open reports,
   open deletion requests, maintenance badge. Auto-refresh every 30 s.
2. **Reports inbox** — merged list across games, newest first, game badge on each. Open one → reporter, reported
   player (with link to their account page), reason, note, match id. Actions: Ban (1/7/30 days/permanent + reason),
   Resolve, Dismiss.
3. **Player page** — search by name (all games at once) or id. Shows account, stats table, reports against, active
   match. Actions: ban/unban/delete (delete needs typing the display name to confirm).
4. **Deletion requests** — list; "Find account" pre-fills a search; "Delete & mark done" does both calls in order and
   only marks done if the delete succeeded.
5. **Maintenance** — toggle per game, with a confirm dialog ("players can finish their match, no new ones start").
6. **Audit log** — every dashboard action: who, when, game, action, target, result. Stored in the dashboard DB
   (the game also logs it, so there are two records).

## Security (must-haves)

- Login: email + password (argon2id) **plus TOTP 2FA required**, or "Sign in with Google" restricted to an allow-list
  of emails. No public sign-up — users are created by a CLI command.
- Session cookie: `HttpOnly; Secure; SameSite=Strict`, 12-hour idle timeout. CSRF token on every POST.
- Rate-limit login (5 tries / 15 min / IP + per user). Lock after 10 failures, alert to the chat webhook.
- Roles: `owner` (everything), `moderator` (reports + bans up to 30 days, no deletes, no maintenance).
- Game tokens only in server env; never logged; never sent to the browser.
- Strict CSP, no third-party scripts. Serve only over HTTPS. Optional: put the whole site behind an IP allow-list or
  Cloudflare Access as a second wall.
- Every write action is audit-logged before the call and updated with the result after.

## Acceptance criteria

- [ ] Adding a game = adding one entry to `GAMES`; no code change.
- [ ] A game that is down shows "down" on its card and does not break the other cards or the merged inbox.
- [ ] Banning from a report kicks the player from a live match within a second (verify against a local Cornhole server).
- [ ] A moderator cannot delete accounts or toggle maintenance (server-side check, not just hidden buttons).
- [ ] No game token appears in any HTTP response, HTML, JS bundle or log line (test greps for it).
- [ ] Login requires 2FA; 10 bad passwords lock the user and post an alert.
- [ ] Integration tests run the dashboard against a real Cornhole server started in the test (`server/` has
      `npm run build` + `node dist/index.js`; see `Tools/CoreTests` for how the live tests start one).
- [ ] Works on a phone screen (the owner will use it on the go).

## Rollout

1. Implement the contract gaps in Cornhole (`/admin/status` fields, `/admin/contract`) with tests in `server/test/`.
2. Build the dashboard against Cornhole staging (`./deploy.sh --staging`, see `docs/hetzner-deploy.md`).
3. Add Street Dice once it implements the contract.
4. Deploy at `admin.<domain>` with its own nginx block and certificate; create the owner user via CLI.
