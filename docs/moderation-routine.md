# Moderation Routine

A ready-to-use routine for keeping iPlay Cornhole safe. Apple and Google both expect "timely" answers to reports in games with chat, and a written routine is what shows you have one. **Adjust the times to what you can really keep**, then follow it. The tools are in `docs/operations.md` ("Moderation" and "Account deletion requests").

## Who and how often

| What | How often | Aim to finish within |
|---|---|---|
| Open reports (`/admin/reports?status=open`) | Once a day | 24 hours from the report |
| `underage` reports | Once a day, first | 24 hours |
| Threats of violence or anything illegal | As soon as seen | Same day, and contact the police if someone is in danger |
| Website deletion requests (`/admin/deletion-requests`) | Once a week | 30 days (the page promises this) |
| Emails to `SUPPORT_EMAIL` | Twice a week | 3 days |

Example with your game: on Monday morning you open the report list and see two reports about "BagBoss77" for "harassment" from two different matches. You look up the account, see it has two reports and no earlier ban, give a 7-day ban with the reason "harassment in voice chat", and close both reports.

## What gets which action

Voice is not recorded, so you judge from **how many different people** reported the same account, in **different matches**, and the notes they wrote.

| Situation | Action |
|---|---|
| One report, no pattern | Close it as `dismissed`. Keep an eye out if more come. |
| Two or more players in different matches report harassment, slurs or threats | 7-day ban. |
| It happens again after a ban | Permanent ban. |
| Hate speech, sexual content, threats of violence | Permanent ban straight away. |
| An offensive display name | 1-day ban with the reason "change your display name"; permanent if it comes back. |
| Cheating or ranked farming (the same two accounts playing each other over and over) | Wipe the ratings (`docs/operations.md`, "Ranked play") and a 30-day ban. |
| `underage`: the reports or the name make it likely they are under 18 | Permanent ban with the reason "iPlay games are for adults (18+)". |

Always write a reason: the player sees it, and it shows your decision was fair.

## Keep a short log

Admin actions are already logged by the server (`"admin":true` lines). Also keep a simple sheet with the date, account id, what happened, and what you did. It helps with repeat offenders and with any question from Apple or Google.

## If you are away

Turn on nothing new. The game keeps running and reports wait in the list. If you will be away for more than a few days, ask someone you trust to do the daily check with the admin token, and change the token when you are back (`ADMIN_TOKEN` in `.env`, then `./deploy.sh --no-build`).
