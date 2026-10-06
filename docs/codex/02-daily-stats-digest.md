# Outline 2 — Daily stats digest to Discord/Slack (all games)

## In plain words

Every morning one message lands in the owner's Discord (or Slack) channel summing up yesterday for **each iPlay game**:

```
📊 iPlay — Mon 5 Oct 2026 (UTC)

🌽 iPlay Cornhole
  Players: 1,284 (▲ 12% vs last Mon)   New: 213 (41 linked Apple/Google)
  Matches: 3,902 (ranked 1,120 · friends 806 · bots 1,976)   Avg length 7m 40s
  Abandoned/forfeit: 3.1%   Peak live: 88 at 20:40
  Reports: 9 new, 4 open   Deletion requests: 1 open
  Errors: 2 app crashes (top: NullReferenceException in CornholeApp.Update ×14)
  Season 1: 57 days left

🎲 iPlay Street Dice
  …

⚠️ Needs you: Cornhole has 4 open reports older than 48h.
```

Example of why it matters: if "New" drops to 20 one day after an app update, the owner knows something broke in
sign-up before reviews start saying so.

## Architecture

- Each game server adds **one endpoint**: `GET /admin/stats/daily?date=YYYY-MM-DD` (part of the game admin contract,
  see Outline 1). It computes numbers for that UTC day from its own database.
- **One digest job** (lives in the dashboard project from Outline 1, or a tiny standalone script) runs daily at
  ~07:05 UTC: calls every game in `GAMES`, formats one message, posts to `DIGEST_WEBHOOK_URL`.
- If a game does not answer, the digest still posts, with "🔴 Street Dice: no answer (timeout)" for that game.
- Reuse the posting logic in `server/src/alerts.ts` (it already detects Discord vs Slack webhook URLs and sends
  `{content}` or `{text}`). Discord's limit is 2,000 characters per message — split per game if longer.

## `GET /admin/stats/daily`

Query: `date` (UTC day, default yesterday; must not be today or in the future; max 400 days back).
Response — the **shared** part every game returns, plus a free-form `extra` for game-specific lines:

```json
{
  "game": "cornhole",
  "gameName": "iPlay Cornhole",
  "date": "2026-10-05",
  "players": 1284,               // distinct accounts that finished ≥1 match that day
  "newAccounts": 213,
  "newLinkedAccounts": 41,       // new accounts that linked Apple/Google that day
  "matches": 3902,
  "matchesByKind": { "ranked": 1120, "friends": 806, "bots": 1976 },
  "avgMatchSeconds": 460,
  "abandonedRate": 0.031,        // (forfeit + abandoned) / matches
  "peakLive": { "matches": 88, "at": "2026-10-05T20:40:00Z" },
  "reports": { "new": 9, "open": 4, "openOver48h": 4 },
  "deletionRequests": { "new": 1, "open": 1 },
  "appErrors": { "total": 16, "top": [{ "message": "NullReferenceException", "where": "CornholeApp.Update", "count": 14 }] },
  "deletedAccounts": 2,
  "extra": [ "Season 1: 57 days left" ]
}
```

Rules:
- **No personal data** in the digest: counts only, never names, emails, ids or report text.
- Numbers must be computable from tables that already exist where possible. Cornhole mapping:
  - `players`: `SELECT count(DISTINCT account_id) FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE m.ended_at in day AND mp.kind='human'`
  - `newAccounts`: `accounts.created_at` in day. `newLinkedAccounts`: `identities.created_at` in day (distinct account).
    (Accounts deleted later in the day are not counted — acceptable.)
  - `matches`, `avgMatchSeconds` (`ended_at - started_at`), `abandonedRate`: `matches` with `outcome`.
  - `matchesByKind`: from `matches.config` (ranked flag / any bot seat in `match_players.kind='bot'` / otherwise friends).
  - `reports`: `reports.created_at` / `status`. `deletionRequests`: `deletion_requests`.
  - `extra`: current season from `SeasonService.current()` (`server/src/ranking/seasons.ts`).
- **Needs small additions in Cornhole:**
  - `peakLive`: the registry only knows "now". Add a tiny sampler (every minute, keep today's max in memory and
    persist yesterday's max in a new `daily_counters (day date, key text, value int, at timestamptz)` table).
  - `appErrors`: app error reports are only logged today (`clientError: true` log lines). Add a
    `app_error_daily (day, message, where, count)` upsert in the error-report route; keep 30 days.
  - `deletedAccounts`: count in `daily_counters` when an account is deleted (the row itself is gone).
- Indexes exist for `matches.ended_at`; add one on `accounts(created_at)` if the query is slow at scale.
- Day boundaries are **UTC** everywhere. The message header says "(UTC)".

## Digest message rules

- Compare against the same weekday last week (▲/▼ with %), not yesterday (weekends differ).
- "⚠️ Needs you" section only when something is actionable: reports open > 48 h, deletion requests open > 7 days
  (legal deadline is 30 days), a game not answering, error count > 3× last week's same day.
- If everything is zero for a game (not launched yet), print one line "no activity".
- Config: `DIGEST_WEBHOOK_URL`, `DIGEST_HOUR_UTC` (default 7), `GAMES` (shared with the dashboard).
- Also expose `POST /digest/run?date=` (owner only) to resend a day, and a `--dry-run` CLI that prints the message.

## Acceptance criteria

- [ ] `GET /admin/stats/daily` in Cornhole with vitest tests on both Postgres and PGlite (`describe.each(backends)`
      pattern used across `server/test/`), seeded with matches across a day boundary to prove UTC cut-offs.
- [ ] Rejects today/future dates and bad formats with `400 bad_request`; requires the admin token.
- [ ] Response contains no account ids, names or free text from players (test asserts on the JSON).
- [ ] Digest posts exactly once per day even if the job restarts (store "last posted day"; skip if already posted).
- [ ] One game timing out (3 s) does not stop the others; its section says so.
- [ ] Message stays under 2,000 chars per post for Discord (split otherwise); Slack format also tested.
- [ ] Dry-run output is snapshot-tested.

## Rollout

1. Cornhole endpoint + counters → deploy to staging, call it by hand.
2. Digest job with `--dry-run`, then point it at a private test channel for a week.
3. Switch to the real channel; add each new game as it implements the endpoint.
