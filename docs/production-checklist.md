# What's Left: Your To-Do List

**Everything that can be built and tested without your accounts, your phones or the art is built and tested.** What is left is in three groups:

1. **Sign-ups and paperwork** (sections A to C): accounts, keys, legal text, and putting the server on your box. Mostly copy and paste; the scripts do the rest.
2. **The visuals** (section D).
3. **The first test on real phones** (section E). It needs your phones and your copy of Unity, so nobody can do it for you. The app now reports its own errors to the server, so anything that breaks shows up in your alerts.

Example of how little is left per item: for Google sign-in, you make two "OAuth clients" in the Google Cloud console and paste one id into two places. The sign-in code, the build settings and the server check are already done.

## A. Sign up and paste the keys

| Account | What to copy | Where it goes |
|---|---|---|
| **Unity Dashboard** (Vivox on) | Issuer, Domain, Signing key, Unity environment id (Street Dice's work too) | `deploy/.env`: `VIVOX_ISSUER`, `VIVOX_DOMAIN`, `VIVOX_SIGNING_KEY`, `VIVOX_UNITY_ENVIRONMENT_ID`. In Unity: link the project (Edit > Project Settings > Services) |
| **AppLovin MAX** (your one account for all games) | SDK key, interstitial and banner unit ids | `Assets/Resources/iplay-ads.json`. Then install MAX with its Integration Manager, tick **Terms and Privacy Policy flow** (the consent and tracking prompts), add `APPLOVIN_MAX` to Scripting Define Symbols, and set `ADS_ENABLED=true` in `.env` |
| **Apple Developer** | Team id; allow **Sign in with Apple** and **Associated Domains** for `com.iplay.cornhole` | `.env`: `APPLE_CLIENT_IDS=com.iplay.cornhole`, `APPLE_TEAM_ID`, `IOS_BUNDLE_ID`. App: `appleTeamId` in `Assets/Resources/iplay-cornhole-server.json` |
| **Google Cloud** (for sign-in) | A **Web application** OAuth client id, plus an **Android** client (package `com.iplay.cornhole` and your signing key's SHA-1) | The Web id in `.env` (`GOOGLE_CLIENT_IDS`) and in `iplay-cornhole-server.json` (`googleWebClientId`) |
| **Google Play Console** | The app-signing key's SHA-256 fingerprint | `.env`: `ANDROID_PACKAGE=com.iplay.cornhole`, `ANDROID_CERT_SHA256` |
| **A domain** (for example `cornhole.iplaygames.com`) | An A record pointing at your Hetzner box | `.env`: `PUBLIC_BASE_URL`; app: `baseUrl` in `iplay-cornhole-server.json` |
| **An email address** for players | | `.env`: `SUPPORT_EMAIL` |
| **Hetzner Storage Box** (off-box backups) | Its address | `.env`: `BACKUP_RSYNC_TARGET`, `BACKUP_SSH_PORT=23` |
| **Discord or Slack webhook** (alerts to your phone) | The webhook address | `.env`: `ALERT_WEBHOOK_URL` |
| **UptimeRobot** (free) | Add a check on `https://your-domain/ready` | |

Each sign-in button only appears once its keys are set, so you can switch things on one at a time.

## B. Legal paperwork

- [ ] A lawyer reads `docs/legal/privacy-policy-draft.md` and `docs/legal/terms-draft.md`, and fills in the [brackets] (company, address, contact, the ad networks you enabled, how long your host keeps logs).
- [ ] Save the approved versions as `docs/legal/privacy-policy.md` and `docs/legal/terms.md`, then `./deploy.sh --no-build`. **The server publishes them itself** at `/privacy` and `/terms`, and the app already links there.
- [ ] Decide with the lawyer: is the "I am 18 or older" tick enough for your markets? And how long to keep match history (`MATCH_HISTORY_DAYS`, 0 = forever)?
- [ ] Adopt the moderation routine in `docs/moderation-routine.md` (change the times to what you can keep). Apple asks for timely answers to reports.
- [ ] When you publish changed terms later, raise `TERMS_VERSION` in `.env`.

## C. Put the server on your Hetzner box

Follow `docs/hetzner-deploy.md`. In short:

```bash
git clone <repo> /opt/iplay-cornhole && cd /opt/iplay-cornhole/deploy
cp .env.example .env && nano .env        # the values from section A
./deploy.sh                              # builds and starts the game and its database
sudo ./setup-host.sh --firewall          # nightly backups, Docker on boot, firewall
```

- [ ] Point your web server at it (Caddy or nginx snippet in `deploy/`), or use the bundled Caddy.
- [ ] Add the SSH key `setup-host.sh` prints to your Storage Box, then run `./backup.sh` once to test the off-box copy.
- [ ] Turn on Hetzner's own server backups in the Hetzner console.
- [ ] Do one test restore on a spare machine (`./restore.sh backups/<newest>.dump`).

## D. The visuals

`docs/visuals-todo.md` is the whole list: the Kling plates and clips (16:9, landscape), the video characters, the hand, bags, LED board, aim guide, menus, logo animation, app icon and splash, store screenshots and preview video, and a vector version of the iPlay mark for the bag print. The art plugs in through `MatchPresenter`, so none of it touches the game logic.

## E. The first real-phone test

This needs your phones and Unity. Use two phones, ideally one iPhone and one Android.

- [ ] Open `unity/CornholeGreybox` in Unity 6. The project settings apply themselves (landscape, ids, IL2CPP). Add the Vivox and AppLovin packages. **The screens have never been opened in Unity**, so expect a few small fixes, most likely in the Vivox and AppLovin calls (they were only compiled against stand-ins).
- [ ] Build to both phones (Unity adds Sign in with Apple, invite links, Google's libraries and the microphone text for you).
- [ ] Try: sign in with Apple and with Google; an invite link opening the app; voice between the two phones, the team channel in 2v2, and a blocked player being muted; ranked (find, finish, see the rating change; leave and see the cooldown; a duo party); a deploy in the middle of a match; airplane mode for 10 seconds (reconnects) and 40 seconds (a bot takes over, or a forfeit in ranked); ads never showing during a match, and the consent prompts appearing.
- [ ] **The feel of the throw** with 5 to 10 people: wind strength, the forgiving 3 degrees, and the shaky-arm timing are first guesses (`docs/throwing-controls.md`, "Tuning"). The ranking numbers can launch as they are and be tuned from real games (`docs/ratings-explained.md`).
- [ ] TestFlight and Google Play internal testing, then the store forms (`docs/store-listing.md`: the text, age rating and data-safety answers are drafted; the deletion page is `https://your-domain/delete-account`).

## What was checked, and how much to trust it

| Area | Checked how | Trust |
|---|---|---|
| Rules, physics, bots, wind, flick | Automated tests, including breaking each safeguard on purpose to prove the tests notice | High |
| Accounts, ranked, ratings, leaderboards, voice signing, ads settings, public pages, deletion requests, alerts, app error reports | 685 automated tests on real Postgres (594 on the in-process engine), repeated runs | High |
| A restart or deploy during live matches | Tests, a real server stopped under 1,498 live matches, and a real Docker redeploy during 20 matches (none lost) | High |
| **Capacity** | Load test: **1,500 matches at once used about 35% of one CPU core and 250 MB**, answers under 0.1 s (99%) | Good sign, not a guarantee; one server holds all live matches |
| **The Hetzner deploy pack** | Run for real in Docker: first deploy, redeploy during live matches, Caddy (60 requests during a deploy, all answered) and nginx, backup, off-box copy, failure alert, restore, and `setup-host.sh` in a clean Debian. CI runs it on every change | High (your domain's certificate is the only untested step) |
| The phone's brain (server calls, ranked flow, throw maths, error reports) | 59 offline tests + 11 that drive a real server with the real client code | High |
| **The Unity screens and touch input** | Compiled against Unity's **real** engine API as Editor, iPhone and Android builds; never run in Unity | **Medium: expect small fixes on first open** |
| **Sign in with Apple/Google, Keychain/Keystore** (our own native code) | Android code compiled against the real Android 14 framework; iPhone code passes clang with ARC; build scripts compiled against Unity's real Editor API, and the Android manifest changes run and checked | **Medium until the first real-phone test** |
| **Vivox and AppLovin calls** | Compiled against stand-ins only (their downloads were blocked here) | **Low: check on first open** |
| Apple, Google, Vivox, AppLovin real services | Not reachable from here | **Untested until section E** |
