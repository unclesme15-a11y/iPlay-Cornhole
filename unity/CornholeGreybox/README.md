# iPlay Cornhole: Unity client (greybox)

The phone side of the game. **All the game logic is already here and tested; the pictures are not.** Everything the
player can do works with plain dark menus and a top-down board, so the final art (Kling plates, the first-person hand,
bags, LED board, crowd) can be added on top through one hook (`MatchPresenter`) without touching the logic.

- Unity **6000.4** (same as Street Dice), **landscape only** (decided; the code locks it).
- It talks to the server in `../../server` (`../../docs/api-contract.md`). The server decides every result; the phone
  only sends the swipe.

## What is built

| | Where | Notes |
|---|---|---|
| Server client: every REST call, the WebSocket that reconnects by itself, the match picture | `Assets/Scripts/Core` | Plain C#, no Unity code, **tested** |
| 18+ screen, guest sign-in, saved session, terms, update / maintenance / ban / offline screens, rejoin a match | `CornholeApp.Startup.cs` + `AccountSession` | |
| Ranked (singles and duo parties), finding-opponents screen, leaderboards, results with the rating change | `CornholeApp.Menu.cs`, `CornholeApp.Match.cs` | |
| Friends: create / join by code or invite link, 1v1 or 2v2, wind, bots | same | Invite links via `Application.deepLinkActivated` |
| Throwing: drag to aim, pull the bag down, flick up; wind badge; shot picker; casual aim helper; clock | `Throwing.cs` (logic), `CornholeApp.Match.cs` (touch) | |
| Sounds from the server's cues (the game-show ring-in for a cornhole) | `CueSounds` | |
| Voice chat (Unity Vivox): table and team channels, mute-list, report and block | `CornholeVivoxVoiceClient.cs` | Needs the Vivox project set up |
| Ads through AppLovin MAX, paced by the server, never during a match | `AppLovinAds.cs`, `AdPacer` | Off until you install MAX (below) |
| The iPlay look (Street Dice colors, font) | `Theme.cs`, `UiKit.cs` | Plain on purpose |
| **Where the art plugs in** | `MatchPresenter.cs` | See `../../docs/unity-client.md` |

## Open it

1. Unity Hub > Add > this folder (`unity/CornholeGreybox`), open with 6000.4. Unity creates the `.meta` files and the rest of
   `ProjectSettings`; commit them.
2. Set the server address in `Assets/Resources/iplay-cornhole-server.json` (`baseUrl`). Use **https** for real builds.
3. `Project Settings > Player > Other Settings > Active Input Handling` = **Input Manager (Old)** or **Both** (the touch code uses it).
4. Press Play. There is no scene to build: the game creates itself when it starts (like Street Dice).

The full to-do list (voice, ads, sign-in plugins, store setup) is in `../../docs/unity-client.md`.

## Tests

Two ways, the same tests:

- **In Unity:** Window > General > Test Runner > EditMode > Run All (`Assets/Tests/EditMode`).
- **Without Unity** (any machine with mono; this is how they were run while writing it):
  ```bash
  Tools/CoreTests/run-core-tests.sh                          # offline
  Tools/CoreTests/run-core-tests.sh --live http://127.0.0.1:3000   # also drives a real server
  ```
  The live run needs a server started with `TRUST_PROXY=true`, a high `RATE_LIMIT_PER_MIN`, `ADS_ENABLED=true` and the
  four `VIVOX_*` settings; see the top of `Tools/CoreTests/Program.cs`.
- `Tools/NativeChecks/check-native.sh` compiles the phone-native plugins (Android with javac against the real Android 14
  framework; iOS with clang and ARC).
- `Tools/UnityStubs/check-unity-layer.sh` compiles the Unity-facing scripts against **Unity's real engine API** (reference
  assemblies from NuGet) and stand-ins for Vivox and AppLovin (`ServiceStubs.cs`), whose packages could not be downloaded here.

## What has and has not been checked

- **Checked:** the whole core (JSON, API client, session, socket, match picture, throw maths, ranked, voice grants, ads pacing, replay)
  passes 63 offline tests, and 13 more drive a real server (sign-in, error reports, seasons, push registration, wind physics parity, ranked matchmaking, a 2v2 duo, voice
  tokens, blocking, leaderboards, account deletion).
- **Compiled, never run:** everything in `Assets/Scripts/Unity` (screens, touch input, Vivox, ads). The engine calls compile against
  Unity's real API; the Vivox and AppLovin calls only against stand-ins. There was no Unity Editor where this was written, so
  expect small fixes on first open, most likely in the Vivox and AppLovin calls.
