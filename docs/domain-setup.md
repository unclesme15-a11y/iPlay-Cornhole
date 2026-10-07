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

## 3. Point the addresses at the server (DNS records, on Cloudflare)

The domain was bought on Cloudflare, so everything happens there (no "nameservers" to change).

1. Log in at dash.cloudflare.com → click your domain → left menu **DNS** → **Records** → **Add record**.
2. Fill in, then **Save**:

| Type | Name | IPv4 address | Proxy status | TTL |
|---|---|---|---|---|
| A | `cornhole` | `5.161.23.45` (your server) | **DNS only** (grey cloud) | Auto |
| A | `staging-cornhole` | `5.161.23.45` | **DNS only** (grey cloud) | Auto |

(Same IP for both: staging runs on the same box.) "Name" is only the part before your domain; Cloudflare adds the rest.

**Why the grey cloud, not orange:** orange makes all traffic pass through Cloudflare first. Then the game server sees
Cloudflare's address instead of each player's, so its "too many tries" limits would lump thousands of players together
(and the https certificate step gets more complicated). Grey = Cloudflare only answers "where is this address?", and
players connect straight to your server. That is the right setting for the game. Example: with orange, if 5 players
on the same Cloudflare route used the deletion form, the 6th would be told "too many requests".

Check it worked (usually 1–5 minutes on Cloudflare): open a terminal and run `ping cornhole.iplay.games`. It should
show your server's IP.

While you are in Cloudflare: **Domain Registration → Manage** → make sure **Auto-renew** is on (losing the domain would
take the game offline).

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

## 7. An email address on the domain (the stores ask for one) — Cloudflare Email Routing, free

Apple and Google want a support email, and `support@iplay.games` looks far more trustworthy than a Gmail.

1. Cloudflare → your domain → left menu **Email** → **Email Routing** → **Get started / Enable**.
2. It offers to add the email DNS records for you (MX and TXT) → **Add records and enable**.
3. **Destination addresses** → add your Gmail → open the confirmation email Cloudflare sends and click verify.
4. **Routing rules** → **Create address** → custom address `support` → action "Send to an email" → your Gmail → Save.
5. Test: send an email to `support@iplay.games` from another account; it should land in your Gmail.

Then set `SUPPORT_EMAIL=support@iplay.games` in `deploy/.env`. (This forwards mail **to** you. Replying from your
Gmail is fine for support; if you later want replies to come *from* support@, add it in Gmail → Settings → Accounts →
"Send mail as", or move to Google Workspace.)

## Checklist

- [ ] Server created, IP copied
- [ ] `cornhole` and `staging-cornhole` A records added on Cloudflare (grey cloud), `ping` shows the IP
- [ ] Domain auto-renew on
- [ ] Game deployed, `https://cornhole.<domain>/api/meta` loads with the padlock
- [ ] `/privacy`, `/terms`, `/support`, `/delete-account` load
- [ ] Staging deployed on `staging-cornhole.<domain>`
- [ ] `baseUrl` set in Unity
- [ ] `support@<domain>` forwards to you
- [ ] Uptime check on `https://cornhole.<domain>/ready` (UptimeRobot, free)
