# R2 Storage Setup — Cornhole Character Assets

## Overview

Cloudflare R2 holds all heavy media for Cornhole: character stills, contact sheets, Imagine background plates, and reaction clips. The repo tracks only specs, prompts, and a manifest of what's where. No binary assets in git.

## Prerequisites

1. **Enable R2** in the Cloudflare dashboard: https://dash.cloudflare.com/?to=/:account/r2 — one-time toggle, free tier.
2. Account: Omgbell49@gmail.com's Account (ID: f7c79fd26254c700b9d583585f2cde16).
3. Zone: **iplay.wtf** (ID: f341f31deeccdd7c17f3b6e960886408), active, full setup.

## Bucket

- **Name:** `iplay-cornhole-media`
- **Location hint:** `enam` (Eastern North America — closest to players)
- **Storage class:** Standard
- **CORS:** Allow GET/HEAD from `https://iplay.wtf`, `https://www.iplay.wtf`, and local dev origins (`http://localhost:*`). Expose `Content-Type` and `ETag`.

## Custom Domain

- **media.iplay.wtf** → bucket `iplay-cornhole-media`
- Attached via R2 custom domain settings using zone ID above.
- All client-facing URLs use this domain. Never raw `r2.dev` URLs in shipped builds.

## Bucket Layout

```
iplay-cornhole-media/
├── characters/
│   ├── stills/          # Rooftop plates, idle sheets (Nia, Owen, Jace, Marisol)
│   ├── concepts/        # Imagine concept images for 3D builds
│   └── roster/          # Final approved roster faces
├── backgrounds/
│   ├── thrower-view/    # Locked stills + Imagine video takes
│   ├── far-board-cam/
│   └── neighbor-cut/
├── reactions/           # 3-second nearby reaction takes
├── cards-archive/       # Migrated failed-AI cards material (reference only)
└── manifest.json        # File inventory: path, size, character, status
```

## URL Patterns

- Character still: `https://media.iplay.wtf/characters/stills/{name}.png`
- Background take: `https://media.iplay.wtf/backgrounds/{camera}/{take}.mp4`
- Manifest: `https://media.iplay.wtf/manifest.json`

## Caching Rules (Unity Client)

- Use Unity AssetBundle caching: download once, store on device, check for updates on launch via manifest hash.
- R2 real traffic = first-time downloads + occasional refreshes, not per-match re-pulls.
- Set `Cache-Control: public, max-age=31536000, immutable` on immutable assets (stills, archived plates).
- Background takes and reactions: `max-age=86400` so updates propagate within a day.

## Drive → R2 Migration Plan

**Move from Drive (cards archive, ~3.3 GB, 3000+ files):**
- Rooftop plates for four roster faces (Nia, Owen, Jace, Marisol)
- Idle contact sheets for all four
- Any unnamed braids-and-curls style stills usable as look-reference
- Failed AI material intended for Cards that can serve as Cornhole character or background source

**Stay in repo (text only):**
- `docs/characters.md`, `docs/multiplayer-plan.md`, `docs/visual-camera-plan.md`
- `artifacts/imagine/cornhole-prompts.md`
- This file: `docs/r2-setup.md`

**Migration order:**
1. Upload Marisol assets first (she's on the roster).
2. Then Nia, Owen, Jace.
3. Background plates and reactions last.
4. Generate and commit `manifest.json` after each batch.
5. Update `docs/characters.md` with R2 paths once assets are live.

## Cost (Free Tier)

- 10 GB storage, 1M writes, 10M reads per month — egress always free.
- At Cornhole's scale (a few GB of plates/clips), expect to stay in free tier indefinitely with caching enabled.
- Paid: $0.015/GB-month Standard, $4.50/M Class A ops, $0.36/M reads.

## Open Items

- [ ] Flip R2 enable toggle in dashboard
- [ ] Create bucket + CORS + custom domain (API or dashboard)
- [ ] Upload first batch (Marisol)
- [ ] Write manifest.json generator script
- [x] Rename Kling references → Imagine across repo docs
- [ ] Sosa: wire Unity client to media.iplay.wtf URLs with AssetBundle caching
