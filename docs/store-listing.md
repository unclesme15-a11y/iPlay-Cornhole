# App Store And Google Play Notes

Drafts and answers so the store forms go quickly. **Answer every form honestly and check the exact wording of each question on the day**: the stores change their forms, and I could not open them from where this was written, so treat the answers below as what the game actually does, not as a copy of the form.

## Listing text (draft)

**Name:** iPlay Cornhole  ·  **Subtitle (30 characters):** Ranked cornhole with friends  ·  **Category:** Games > Sports (or Casual)

**Short description (80 characters, Google):** Real cornhole, first person. Play friends, go ranked, climb the board.

**Description:**
> Step up to the board at a summer cookout and throw. iPlay Cornhole is regulation cornhole from a first-person view: line up your aim, pull the bag back, flick it up, and read the wind.
>
> **Play your way**
> • Ranked 1v1 and ranked duos, with global leaderboards
> • Play friends with an invite link, or practice against video opponents
> • Talk to the table with live voice chat
>
> **Real cornhole**
> • Regulation rules: play to 21, cancellation scoring, 4 bags each
> • Wind that changes every inning: aim off for the breeze, throw a flat slider or a high airmail
> • The custom iPlay LED board flashes and rings in when a bag drops in the hole
>
> **Fair play**
> • The server decides every result, so nobody can cheat their score
> • Report and block anyone; blocked players are muted for you
>
> Free to play with ads. Nothing to buy. For adults 18+ (voice chat is not filtered).

**Keywords (Apple, 100 characters):** cornhole,bags,backyard,bbq,cookout,darts,sports,multiplayer,ranked,friends,party,toss,throw

## Age rating

The game has **live, unfiltered voice chat between strangers** and names typed by players. Expect the stores to rate it **17+ (Apple) / Mature 17+ (Google)** when you answer honestly about user-generated content and chat. That matches the game's own 18+ rule. There is no violence, gambling, real-money play, or purchases. Do not mark the app as directed at children.

## What Apple checks for apps with other people's content (Guideline 1.2)

| Apple wants | Where the game does it |
|---|---|
| A way to filter objectionable content | Display names are filtered (profanity, look-alike spellings, impersonation). Voice is not filtered, so there is muting and reporting instead |
| A way to report offensive content, with timely responses | Report button on the results screen (harassment, cheating, inappropriate name, under 18, other); staff review through the admin API. **Write down how fast you answer** |
| A way to block abusive users | Block on the results screen; blocked players are muted on the blocker's phone and are never matched with them |
| Contact information published | `https://your-domain/support` (Profile > Help & support in the app), plus the contact in the privacy policy and terms |
| Terms that say no objectionable content and there will be consequences | `docs/legal/terms-draft.md` sections 3 and 4 |
| Sign in with Apple if you offer Google | Both supported once the plugins are added (`docs/unity-client.md`) |
| Account deletion inside the app | Profile > Delete my account (`DELETE /api/me`) |

## Google Play forms

- **Data safety:** what the game collects is listed in `docs/data-and-privacy.md` and the privacy policy. In short: display name and account id (linked to the person, for app functionality); app activity such as match results; device or other ids (the advertising id) and approximate location from the IP, both for advertising; audio is handled live by Vivox and not stored by us. Data is encrypted in transit. Users can request deletion. **Confirm each answer against the form; the ad networks you enable in AppLovin MAX change the ad answers.**
- **Account deletion web page:** Google requires a public web page where a person can ask for their account to be deleted without opening the app, and a link to it in the store form. Both are built: the in-app deletion, and the page at `https://your-domain/delete-account` (the server hosts it; staff handle requests with the admin API, `docs/operations.md`). Put that address in the form.
- **Target audience:** 18+ only. **Ads:** yes, contains ads. **User-generated content:** yes.
- **Content rating questionnaire:** answer the chat / user interaction questions honestly.

## Screenshots and preview

Plan for 5 to 6 per device size, in the game's dark cyan-and-gold look:
1. First-person view of the throw with the far board and the wind badge.
2. The LED board flashing on a cornhole ("CORNHOLE!").
3. The ranked "Finding opponents" screen and rating change.
4. The leaderboard.
5. The match setup with the wind choice.
6. Voice with speaking markers.

These need the art pass (`docs/visuals-todo.md`). A 15 to 30 second preview video of a throw and a cornhole is the best single asset.

## Before you submit

Use `docs/production-checklist.md`. The two things that most often delay a first submission are the privacy policy link and the age-rating answers; both are drafted here.
