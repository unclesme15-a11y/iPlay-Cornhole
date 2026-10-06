# Outline 7 — One iPlay account across all games

## In plain words

Right now each game keeps its own accounts. A player who signs in with Apple in Cornhole and then installs Street
Dice starts from zero there: new name, separate ban, and to delete their data they would have to ask each game.

This builds **iPlay ID**: one small login service that every game trusts.

- Sign in once with Apple or Google (or play as a guest) → same iPlay name in every game.
- Ban someone for cheating → owner chooses "this game only" or "all of iPlay".
- "Delete my account" in any game (or on the website) → deleted everywhere.
- Each game still keeps **its own game data** (Cornhole ratings, Street Dice stats). iPlay ID only knows *who* you are.

Example: Maya plays Cornhole as "MayaThrows" with Sign in with Apple. She installs Street Dice, taps "Sign in with
Apple", and she is already "MayaThrows" there — no new name prompt, and her Street Dice friends list can show she also
plays Cornhole. Her Cornhole rating is untouched; Street Dice gives her a fresh Street Dice record.

## Non-goals (v1)

- No email/password logins (Apple/Google/guest only, same as today).
- No shared wallet, shared items or cross-game friends list (can come later on top of this).
- No moving game data into the account service.

## Architecture

```
            ┌──────────────── iPlay ID service (id.iplay.games) ────────────────┐
App ──────▶ │ POST /v1/auth/guest  POST /v1/auth/apple  POST /v1/auth/google   │
(any game)  │ POST /v1/auth/refresh  POST /v1/auth/logout  GET/PATCH /v1/me    │
            │ DELETE /v1/me   GET /.well-known/jwks.json   /admin/* (owner)    │
            │ DB: iplay_accounts, iplay_identities, refresh_tokens, bans, …     │
            └────────────▲───────────────────────────────▲──────────────────────┘
       short-lived JWT   │ verify with JWKS (cached)       │ signed webhooks: account.deleted,
                         │                                 │ account.banned, account.renamed
            Cornhole server  ◀── Bearer <access JWT> ── App ──▶  Street Dice server
            (own DB: accounts row keyed by iplay_id, ratings, matches…)
```

- **Access token**: JWT, ES256, 15-minute life. Claims: `sub` (iPlay id, e.g. `ipl_…`), `name`, `guest` (bool),
  `aud` (the game id, e.g. `cornhole`), `iss`, `iat`, `exp`, `ban` (only if banned from all of iPlay).
  Game servers verify locally with the JWKS (cache keys, refresh on unknown `kid`) — **no call to iPlay ID per request**.
- **Refresh token**: random 32 bytes, stored only as SHA-256 (same approach as Cornhole's `sessions.token_hash`),
  60-day sliding life, rotated on every use; reuse of an old refresh token revokes the whole family (theft detection).
  Lives in the phone's Keychain/Keystore (Cornhole already stores its session there via `IPlayNative`).
- **Sharing a login between games on one phone**: iOS — shared Keychain access group across iPlay apps (same Apple
  Team). Android — no safe shared storage; the second game shows "Continue as MayaThrows?" after the player signs in
  with the same Google/Apple account. Guests are per-app (cannot be shared safely) but can be upgraded.
- **Webhooks to games** (HMAC-SHA256 signed, retried with backoff, idempotent by event id):
  `account.deleted` → game deletes its row and anonymises history (Cornhole already does this in
  `AccountService.delete` + the `anonymise_season_results` trigger); `account.banned` / `account.unbanned` →
  game drops cached sessions and kicks from live matches (same as `/admin/accounts/:id/ban` today);
  `account.renamed` → game updates its cached display name.

## Data model (iPlay ID)

```sql
iplay_accounts (id text pk, display_name text, display_name_changed_at timestamptz, is_guest bool,
                adult_confirmed_at timestamptz, terms_version text, created_at, last_seen_at,
                status text check (status in ('active','banned','deleted')), ban_reason text, banned_until timestamptz)
iplay_identities (provider text check (provider in ('apple','google')), subject text, account_id fk on delete cascade,
                  created_at, primary key (provider, subject))
refresh_tokens (token_hash text pk, family_id text, account_id fk, game text, platform text, client_version text,
                created_at, last_used_at, expires_at, replaced_by text null, revoked_at timestamptz null)
game_memberships (account_id fk, game text, first_seen_at, last_seen_at, primary key (account_id, game))
game_bans (account_id fk, game text, reason, until, created_at, primary key (account_id, game))   -- per-game bans
deletion_requests (… same shape as Cornhole's table …)
webhook_outbox (id, game, event, payload jsonb, attempts, next_attempt_at, delivered_at)
audit_log (id, at, actor, action, target, details jsonb)
```

Display names do **not** have to be unique (Cornhole allows duplicates today); add a 4-digit tag later only if needed. Reuse Cornhole's name filter (`server/src/accounts/nameFilter.ts`).

## Endpoints (iPlay ID v1)

| Endpoint | Notes |
|---|---|
| `POST /v1/auth/guest` | `{ game, adultConfirmed: true, platform, clientVersion }` → `{ access, refresh, account }`. Refuses without the 18+ confirmation (same rule as Cornhole). |
| `POST /v1/auth/apple` / `google` | `{ game, identityToken, nonce?, guestRefresh? }`. Verifies the token (move `server/src/accounts/providers.ts` here). If `guestRefresh` is given and that guest has no identity, **upgrade the guest** (keeps its id, so game data stays). If the Apple/Google identity already belongs to another account, return `409 identity_in_use` with that account's name so the app can ask "Switch to MayaThrows? Your guest progress on this phone will be lost." |
| `POST /v1/auth/refresh` | `{ refresh, game }` → new pair. Rotation + reuse detection. Returns `403 banned` with reason/until. |
| `POST /v1/auth/logout` | Revokes that refresh family. |
| `GET /v1/me`, `PATCH /v1/me` | Name change (30-day cooldown like Cornhole), accept new terms. |
| `DELETE /v1/me` | Deletes the iPlay account → webhooks every game in `game_memberships`. Apple requires in-app deletion; this satisfies it for all games. Also revokes Apple refresh tokens if stored (Sign in with Apple revoke endpoint). |
| `GET /.well-known/jwks.json` | Current + previous public key (key rotation without logging everyone out). |
| `/admin/*` | Same contract as Outline 1 (status, search, ban with `scope: "all" \| "<game>"`, unban, delete, deletion requests), so the dashboard treats iPlay ID like one more "game". |

Rate limits per IP and per account; the same proxy-aware setup as Cornhole (`TRUST_PROXY`).

## Changes in each game server (Cornhole as the reference)

1. New auth mode `AUTH_MODE=iplay` (keep `local` for development and tests). In `iplay` mode:
   - `Authorization: Bearer <JWT>` is verified with the JWKS; `aud` must equal this game.
   - First time an `iplay_id` is seen, create the local `accounts` row with `id = sub` (so all game tables keep their
     `account_id` foreign keys unchanged).
   - Local guest/Apple/Google sign-in routes return `410 moved_to_iplay_id`.
   - Ban checks: global ban from the token's `ban` claim **and** webhook; per-game bans stay in the game's own
     `accounts.status`.
2. `POST /iplay/webhook` — verify HMAC + timestamp (reject > 5 min old), dedupe by event id, apply.
3. The WebSocket `hello` accepts the JWT the same way; when it expires mid-match the app refreshes and sends
   a `reauth` message (do not drop the match).
4. Data export (`/api/me/export`) stays per game; iPlay ID has its own export of account + identities.

## App changes (Unity, shared package)

- Move the auth part of `ApiClient` / `AppStart` into a shared `IPlay.Account` package used by every game:
  sign-in buttons, guest start, refresh-on-401, Keychain storage, "Continue as …?" prompt, delete account.
- Game `ApiClient` asks the package for a fresh access token before each call / socket connect.
- iOS: enable Keychain Sharing with group `$(AppIdentifierPrefix)games.iplay.shared` in each iPlay app
  (add to `IPlayIosBuild.cs` the same way Sign in with Apple is added).

## Migrating existing Cornhole players (do this before the second game launches if at all possible)

1. Export Cornhole `accounts` + `identities` into iPlay ID **keeping the same ids** (Cornhole ids become iPlay ids;
   new ids get an `ipl_` prefix — both are valid). Display names, ban status and terms version copy across.
2. Add a bridge route on iPlay ID: `POST /v1/auth/legacy` `{ game: "cornhole", legacySessionToken }` — iPlay ID calls
   a private Cornhole endpoint to check the old session hash and returns iPlay tokens for the same id. Old app versions
   keep working with local sessions until `MIN_CLIENT_VERSION` is raised (the server already supports forcing updates).
3. After ~90 days, turn off legacy sessions; remaining guests who never updated are lost (acceptable; tell players in
   the update notes).

## Security & privacy checklist

- ES256 private key only on iPlay ID (env/secret file), rotated yearly; games only hold the public JWKS.
- Refresh tokens hashed, rotated, family-revoked on reuse; access tokens short-lived.
- Webhook secret per game; HMAC over `timestamp.body`; constant-time compare.
- iPlay ID stores the minimum: no email unless Apple/Google give it and it is needed (prefer not storing it).
- Privacy policy update: one controller for account data across games; list which games receive the iPlay id + name.
- Deletion must reach every game within 30 days even if one game is down (outbox retries; dashboard shows stuck events).

## Acceptance criteria

- [ ] Guest → Apple upgrade keeps the same iPlay id, so Cornhole stats survive the upgrade (end-to-end test).
- [ ] Same Apple identity signs in from Cornhole and Street Dice → same `sub`, same name, separate game records.
- [ ] Global ban kicks the player from a live Cornhole match within 1 s (webhook) and new tokens are refused.
- [ ] `DELETE /v1/me` removes the player from every game that knew them; a game that was down catches up when it
      returns (outbox test).
- [ ] Reusing an old refresh token revokes the family; next refresh returns 401.
- [ ] Key rotation: tokens signed with the previous key still verify until they expire.
- [ ] Cornhole's existing server tests pass in `AUTH_MODE=local`; a new suite covers `AUTH_MODE=iplay`
      (run iPlay ID in-process, same `describe.each(backends)` pattern).
- [ ] Existing Cornhole players migrate with the same id; old app versions keep working until the forced update.

## Rollout

1. Build iPlay ID + tests; deploy to staging next to Cornhole staging.
2. Cornhole `AUTH_MODE=iplay` on staging; shared Unity package; migrate a copy of production data into staging and
   test the bridge.
3. Production: migrate, ship the app update, keep legacy sessions on for 90 days.
4. Street Dice and later games start directly on iPlay ID.
