# Running iPlay Cornhole On Your Hetzner Box

This puts the game next to your other iPlay games without them getting in each other's way. Everything is in the `deploy/` folder.

## The picture

```
phones ──https──▶ your web server (Caddy or nginx, already on the box)
                        │  cornhole.your-domain  →  127.0.0.1:3010
                        ▼
                 ┌─ iplay-cornhole (Docker) ─────────────┐
                 │  game server  ──▶  its own Postgres   │
                 └───────────────────────────────────────┘
```

- The game **only listens on `127.0.0.1:3010`** (change with `APP_PORT`). Nothing is opened to the internet by the game. Your web server is the only door.
- The game has **its own Postgres**, private to it, so a mistake in another game's database can't touch cornhole and the reverse.
- It has **memory and CPU limits** (about 0.6 GB and 1.5 cores for the game, 0.5 GB and 1 core for Postgres) so a busy night in cornhole can't starve the other games. Raise them in `docker-compose.yml` if the box is big.

Think of it like an apartment building: each game is its own flat with its own front door key (its own database), and the web server is the doorman who points visitors to the right flat.

## First time

On the box (Ubuntu or similar with Docker and the compose plugin installed):

```bash
git clone <your repo> /opt/iplay-cornhole && cd /opt/iplay-cornhole/deploy
cp .env.example .env
nano .env
```

Fill in at least:

| Setting | Example |
|---|---|
| `POSTGRES_PASSWORD` | run `openssl rand -hex 24` and paste the result |
| `ADMIN_TOKEN` | run `openssl rand -hex 32` |
| `PUBLIC_BASE_URL` | `https://cornhole.iplaygames.com` (your real address; invite links use it) |
| `APP_PORT` | `3010`, or any free port (each iPlay game gets its own) |

Then:

```bash
./deploy.sh
```

It builds the game, starts Postgres, starts the game, and waits until `http://127.0.0.1:3010/ready` says yes. Test it from the box: `curl http://127.0.0.1:3010/api/meta`.

Then, once:

```bash
sudo ./setup-host.sh --firewall
```

It installs the nightly backup (03:17), makes Docker start when the box boots, and sets the firewall to SSH (the port you are connected on), 80 and 443. It never touches your web server or your other games, is safe to run again, and `--dry-run` shows what it would do first. Leave out `--firewall` if you already use Hetzner's Cloud Firewall. At the end it lists the few things only you can do.

## Point your web server at it

**Domain first:** make a DNS record (an "A record") for `cornhole.your-domain` pointing at the box's IP.

**Caddy** (gets the https certificate for you): add the block from `caddy-snippet.Caddyfile` to your Caddyfile with your domain, then reload Caddy.

**nginx:** copy `nginx-snippet.conf`, change the domain, run `nginx -t && systemctl reload nginx`, then `certbot --nginx -d cornhole.your-domain` (certbot adds the https part itself). The important parts are the **WebSocket lines** (a live match is one long connection) and `proxy_read_timeout 1h`.

**No web server at all yet?** Set `DOMAIN` in `.env` and run `docker compose --profile proxy up -d`. That starts a Caddy that opens ports 80 and 443 and gets the certificate itself.

Check from your laptop: `https://cornhole.your-domain/api/meta` should show JSON.

## Updating the game

```bash
cd /opt/iplay-cornhole && git pull && cd deploy && ./deploy.sh
```

Live matches are saved when the old server stops and picked up by the new one, so players see "reconnecting" for a few seconds and then carry on. Nothing is lost. Add `--maintenance` to also stop new matches from starting during the restart (needs `ADMIN_TOKEN`).

## Backups (do this before launch)

```bash
./backup.sh            # a backup right now, into deploy/backups (keeps the newest 14)
```

`setup-host.sh` runs it every night. Each backup is checked (Postgres reads the file back) before it counts.

**A backup on the same disk doesn't survive losing the server.** Put a Hetzner Storage Box in `.env` and every backup is copied there too:

```bash
BACKUP_RSYNC_TARGET=u123456@u123456.your-storagebox.de:cornhole/
BACKUP_SSH_PORT=23
```

Run `sudo ./setup-host.sh` again: it makes an SSH key and prints it; add it to the Storage Box once (Hetzner console, or `ssh-copy-id -p 23 -s u123456@u123456.your-storagebox.de`), then `./backup.sh` to test. Also turn on Hetzner's own server backups (a few euros a month), which cover everything at once. If a backup or the copy ever fails and `ALERT_WEBHOOK_URL` is set, you get a message.

To put a backup back (this **replaces** the database, so it asks you to type RESTORE):

```bash
./restore.sh backups/cornhole-20260929T031700Z.dump
```

Try a restore once on a spare machine **before** you need it. A backup you have never restored is a hope, not a backup.

## Firewall

Only three doors should be open to the internet: **SSH, 80 and 443**. `sudo ./setup-host.sh --firewall` does it (keeping the SSH port you are connected on, so you can't lock yourself out).

Postgres is not published to the host at all, and the game is bound to `127.0.0.1`, so neither can be reached from outside even if the firewall is wrong. (Docker skips `ufw` for ports it publishes to the world, which is why this pack never does that.)

## Watching it

```bash
docker compose logs -f app          # what the game says (JSON lines)
docker compose ps                   # is everything running and healthy?
curl -s http://127.0.0.1:3010/ready # ready + how many live matches
```

Set an uptime check (for example UptimeRobot, free) on `https://cornhole.your-domain/ready`. It goes red if the database is down.

**Alerts to your phone:** make a webhook in a Discord channel (Channel settings > Integrations > Webhooks) or in Slack, and put its address in `.env` as `ALERT_WEBHOOK_URL`. The server then posts there when something serious goes wrong, when it (re)starts, when a player files a report, and when someone asks to delete their account on the website. Each kind is sent at most once every 10 minutes, and messages never include player details. Example with your game: at 2 a.m. the database disk fills up; you get "Error: could not save match history" in your Discord instead of finding out from angry players.

## Turning things on

Edit `.env`, then `./deploy.sh --no-build`:

- **Voice:** fill in all four `VIVOX_*` lines. If Street Dice already uses Vivox, reuse the same values.
- **Ads:** `ADS_ENABLED=true`, and tune the two pacing numbers. The phone follows them.
- **Apple / Google sign-in:** `APPLE_CLIENT_IDS`, `GOOGLE_CLIENT_IDS`.
- **Force an app update:** `MIN_CLIENT_VERSION=1.2.0`.

## Limits worth knowing

- **One game server runs all matches** (that's how the live matches stay simple and safe). One decent Hetzner box handles a lot, and a load test ran 1,500 matches at once on about a third of one CPU core (`npm run loadtest`). Real players and networks differ, so watch it after launch.
- The matchmaking queue and duo parties are in memory. A restart empties them; players tap search again.
- **How this pack was tested:** it was run for real in Docker (the same images, same compose file, same scripts):
  - `./deploy.sh` from nothing: database up, tables made, ready in about 2 seconds.
  - A redeploy in the middle of 20 live matches: all 20 came back, none lost a throw, and all carried on.
  - Through the bundled Caddy: 60 requests during a deploy, **all answered** (Caddy holds them for the 2 seconds). HTTPS, the http-to-https redirect and live-match connections all work.
  - The nginx snippet: nginx accepts it, and with a certificate added (as certbot does) it passes HTTPS and live-match connections through.
  - `./backup.sh` then `./restore.sh`: an account made after the backup was gone after the restore, everything else was back.
  - `--maintenance` and `--no-build`.
- Not tested here: a real domain and Let's Encrypt certificate (needs your domain), and Hetzner's own firewall and backups (in their control panel).
