# What's Left: Your To-Do List And Ours

The game server, the rules, ranked play, leaderboards, voice, the deploy pack and the Unity client's logic are built and tested. What is left is **things only you can do** (accounts, keys, real-device tests, legal, stores) and **the visuals**. Nothing else is outstanding. Tick these off in order.

## A. Get the accounts and keys (nobody else can do these)

- [ ] **Unity Dashboard project with Vivox switched on.** Copy the Vivox Issuer, Domain, Signing key and the Unity environment id (`docs/unity-client.md`, section 3). Street Dice's values can be reused.
- [ ] **AppLovin MAX**: add the app (one entry per game), get the SDK key and the interstitial and banner unit ids; choose which ad networks to enable (`docs/unity-client.md`, section 4).
- [ ] **Apple Developer account**: the app id (bundle id, for example `com.iplay.cornhole`), Sign in with Apple enabled, and (for invite links) your Team id.
- [ ] **Google Play Console account**: the app, and an OAuth client for Google Sign-In; the SHA-256 fingerprint for app links.
- [ ] **A domain** for the game (for example `cornhole.iplaygames.com`), pointed at your Hetzner box.

## B. Put the server on your Hetzner box

Follow `docs/hetzner-deploy.md`. The pack was checked but **never run** (the machine it was written on had no Docker), so expect to fix a small thing.

- [ ] Fill in `deploy/.env` (database password, admin token, `PUBLIC_BASE_URL`, the Vivox values, ads, Apple/Google ids).
- [ ] `./deploy.sh`, then point your web server at it (Caddy or nginx snippet).
- [ ] **Backups**: run `./backup.sh` nightly (cron), copy the files **off the box** (a Storage Box or similar), turn on Hetzner's own server backups, and **do one test restore** on a spare machine before you need it.
- [ ] **Monitoring**: an uptime check on `https://your-domain/ready` (UptimeRobot is free), and a look at `docker compose logs app` after each deploy. The log lines to alert on are listed in `docs/operations.md`.
- [ ] **Firewall**: only ports 22, 80 and 443 open (`docs/hetzner-deploy.md`).

## C. Legal and policy

- [ ] Have a lawyer read and fix `docs/legal/privacy-policy-draft.md` and `docs/legal/terms-draft.md`, fill in the [brackets], and **publish them at public web addresses**. Put those addresses in `Assets/Resources/iplay-cornhole-server.json` (`termsUrl`, `privacyUrl`, `supportUrl`).
- [ ] When you publish new terms, raise `TERMS_VERSION` in `.env` (players are asked to accept again).
- [ ] Decide the **age check strength** for your markets (the game asks "I am 18 or older"; a lawyer can say whether you need more).
- [ ] A **written process for reports** (who looks, how fast). The tools exist (`docs/operations.md`, "Moderation"): you need the routine and someone to do it. Apple asks for timely responses.
- [ ] A **web page for account-deletion requests** (Google Play requires one; the in-app deletion is built).

## D. Test on real phones (nothing here can be tested without them)

Use two phones, ideally one iPhone and one Android.

- [ ] **Sign in with Apple and Google** on a real device (the server has only ever seen locally-made test keys).
- [ ] **Invite links** opening the app directly (needs the universal-link and app-link setup).
- [ ] **Voice**: two phones in one match, hear each other, team channel in 2v2, **blocked player is muted**, the microphone permission prompts.
- [ ] **Ranked**: find a match, finish a match, see the rating change; leave a match and see the cooldown; a duo party.
- [ ] **Deploy without losing a game**: start a match, run `./deploy.sh`, check the phones reconnect and the match carries on.
- [ ] **Ads**: with test ads, confirm none ever appear during a match, and the consent and tracking prompts appear.
- [ ] **Flaky network**: airplane mode for 10 seconds mid-match (should reconnect), and for 40 seconds (a bot takes over in casual; a forfeit in ranked).
- [ ] The **feel of the throw**: 5 to 10 real players. The wind strength, the forgiving 3 degrees, and the shaky-arm timing are first guesses (`docs/throwing-controls.md`, "Tuning").
- [ ] Open the Unity project and fix what needs fixing: **the Unity screens have never been run** (`docs/unity-client.md`, "How it was checked").

## E. The stores

- [ ] Store listing text, age rating answers, and data-safety answers (`docs/store-listing.md`).
- [ ] Screenshots and preview video (needs the art).
- [ ] App icon and splash (the iPlay mark is in `assets/logo`; a vector version is still wanted for the final bag print).
- [ ] TestFlight and Google Play internal testing before going public.

## F. The visuals

`docs/visuals-todo.md` is the whole list: the Kling plates and clips, the video characters, the hand, bags, LED board, aim guide, menus and the logo animation. The art plugs in through `MatchPresenter`, so none of it touches the game logic.

## G. Decisions only you can make

- [x] **Landscape** (decided; in Player Settings tick only Landscape Left and Right).
- [x] **Ring-in sound: the two-bell ding** (decided).
- [ ] Whether to **tune** the ranking numbers before launch (`docs/ratings-explained.md`), or wait for real games.
- [ ] How long to keep **match history** (kept forever today; a limit is not built).

## What was checked, and how much to trust it

| Area | Checked how | Trust |
|---|---|---|
| Rules, physics, bots, wind, flick | Automated tests, including breaking each safeguard on purpose to prove the tests notice | High |
| Accounts, sessions, ranked, ratings, leaderboards, voice signing, ads settings | Automated tests on two database engines (an in-process one and real Postgres), repeated runs | High |
| A restart or deploy during live matches | Tests, plus a real server stopped under 1,498 live matches with no errors | High |
| **Capacity** | A load test: **1,500 matches at once used about 35% of one CPU core and 250 MB, and the server answered in under 0.1 seconds (99% of requests)** on a 4-core test machine | Good sign, not a guarantee. Your Hetzner box, real players and real networks differ. A single server holds all live matches |
| The phone's brain (talking to the server, ranked flow, the throw maths) | 57 offline tests + 10 tests that drive the real server with the real client code | High |
| **The Unity screens, touch input, Vivox and AppLovin code** | Compiled against stand-ins only; never run in Unity | **Low: expect small fixes on first open** |
| **The Hetzner deploy pack** | Configuration and script syntax validated; never run | **Low until you run it once** |
| Sign in with Apple/Google, Vivox, AppLovin against the real services | Not possible from here | **Untested** |
