# Running The Server

Plain-language guide for whoever deploys and looks after the game server.

## What it needs

- **Node 20 or newer** (the Docker image uses 22).
- **A PostgreSQL database** (version 14 or newer; tested on 16). Accounts, results and live matches all live there. Any hosted Postgres works (Neon, Supabase, RDS, Cloud SQL, Render, Fly Postgres…).
- **One server instance** at a time (see **Scaling** below).

The server creates and updates its own database tables when it starts. You never run migrations by hand.

## Settings (environment variables)

Everything has a safe default except the database in production.

| Variable | Default | What it does |
|----------|---------|--------------|
| `NODE_ENV` | development | Set `production` in production. Then the server **refuses to start** without a `postgres://` database. |
| `DATABASE_URL` | in-memory (dev only) | `postgres://user:pass@host:5432/dbname`. For local development you can use `pglite://./.data` (a database in a folder, no install needed). |
| `DATABASE_SSL` | false | Set `true` if your database provider requires TLS. |
| `PORT` / `HOST` | 3000 / 0.0.0.0 | Where it listens. |
| `PUBLIC_BASE_URL` | http://localhost:3000 | The address invite links use, for example `https://play.iplay.example`. **Set this to your real address.** |
| `MIN_CLIENT_VERSION` | 0.0.0 (off) | Apps older than this are told to update. |
| `LATEST_CLIENT_VERSION` | same as min | Shown to apps that need to update. |
| `IOS_STORE_URL` / `ANDROID_STORE_URL` | none | Store links for the update screen and the invite page. |
| `APPLE_CLIENT_IDS` | none (off) | Your app's bundle id (and service id, comma separated). Turns on Sign in with Apple. |
| `GOOGLE_CLIENT_IDS` | none (off) | Your Google OAuth client ids, comma separated. Turns on Google sign-in. |
| `ALLOW_GUESTS` | true | Set `false` to require Apple/Google. |
| `ALLOW_MISSING_NONCE` | false | Leave off. |
| `ADMIN_TOKEN` | none (admin off) | A long random secret (32+ characters) that unlocks the staff API. |
| `APPLE_TEAM_ID`, `IOS_BUNDLE_ID` | none | Lets iPhones open invite links straight in the app. |
| `ANDROID_PACKAGE`, `ANDROID_CERT_SHA256` | none | Same for Android (fingerprints comma separated). |
| `DEEP_LINK_SCHEME` | iplaycornhole | The app's own link scheme. |
| `TRUST_PROXY` | false | Set `true` behind a load balancer so rate limits see real client addresses. |
| `RATE_LIMIT_PER_MIN` | 300 | Requests per minute per address. Sign-ups, creating matches and reports have tighter limits built in. |
| `MAX_MATCHES` | 5000 | Live matches before new ones get "server busy". |
| `MAINTENANCE` | false | Start with new matches switched off. |
| `OWNERSHIP_WAIT_SEC` | 90 | How long a new server waits for the old one during a deploy. |
| `RESTORE_MAX_AGE_MIN` | 120 | Saved matches older than this are dropped at startup instead of restored. |
| `LOG_LEVEL` | info | `debug` for more, `warn` for less. |
| `REQUIRE_ADULT_CONFIRMATION` | true | New accounts must confirm they are 18+. Turn off only for a private test server. |
| `TERMS_VERSION` | 1 | Raise it when the terms change: the app then asks everyone to accept again before ranked or voice. |
| `VIVOX_ISSUER`, `VIVOX_DOMAIN`, `VIVOX_SIGNING_KEY`, `VIVOX_UNITY_ENVIRONMENT_ID` | none (voice off) | Unity Vivox voice chat. **All four or none.** The `IPLAY_VIVOX_*` / `IPLAY_UNITY_ENVIRONMENT_ID` names the other iPlay games use are accepted too. |
| `ADS_ENABLED` | false | Tells the app it may show ads. |
| `ADS_INTERSTITIAL_EVERY_N_MATCHES` | 3 | One interstitial per this many finished matches. |
| `ADS_MIN_SECONDS_BETWEEN_INTERSTITIALS` | 180 | And never closer together than this (30 to 3600). |
| `ADS_MENU_BANNER` | true | A banner on menu screens (never while playing). |

An empty value (`FOO=` in an env file) counts as not set.

Copy `server/.env.example` as a starting point.

## Running it

```bash
cd server
npm ci
npm run build
NODE_ENV=production DATABASE_URL=postgres://… PUBLIC_BASE_URL=https://… npm start
```

Or with Docker (the image runs as a normal user and has a health check on `/health`):

```bash
docker build -t iplay-cornhole-server server
docker run -p 3000:3000 -e NODE_ENV=production -e DATABASE_URL=postgres://… -e PUBLIC_BASE_URL=https://… iplay-cornhole-server
```

Health checks for your host or load balancer:

- `GET /health` says the process is up.
- `GET /ready` also checks the database. Use this for "send traffic here".

Put the server behind HTTPS (your host or a load balancer does this) and set `TRUST_PROXY=true`.

## Deploying an update without kicking anyone out

Live matches are saved to the database and picked up again by the new server, so a normal deploy loses nothing. The steps:

1. **Optional, gentlest:** turn on maintenance so nobody starts a match right as you restart.
   `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"enabled":true}' https://…/admin/maintenance`
2. **Start the new version.** It connects and then **waits** (up to `OWNERSHIP_WAIT_SEC`, 90 s by default) because only one server can own the live matches at a time. It does not answer requests yet.
3. **Stop the old version with a normal stop signal** (`SIGTERM`, which Docker, Kubernetes, Render, Fly and systemd all send). The old server stops new matches, tells every phone "I'm restarting, reconnect" (close code 1012), **saves every live match**, lets go of ownership, and exits.
4. The new server takes over within a second, **restores every live match**, and starts answering. Phones reconnect on their own and games carry on. Everyone gets the usual 30 seconds to get back before a bot takes their seat.
5. Turn maintenance back off if you turned it on. (A fresh server starts with it off unless `MAINTENANCE=true`.)

Tips:

- Give your host a **stop timeout of at least 30 seconds** so the old server has time to finish saving.
- Route traffic to the new server only when `/ready` passes. Because the new one only answers after it has taken over and restored, this happens on its own.
- **If the server is killed hard** (crash, power loss, out of memory): matches come back from the last save, which is at most about a quarter of a second old.
- **If the new server can't start** (for example the database is unreachable), the old one keeps running until you stop it. Nothing is lost.
- **Rolling back** is the same as deploying: start the old version, stop the new one. Database changes only ever add things, and a server refuses to start against a database from a *newer* version (it says so). If you need to roll back past a database change, roll forward with a fix instead.

## When something goes wrong

| Symptom | What it means and what to do |
|---------|------------------------------|
| Server exits with "Another server instance owns the live matches" | The old server hasn't let go within the wait. Check it stopped. If it is really gone, the database drops its lock by itself when the connection closes. Just start the new one again. |
| Server logs "lost ownership of live matches … shutting down" and exits | Its database connection dropped, so it stopped itself on purpose (so two servers can never run the same matches). Your host should restart it. |
| Logs "could not restore a live match, discarding it" | A saved match was damaged or from an incompatible version. It is deleted so it can't keep failing. The players in it lose that one match. Everything else is restored. |
| Logs "could not save match history" with a big JSON blob | The database was down when a match ended, even after retrying. The blob is the full result: keep it. Once the database is back, that match's history and stats are missing until someone adds them by hand. |
| Logs "could not save live match" | A save failed (usually a database blip). It retries at the next change. If the server dies before then, that match may come back slightly older. |
| `/ready` fails but `/health` works | The database is unreachable. Fix the database. Live matches keep running in memory in the meantime. |
| Players say "server busy" | `MAX_MATCHES` reached. Raise it, or check whether matches are being created in a loop. |
| Startup fails with "Migration N was edited after it was applied" | Somebody edited an old migration. Put it back and add a new one instead. |
| Startup fails with "Database is at migration N, which this server does not know" | You started an older version against a newer database. Deploy the newer version. |

## Moderation (staff API)

Everything under `/admin` needs `Authorization: Bearer <ADMIN_TOKEN>`. Without `ADMIN_TOKEN` set, these addresses don't exist. Every admin action is logged (`"admin":true`) with the action and the account, never anything personal.

Reviewing reports:

```bash
# what needs a look (oldest first)
curl -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/admin/reports?status=open"

# look at the account behind a report
curl -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/admin/accounts/<accountId>"

# ban for 7 days (leave "days" out for permanent). They are pulled out of their match at once.
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"reason":"harassment in voice chat","days":7}' "$BASE/admin/accounts/<accountId>/ban"

# lift it
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/admin/accounts/<accountId>/unban"

# close the report
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"status":"resolved"}' "$BASE/admin/reports/<reportId>"
```

A banned person gets a clear "banned" message with the reason and end date on every call, and cannot sign in again. Temporary bans lift themselves. A ban follows the account, so a banned player can make a new guest account. Sign-ups are rate limited, and requiring Apple/Google (`ALLOW_GUESTS=false`) makes evasion harder.

`GET /admin/status` shows live matches, accounts and open reports.

## Hosting on your Hetzner box

See **`docs/hetzner-deploy.md`** and the `deploy/` folder: docker-compose (game + its own Postgres), Caddy and nginx snippets, `deploy.sh`, `backup.sh`, `restore.sh`.

## Ranked play and leaderboards

- Ratings are saved in the **same database transaction** as the match result, so a rating can never change without the match being recorded (or the reverse). Saving the same match twice changes nothing.
- The matchmaking queue and parties live **in memory**. A restart empties them; players just tap search again. Running ranked matches are saved and restored like any other.
- `ranked_cooldowns` holds the 10-minute wait after walking out of a ranked match. To lift one by hand: `DELETE FROM ranked_cooldowns WHERE account_id = '…';`.
- To remove a cheater from the boards, ban them (they disappear at once, and return if unbanned). To wipe a rating: `DELETE FROM singles_ratings WHERE account_id = '…';` (teams: `DELETE FROM duo_ratings WHERE member_a = '…' OR member_b = '…';`).
- `underage` reports arrive in the same report list. Ban the account (`/admin/accounts/:id/ban`).

## Backups

The database is the only thing worth backing up. Turn on **daily backups and point-in-time recovery** with your database provider. That covers accounts, stats and history. Live matches are short-lived and don't need special treatment.

## Scaling

**One server instance owns all live matches, in memory, and saves them to the database.** That is deliberate and it is simple, but it means:

- You can't run two copies at once (the second waits for the first to stop). One decent server handles many concurrent matches: the whole physics for a throw is a few milliseconds, and the soak test plays about 24,000 throws in a few seconds on a single core. It has **not been load-tested**, so measure before you promise a number.
- To go beyond one machine you'd split matches across servers by match code and share connection state (Redis or similar). That is not built.
- Restarts are safe (see above) but not instant: players see "reconnecting" for a few seconds.

## Watching it

Logs are JSON, one line per event (request ids included, the `Authorization` header is never logged). Send them to your host's log search. Useful things to alert on:

- the server process restarting more than a couple of times an hour
- `/ready` failing for more than a minute
- log lines at `error` level: `could not save match history`, `could not restore a live match`, `lost ownership`
- database connection count near its limit (the server uses at most 10)

## Sign-in setup (when the apps exist)

- **Apple:** set `APPLE_CLIENT_IDS` to the app's bundle id. The app must send a random `nonce` when it starts Sign in with Apple and pass the same one to `/api/auth/apple`. Apple requires Sign in with Apple to be offered when you offer another third-party login, and requires in-app **account deletion**, which `DELETE /api/me` provides.
- **Google:** create OAuth client ids in Google Cloud, set `GOOGLE_CLIENT_IDS` to them (iOS, Android and web ids all count).
- **Invite links:** set `PUBLIC_BASE_URL`, then `APPLE_TEAM_ID` + `IOS_BUNDLE_ID` and `ANDROID_PACKAGE` + `ANDROID_CERT_SHA256`. The server then publishes `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` so links open in the app. The app must also declare the domain (Associated Domains on iOS, an intent filter on Android).

The identity checks talk to Apple's and Google's public key servers. The code for that is tested with locally made keys, but **has never been run against the real Apple and Google servers** because they can't be reached from where it was built. Test a real sign-in on a real device before launch.
