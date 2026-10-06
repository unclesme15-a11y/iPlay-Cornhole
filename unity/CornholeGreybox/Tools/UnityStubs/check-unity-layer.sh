#!/usr/bin/env bash
# Compiles the Unity-facing scripts (Assets/Scripts/Unity) with mono's compiler, on a machine with no Unity Editor:
#   - against Unity's REAL engine API (UnityEngine reference assemblies, 2021.3 LTS, downloaded once from NuGet), and
#   - against small stand-ins for Vivox, Unity Authentication and AppLovin MAX (ServiceStubs.cs).
# It catches typos, wrong types and calls that do not exist. It does not run anything: opening the project in Unity does.
#   ./check-unity-layer.sh            without ads
#   ./check-unity-layer.sh ads        with APPLOVIN_MAX defined (the ad code)
set -euo pipefail
cd "$(dirname "$0")"
OUT="${TMPDIR:-/tmp}/iplay-unity-check"
CACHE="${UNITY_REF_CACHE:-$HOME/.cache/iplay-unity-refs}"
PKG=unityengine.modules
VER=2021.3.33
mkdir -p "$OUT" "$CACHE"

REFDIR="$CACHE/$PKG.$VER/lib/net45"
if [ ! -f "$REFDIR/UnityEngine.CoreModule.dll" ]; then
  echo "Downloading Unity's engine reference assemblies ($PKG $VER) from NuGet..."
  curl -fsSL -o "$CACHE/$PKG.$VER.nupkg" "https://api.nuget.org/v3-flatcontainer/$PKG/$VER/$PKG.$VER.nupkg"
  unzip -qo "$CACHE/$PKG.$VER.nupkg" -d "$CACHE/$PKG.$VER"
fi

FACADES=""
for d in /usr/lib/mono/4.5/Facades /usr/lib/mono/4.7.2-api/Facades /Library/Frameworks/Mono.framework/Versions/Current/lib/mono/4.5/Facades; do
  [ -f "$d/netstandard.dll" ] && { FACADES="-r:$d/netstandard.dll"; break; }
done

REFS=()
for f in "$REFDIR"/UnityEngine*.dll; do REFS+=("-r:$f"); done

ADS=""
[ "${1:-}" = "ads" ] && ADS="APPLOVIN_MAX"
# Once as the Editor sees it, once as an iPhone build and once as an Android build (the native sign-in and secure
# storage code only exists in those).
# UNITY_ANDROID;FIREBASE_MESSAGING: an Android build once the Firebase SDK is added (push notifications on Android).
for PLATFORM in "" UNITY_IOS UNITY_ANDROID "UNITY_ANDROID FIREBASE_MESSAGING"; do
  DEFINES="$(echo "$ADS $PLATFORM" | xargs | tr ' ' ';')"
  mcs ${DEFINES:+-define:$DEFINES} -target:library -out:"$OUT/UnityLayer.dll" -warnaserror:0618 \
    -r:System.Core -r:System.Net.Http -r:System $FACADES "${REFS[@]}" \
    ../../Assets/Scripts/Core/*.cs ../../Assets/Scripts/Unity/*.cs ServiceStubs.cs
  echo "Unity layer compiles against the real UnityEngine API (${PLATFORM:-Editor}${ADS:+, with ads})."
done

# The Editor build scripts (Assets/Editor): against Unity's real Editor API (2021.1 reference assembly, the newest on
# NuGet; every call used also exists in Unity 6) and stand-ins for the Xcode project API (XcodeStubs.cs).
EDPKG=unity3d.sdk
EDVER=2021.1.14.1
EDDIR="$CACHE/$EDPKG.$EDVER/lib"
if [ ! -f "$EDDIR/UnityEditor.dll" ]; then
  echo "Downloading Unity's Editor reference assembly ($EDPKG $EDVER) from NuGet..."
  curl -fsSL -o "$CACHE/$EDPKG.$EDVER.nupkg" "https://api.nuget.org/v3-flatcontainer/$EDPKG/$EDVER/$EDPKG.$EDVER.nupkg"
  unzip -qo "$CACHE/$EDPKG.$EDVER.nupkg" -d "$CACHE/$EDPKG.$EDVER"
fi
for PLATFORM in "" UNITY_IOS; do
  mcs ${PLATFORM:+-define:$PLATFORM} -target:library -out:"$OUT/UnityEditorScripts.dll" \
    -r:System.Core -r:System.Xml $FACADES "${REFS[@]}" -r:"$EDDIR/UnityEditor.dll" \
    ../../Assets/Editor/*.cs XcodeStubs.cs
  echo "Editor build scripts compile against the real UnityEditor API (${PLATFORM:-Android/Editor})."
done

# Run the Android manifest / Gradle patches on a Unity 6-shaped project and check the result.
mcs -out:"$OUT/AndroidBuildTest.exe" -r:System.Core -r:System.Xml $FACADES "${REFS[@]}" -r:"$EDDIR/UnityEditor.dll" \
  AndroidBuildTest.cs ../../Assets/Editor/IPlayAndroidBuild.cs ../../Assets/Editor/IPlayProjectSetup.cs
MONO_PATH="$REFDIR:$EDDIR" mono "$OUT/AndroidBuildTest.exe" testdata/AndroidManifest.unity6.xml
