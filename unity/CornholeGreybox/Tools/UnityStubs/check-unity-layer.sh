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

DEFINE=""
[ "${1:-}" = "ads" ] && DEFINE="-define:APPLOVIN_MAX"
mcs $DEFINE -target:library -out:"$OUT/UnityLayer.dll" -warnaserror:0618 \
  -r:System.Core -r:System.Net.Http -r:System $FACADES "${REFS[@]}" \
  ../../Assets/Scripts/Core/*.cs ../../Assets/Scripts/Unity/*.cs ServiceStubs.cs
echo "Unity layer compiles against the real UnityEngine API${DEFINE:+ (with ads)}."
