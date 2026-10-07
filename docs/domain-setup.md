# Setting up your domain (from "I bought it" to "the game is live on it")

Think of the domain like a street address you bought. Right now the address exists, but there is no house behind it.
These steps put the house (your Hetzner server) behind it, and add a few "side doors" (sub-addresses) for different jobs.

In the examples below the domain is `iplay.games`. Replace it with yours everywhere.

## 1. Decide the addresses (no setup yet, just names)

| Address | What it is for | When |
|---|---|---|
| `cornhole.iplay.games` | The real game server (the app talks to it; also the privacy, terms, support and account-deletion pages) | Before you submit to the stores |
| `staging-cornhole.iplay.games` | The practice copy (`./deploy.sh --staging`) | Before you start testing updates |
| `admin.iplay.games` | The admin dashboard (Codex outline 1) | When it is built |
| `id.iplay.games` | The shared iPlay login (Codex outline 7) | When it is built |
| `iplay.games` / `www` | A simple homepage for all iPlay games (optional, nice for the store listing) | Any time |

One address per job, so each game and tool can move to its own server later without changing the app.

## 2. Get a server and its IP number

1. Hetzner Cloud console → **Add server** → Ubuntu 24.04, type **CX22** or bigger is plenty to start, location nearest
   most of your players (Ashburn or Hillsboro for the US).
2. Add your SSH key when asked (it is how you log in without a password).
3. When it is created, copy its **IPv4 address**, for example `5.161.23.45`. That is the "house number".

## 3. Point the addresses at the server (DNS records)

Log in where you bought the domain (GoDaddy, Namecheap, Cloudflare, Squarespace, Porkbun…) and find
**DNS** / **Manage DNS** / **DNS records**. Add one record per address:

| Type | Name / Host | Value / Points to | TTL |
|---|---|---|---|
| A | `cornhole` | `5.161.23.45` | Automatic (or 300) |
| A | `staging-cornhole` | `5.161.23.45` | Automatic |

(Same IP for both: staging runs on the same box.) The "Name" is just the part before your domain; the site adds
`.iplay.games` itself. If your provider is **Cloudflare**, set the little cloud to **grey ("DNS only")** for now; orange
can break the game's live connection until it is configured for WebSockets.

Check it worked (can take 5 minutes to a few hours): open a terminal and run `ping cornhole.iplay.games`. It should show
your server's IP.

## 4. Put the game on the server

Follow `docs/hetzner-deploy.md` → "First time". In `deploy/.env` set `PUBLIC_BASE_URL=https://cornhole.iplay.games` and
`DOMAIN=cornhole.iplay.games`. If nothing else runs on the box, the simplest is the built-in Caddy:

```
docker compose --profile proxy up -d
```

Caddy gets the free https certificate (the padlock) by itself. It only works once step 3 has finished, so do not
rush it.

Check from your phone's browser: `https://cornhole.iplay.games/api/meta` shows text (JSON). Then
`https://cornhole.iplay.games/privacy` shows the privacy page. These are the links you give Apple and Google.

## 5. Staging

Copy `deploy/.env.staging.example` to `deploy/.env.staging`, set `PUBLIC_BASE_URL=https://staging-cornhole.iplay.games` and `DOMAIN=staging-cornhole.iplay.games`, and
add the staging address to the web server (`docs/hetzner-deploy.md` → "Staging").

## 6. Tell the app and the stores

- Unity: in `Assets/Resources/iplay-cornhole-server.json` set `"baseUrl": "https://cornhole.iplay.games"`. This also switches on
  "tap an invite link and it opens the app" (iOS Associated Domains / Android App Links).
- App Store Connect and Google Play: privacy policy URL `https://cornhole.iplay.games/privacy`, support URL
  `https://cornhole.iplay.games/support`, account deletion URL `https://cornhole.iplay.games/delete-account`.

## 7. An email address on the domain (the stores ask for one)

Apple and Google want a support email, and it looks far more trustworthy as `support@iplay.games` than a Gmail.
Cheapest options: your registrar's free email forwarding (forwards `support@iplay.games` to your Gmail), Cloudflare
Email Routing (free), or Google Workspace / Zoho if you want a real inbox. Each one tells you which **MX** and **TXT**
records to add in the same DNS page as step 3. Then set `SUPPORT_EMAIL=support@iplay.games` in `deploy/.env`.

## Checklist

- [ ] Server created, IP copied
- [ ] `cornhole` and `staging-cornhole` A records added, `ping` shows the IP
- [ ] Game deployed, `https://cornhole.<domain>/api/meta` loads with the padlock
- [ ] `/privacy`, `/terms`, `/support`, `/delete-account` load
- [ ] Staging deployed on `staging-cornhole.<domain>`
- [ ] `baseUrl` set in Unity
- [ ] `support@<domain>` forwards to you
- [ ] Uptime check on `https://cornhole.<domain>/ready` (UptimeRobot, free)
