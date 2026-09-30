# The Unity Client

`unity/CornholeGreybox` is the phone app. **All the game logic is built and tested. The pictures are not.** This page says how it is put together, how the art plugs in, and every setup step that needs you (accounts, keys, plugins).

## The idea, in plain words

Think of the app as a stage with three layers:

1. **The brain** (`Assets/Scripts/Core`). Talks to the server, knows the rules of the screens (18+ gate, ranked queue, party, leaderboards), keeps a live picture of the match, and works out the throw (aim, pull-back, flick). It has **no Unity code in it**, so it can be tested on any computer. This is the part that has been proven.
2. **The plain stage** (`Assets/Scripts/Unity`). Draws every screen with plain dark menus in the iPlay colors and reads the touches. It works, but it is deliberately plain.
3. **The art** (yours, next). The video plates, the hand, the bags, the LED board, the crowd. They plug into the stage through one door, `MatchPresenter`, and never need to touch the brain.

Example with your game: when the server says "Keisha's bag went in the hole", the brain turns that into a `ThrowResult` (where the bag flew, where it slid, that it dropped in at 1.4 seconds) and calls your presenter. Your art decides how a bag looks flying through the Kling plate. If you have no art yet, the plain top-down board shows it. Either way the result is the same, because **the server already decided it**.

## Following Street Dice's look

The look rules come from the dice project (`docs/visual-camera-plan.md` and `visual-approval-checklist.md` there, plus its menu code):

| Rule | Where it lives here |
|---|---|
| Dark surfaces: near-black navy backdrop `#05080B`, scene black behind the plate | `Theme.Backdrop`, `Theme.Scene` |
| Restrained cyan glow, gold edges | `Theme.Cyan`, `Theme.PanelEdge`; `UiKit.Panel` / `Button` |
| Barlow Condensed SemiBold lettering (brush/graffiti headings come with the art pass) | `Resources/UI/BarlowCondensed-SemiBold.ttf` (open license, credited) |
| Hot red/orange kept for one big moment only (Street Dice: a full hot streak; here: a win streak of 5+) | `Theme.Hot`, `Theme.StreakColor` |
| 18+ gate first, "under 18" exits | `CornholeApp.Startup.cs` |
| UI restraint: only what the player needs right now; helpers hidden unless tutorial mode is on | Tutorial toggle in Settings; aim helper off in ranked |
| Runtime-built app, no editor scene; one big controller made of partial files | `CornholeApp` (partial class), like `StreetDiceGreyboxController` |
| Hand only, never a body; human players as mic/profile markers, video characters for bots | For the art pass (`visual-camera-plan.md`) |
| Voice with speaking indicators | `CornholeVivoxVoiceClient.SpeechActivity` |

## What you get from the server, for the art

Everything is in board coordinates, in inches. The far board is 24 inches wide and 48 long; **x = 0 is the center line, y = 0 is the front edge, and the hole is at x 0, y 39**. The thrower stands 27 feet (regulation) in front of y = 0.

`MatchPresenter` (put one component that derives from it anywhere in the scene) is called with:

| Call | What it gives you | Typical use |
|---|---|---|
| `OnMatchOpened(model, guide)` | The match and the throwing numbers | Set up plates, place the boards |
| `OnAimChanged(aim, power, shot, pulling, handShake)` | Where the player is lining up, how far they pulled back, how shaky the hand is | Move the first-person hand and the aim ring |
| `OnThrowResult(result, boardBefore)` | The whole throw: flight samples, slide frames, where every bag ends up, what the wind did, the flick verdict | Start the throw animation and the far-board cam cut |
| `OnReplayFrame(result, frame)` | Every frame: where the thrown bag is (and height), and which other bags moved | Position the 3D bags |
| `OnCue(cue, reduceMotion)` | The moment a sound and/or LED light is due (the ring-in on a cornhole) | Flash the board (softer glow if `reduceMotion`) |
| `OnWind(wind)` | Wind speed and direction | Wave the streamers and the trees |
| `OnScore`, `OnMatchEnded`, `OnMatchClosed` | Score and end of match | Crowd reactions |

`ThrowReplay.At(result, ms, boardBefore)` (Core) turns a result into positions at any moment, so a presenter only has to draw.

## Setting it up (things that need you)

### 1. Open the project
See `unity/CornholeGreybox/README.md`. Set `baseUrl` in `Assets/Resources/iplay-cornhole-server.json` to your real address (https). Commit the `.meta` files and `ProjectSettings` Unity creates.

### 2. Server address and cleartext
Real builds must use **https** (iOS blocks plain http; Android does by default). For testing against a laptop over http, turn on Project Settings > Player > Other Settings > **Allow downloads over HTTP** for development builds only.

### 3. Voice (Unity Vivox)
The same Unity project can serve every iPlay game.
1. In the Unity Dashboard (cloud.unity.com), open the project's **Vivox** service and switch it on. Copy the **Issuer**, **Domain** and **Signing key**, plus the **Unity environment id**, into the server's `.env` (`VIVOX_ISSUER`, `VIVOX_DOMAIN`, `VIVOX_SIGNING_KEY`, `VIVOX_UNITY_ENVIRONMENT_ID`). If Street Dice already uses Vivox you can reuse the same four values.
2. In the Unity Editor: Edit > Project Settings > Services > link the project. The app signs in to Unity Authentication anonymously (like Street Dice) so Vivox can give each phone an identity.
3. **iOS:** add `NSMicrophoneUsageDescription` ("iPlay uses the microphone so you can talk to other players") in Player Settings. **Android:** the microphone permission is asked for at runtime (the code does it).
4. The server has to be started with the four `VIVOX_*` values, or voice is off.
5. Test on two real phones. Vivox is unfiltered voice: the match screen already offers Report and Block, and blocked players are muted on the blocker's phone.

### 4. Ads (AppLovin MAX): the only income
1. In the Unity Package Manager add **AppLovin MAX** (the scoped registry is already in `Packages/manifest.json`). Use AppLovin's **Integration Manager** (AppLovin > Integration Manager) to install the SDK and the ad networks you want.
2. Add `APPLOVIN_MAX` to Project Settings > Player > Scripting Define Symbols. This turns on `AppLovinAds.cs`.
3. Fill in `Assets/Resources/iplay-ads.json`: `sdkKey`, `interstitialUnitId`, `bannerUnitId` (from the AppLovin dashboard; one account for all your games, one app entry per game).
4. In the Integration Manager turn on **Terms and Privacy Policy flow** (Apple's tracking prompt and the EU/UK consent screen). The code treats ads as allowed only after that flow has run.
5. On the server set `ADS_ENABLED=true` and tune `ADS_INTERSTITIAL_EVERY_N_MATCHES` (default 3) and `ADS_MIN_SECONDS_BETWEEN_INTERSTITIALS` (default 180). **Ads never show during a match.**
6. AppLovin changes its API between versions. `AppLovinAds.cs` was written against the classic API and has not been compiled against a real install: check it against the version you install (the calls are `MaxSdk.InitializeSdk`, `CreateBanner`, `LoadInterstitial`, `ShowInterstitial`, and the callbacks).
7. Every ad network you turn on inside MAX must be listed in your privacy policy and in the Apple and Google store forms.

### 5. Sign in with Apple and Google
The server accepts both (set `APPLE_CLIENT_IDS`, `GOOGLE_CLIENT_IDS`). The phone needs a native plugin for each, because the system sign-in sheets are native:
- Apple: the "Sign in with Apple" Unity plugin; Google: the Google Sign-In plugin for Unity.
- Write a small class that derives from `IdentityProvider` (in `CornholeApp.Menu.cs`): `Name` is `"apple"` or `"google"`, and `SignInAsync()` shows the sheet and returns the token and the random nonce you gave it. Add it to `CornholeApp.IdentityProviders` at start-up. The Profile screen then shows the "Sign in with…" buttons by itself.
- **Apple requires Sign in with Apple** if you offer Google. Guests can play without either.
- The server has never talked to the real Apple/Google servers (it was tested with locally made keys). Test a real sign-in on a real phone before launch.

### 6. Invite links opening the app
Friends' invite links look like `https://your-domain/join/ABCD2345`. To open the app directly: set `APPLE_TEAM_ID`, `IOS_BUNDLE_ID` and the Android values in the server `.env` (the server then serves the files iPhones and Androids check), and in Unity add the **Associated Domains** entitlement (iOS) and an **intent filter** (Android). The app already reads `Application.deepLinkActivated`.

### 7. Keep the login safe
The session token is saved in `PlayerPrefs` (plain text on the phone). That is fine for a first release, but the better home is the iOS Keychain / Android Keystore: swap `PlayerPrefsStore` for a secure-storage plugin (it is one small class implementing `IKeyValueStore`).

### 8. Screen shape
**Decided: landscape**, same as Street Dice. `CornholeApp` locks auto-rotation to landscape left/right at start. In Player Settings set Default Orientation to Auto Rotation with only Landscape Left and Landscape Right ticked, so the splash screen matches. The flick is still a swipe up the screen; the throw code does not care about the screen shape.

### 9. Build settings
Bundle id (for example `com.iplay.cornhole`), version (`Application.version` becomes the app version the server checks; use `1.0.0` style), IL2CPP, ARM64, minimum iOS/Android versions as for Street Dice.

## How it was checked

- The brain: **57 tests that need nothing but mono**, and **10 more that drive a real server**: sign-in, the 18+ refusal, the wind maths matching the server's physics to the hundredth of an inch, a whole ranked search between two "phones", a 2v2 duo party, voice tokens, blocking, leaderboards, and deleting an account. Run them with `unity/CornholeGreybox/Tools/CoreTests/run-core-tests.sh` (add `--live http://127.0.0.1:3000` for the real-server ones).
- The plain stage (screens, touches, Vivox, ads): **compiled against Unity's real engine API** (reference assemblies, `Tools/UnityStubs/check-unity-layer.sh`), and against stand-ins for Vivox and AppLovin, whose packages could not be downloaded here. That found real mistakes (a name clash with Unity's own `Screen`). **It has never been run in Unity.** Expect small fixes on the first open.
