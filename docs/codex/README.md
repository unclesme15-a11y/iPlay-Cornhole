# Codex build outlines (cross-game iPlay work)

These are implementation outlines for work that spans **every iPlay game**, not only Cornhole.
They are written so a coding agent (Codex or similar) can pick one up and build it without this chat.

| # | Outline | What it is, in one line |
|---|---------|-------------------------|
| 1 | [01-admin-dashboard.md](01-admin-dashboard.md) | One private web page where the owner sees every game's reports, bans, deletion requests and health. |
| 2 | [02-daily-stats-digest.md](02-daily-stats-digest.md) | One message a day in Discord/Slack: players, matches, new sign-ups and problems, per game. |
| 7 | [07-iplay-account.md](07-iplay-account.md) | One iPlay login shared by all games (same name, same ban, one place to delete). |

Numbers match the owner's list (3–6 — staging, ranked seasons, security autopilot, push — are already built into the
Cornhole server on branch `claude/cornhole-game-prototype-p9nt6j`).

## The one rule that ties them together: the "iPlay game contract"

Every iPlay game server (Cornhole, Street Dice, and future games) exposes the **same small set of admin endpoints with
the same JSON shapes**. Then the dashboard (1) and the digest (2) only have to know a list of game URLs and tokens —
adding a new game is one line of config, not new code.

The contract is defined in `01-admin-dashboard.md` § "Game admin contract v1" and extended in `02-daily-stats-digest.md`
§ "`GET /admin/stats/daily`". The Cornhole server already implements most of v1; the gaps are listed in each outline.

## Build order

1. **Contract first** — add the missing endpoints to each game server (small, testable, no UI).
2. **Digest (2)** — the smallest end-to-end proof that the contract works across games.
3. **Dashboard (1)** — UI on top of the same contract.
4. **iPlay account (7)** — the biggest change; do it before a second game launches publicly, because moving players
   later is harder than starting them on it.

## Where the reference implementation lives

- Cornhole server: `server/` (TypeScript, Node 22, Fastify 5, zod, Postgres; tests with vitest against real Postgres and PGlite).
- Admin routes: `server/src/http/routes/admin.ts` (bearer `ADMIN_TOKEN`, every action audit-logged).
- Chat alerts: `server/src/alerts.ts` (`ALERT_WEBHOOK_URL`, Discord or Slack, rate-limited per kind).
- Database tables: `server/src/db/migrations.ts`.
- Auth: `server/src/accounts/` (Apple/Google identity tokens, guest accounts, sessions stored as SHA-256 hashes).
