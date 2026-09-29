# Throwing: Line Up, Pull Back, Let It Fly

The throw is the whole game, so it has to feel familiar in the first five seconds and still have room to master after five hundred matches. This is the design, what it borrows from the games people already know, and exactly what the server does with it.

## What people already know (research)

| Game | How you aim | How you set distance | What makes it hard | What we take |
|---|---|---|---|---|
| **Golf Clash** | Drag to point a guide line at the target. Wind shown as a compass and a number. You "aim off" by counting **rings** on the target (each ring worth so many mph). | **Pull back** on the ball; the further you pull, the more power. | A needle you must stop in the middle (the "Perfect" meter). | Aim line + landing ring, **aim-off marks for wind**, pull-back power. *Not* the stop-the-needle meter. |
| **Flick Kick Field Goal** | The direction of your flick. | How fast/long you flick. | 360° wind that changes between kicks, and longer distances. | Wind that changes, and that you must read before every throw. |
| **Paper Toss** | Flick at the bin. | Flick strength. | A fan blowing left or right with a number on screen; you aim into it. | The simplest "aim into the wind" idea everyone gets. |
| **Archery King** | Drag to aim, hold, release. | Fixed. | Crosswind, and your aim sways if you hold too long. | **Holding too long makes you shaky.** |
| **Bowling King** | Flick forward. | Flick. | Swipe sideways/curve to add spin. | **Curve the flick for spin.** |
| **Swipe basketball games** | Direction of the swipe. | Length and speed of the swipe. | Nothing hidden: your swipe is your shot. | A clean flick = a clean shot. |
| **Cornhole mobile games** (Cornhole League, Cornhole Hero, Cornhole 3D) | One swipe does everything. | Swipe length/speed. | Mostly just the swipe. | They prove swipe-to-throw is what cornhole players expect, and show the gap: **none of them make wind and lining up matter.** |

Real cornhole players in the wind: they watch **streamers/flags** by the boards, **throw flatter** in wind (less time in the air, less drift), and use flat spin to keep the bag stable. Our physics copies that: a low slider moves least in the wind, a high airmail moves most.

**The gap we fill:** the golf games have the depth (reading wind, aiming off) but use a timing meter; the cornhole games have the feel (a flick) but no depth. We combine the Golf Clash aim-off with a cornhole flick, and **your accuracy comes from how cleanly you flick, not from stopping a needle.**

## The throw, step by step

The screen is first person: your hand holding the bag at the bottom, the far board ahead.

### 1. Read the wind

- A small **streamer** tied to the far board's leg blows in the wind (Unity draws it over the video), and the video's trees and tablecloths sell the breeze.
- A **wind badge** in the corner: an arrow drawn from *your* point of view and the speed, like `→ 8 mph`. The server sends it with every turn (`turn.wind`), already turned to your end.
- The wind is the same for everyone at an end. When players switch ends, a tailwind becomes a headwind, just like a real backyard.
- It drifts a little each inning (speed and direction). **Gusts:** each throw feels the shown wind plus a small random gust, so reading it gets you close but you can never be perfect. Gustier settings have bigger gusts.

### 2. Line up (aim)

- **Drag left or right anywhere on the top part of the screen** to turn your aim. A faint **aim line** runs from your hand to the far board.
- Where the line meets the board there is a **landing ring** with **hole marks**: little ticks on each side, each one the width of the hole (6 inches). This is Golf Clash's ring counting, in cornhole units.
- The ring shows where the bag lands **with no wind**. You aim off into the wind yourself. The rule of thumb the tutorial teaches:

  | Shot | Hole marks to aim off for 10 mph of straight crosswind |
  |---|---|
  | Slider | about 0.7 |
  | Standard | about 0.9 (call it one) |
  | Airmail | about 1.2 |

  A tailwind carries the bag about half a hole further (standard toss, 10 mph); a headwind holds it up that much short.
- **Ranked and "Pro" guide option:** the aim line stops at the front of the board and there's no ring, so you judge the landing spot yourself. Casual play shows the full guide.

### 3. Pick the shot

Three chips above the hand, like picking a club in a golf game. The app remembers your last choice.

| Shot | Arc | What it does |
|---|---|---|
| **Slider** | 0.25 | Low and flat. Lands short and slides up the board. Least bothered by wind. |
| **Standard** | 0.55 | The everyday toss. Lands mid-board and slides a little. |
| **Airmail** | 0.9 | High lob that sticks where it lands. Hangs in the air, so the wind pushes it most. |

### 4. Pull back (power)

- **Touch the bag and drag down.** The hand draws back. The further you pull, the further up the aim line the landing ring moves.
- It isn't a moving meter: the ring sits exactly where your pull puts it. Slide up or down to adjust before you let go.
- A light buzz (haptic tick) as the ring crosses the front of the board, the hole and the back edge.
- **Don't hold forever.** After about 2½ seconds pulled back, the hand starts to tremble on screen and the throw gets less accurate the longer you wait (like holding a bow in Archery King). It adds real pressure with the 20-second clock.

### 5. Let it fly (the flick = your accuracy)

**Flick up.** How you flick decides how well you actually threw:

| Your flick | What happens | Results-screen word |
|---|---|---|
| Straight up, brisk | Goes where you lined up. | **Pure** |
| Leans right | Pushes the bag right (about half an inch per degree past 3°) | **Pushed** |
| Leans left | Pulls it left | **Pulled** |
| Slow and lazy | Comes up short | **Short-armed** |
| Held the pull too long | More scatter | **Shaky** |
| Curved | Puts spin on the bag, which drifts it sideways as it slides | (shows the spin) |

The first 3° either way count as straight, so casual players aren't punished for being human. After the throw, the replay shows the calm-day path faintly next to the real one, so you can *see* what the wind and your flick did.

**Left-handed:** the phone mirrors the hand and the start position; the flick rules are the same.

## Who decides what (server-authoritative)

The phone measures; the server decides. This keeps every phone equal and lets us tune the feel without an app update.

1. The phone sends `POST /api/matches/:id/throw` with the lined-up `aim`, the pulled-back `power`, the shot's `arc`, and the flick as `release: { angleDeg, speed, holdMs, curve }`.
2. The server turns the release into a push/pull, a short-arm, a shake and spin (`server/src/physics/release.ts`).
3. It adds the natural human scatter, then the wind with this throw's gust (`server/src/physics/wind.ts`), then flies and slides the bag (`throwSim.ts`).
4. Every phone gets the same `throw_result`, including `wind` (what the bag actually flew through and how far it moved) and `release` (the verdict and the aim the player lined up), and replays it.

`GET /api/meta` → `throwing` has every number the phone needs to draw the guide exactly as the server computes it.

**Cheating:** a hacked app could always send a perfect straight flick. That's true of every mobile throwing game; the server still adds natural scatter and wind gusts that no one can predict, and ranked results can be checked for impossible consistency later. The server rejects impossible values (for example a 200° flick).

## Settings

Match Setup has **Wind: Off / Light (1–5 mph) / Breezy (3–10) / Gusty (8–16, bigger gusts)**. Default **Breezy**. The tutorial is always calm. **Ranked is always Breezy**, so reading the wind is part of every rating.

## Bots

Video bots read the wind by skill: a **Pro** allows for about 95% of it, a **Regular** 75%, a **Rookie** 30%. In a 10 mph crosswind a Pro barely drops off; a Rookie falls apart (a test keeps it that way).

## Tuning (all first guesses, change after play-testing)

| Number | Now | Where |
|---|---|---|
| Crosswind push | 0.6 in per mph (standard toss ≈ one hole per 10 mph) | `wind.ts` `CROSS_IN_PER_MPH` |
| Tail/headwind | 0.35 in per mph | `ALONG_IN_PER_MPH` |
| Air time | 0.5× (flattest) to 1.3× (highest lob) | `airtimeFactor` |
| Wind presets and gustiness | table above | `WIND_PRESETS` |
| Forgiving straight zone | 3° | `release.ts` `STRAIGHT_DEG` |
| Push per degree | 0.55 in | `PUSH_IN_PER_DEG` |
| Lazy flick | below 1.5 screen heights/second, 9 in short per unit | `MIN_FLICK_SPEED`, `SHORT_IN_PER_SPEED` |
| Shaky arm | after 2.5 s, +1× scatter per 4 s more, max 2.5× | `STEADY_HOLD_MS`, `SHAKE_PER_MS`, `MAX_SHAKE` |

The first real test should be a greybox with these numbers and 5 to 10 players: if beginners feel cheated, widen the straight zone; if good players find it too easy, shorten the guide or raise gustiness.
