# Shared hand rig

Cornhole uses the same first-person hand as Street Dice. The package is `com.iplay.handrig` in [iPlay-StreetDice](https://github.com/unclesme15-a11y/iPlay-StreetDice), pinned in `unity/CornholeGreybox/Packages/manifest.json`:

```
https://github.com/unclesme15-a11y/iPlay-StreetDice.git?path=/unity/Packages/com.iplay.handrig#89462fdcff569a2975c438828208199c531b7cb5
```

That commit is on `cursor/shared-iplay-hand-rig`. The path is `unity/Packages/com.iplay.handrig` with the leading slash Package Manager expects. Do not point this at `main`. Source PR: https://github.com/unclesme15-a11y/iPlay-StreetDice/pull/3

The Street Dice repo is private, so Unity needs git credentials for `github.com/unclesme15-a11y/iPlay-StreetDice` before Package Manager can resolve that git URL. If credentials are not available, switch the manifest entry to a local `file:` path that points at a checkout of the same package, for example `file:/absolute/path/to/iPlay-StreetDice/unity/Packages/com.iplay.handrig`. Do not commit a machine-local `file:` path.

The package id `com.iplay.handrig` could not be re-read from that private commit while this change was written. It matches the folder name and the pin above. `Assets/Scripts/Unity/IPlay.Cornhole.asmdef` (assembly `IPlay.Cornhole`) references the rig runtime assembly as `IPlay.HandRig`, which is the namespace `SharedHandRigPresenter` imports. If the package asmdef uses another name, change that one reference to match. The core assembly `IPlay.Cornhole.Core` stays free of Unity and of the rig.

`SharedHandRigPresenter` (`Assets/Scripts/Unity/SharedHandRigPresenter.cs`) is a `MatchPresenter`. The greybox does not add it, so the top-down board is unchanged until you opt in:

```csharp
SharedHandRigPresenter.Attach(gameObject);
```

or put the component on an object in the scene. It spawns the shared rig with the cornhole bag prop. The purchased hand is not in git. Until Sme names that asset, the rig uses the placeholder hand. Drop the purchased prefabs at `Resources/FirstPersonHands/FirstPersonHand_L` and `FirstPersonHand_R` when the path is known. That name and path are still open.

On release the bag raises `BagReleased` with a `CornholeArcHandoff` (origin, lofted direction, speed, rotation). Wire that to a projectile or arc. The server flight is still `OnReplayFrame`. This presenter does not score the throw.

Imagine does not generate the hand. The hand is this Unity rig, drawn over footage.

The package was not compiled or played in the Unity editor from the change that added it.
