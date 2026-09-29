#!/usr/bin/env bash
# Compiles the Unity-facing scripts (Assets/Scripts/Unity) against small stand-ins for the Unity, Vivox and AppLovin APIs.
# This catches typos, wrong types and missing members in OUR code. It cannot prove the stand-ins match the real Unity APIs:
# only opening the project in Unity does that. See UnityStubs.cs.
#   ./check-unity-layer.sh            without ads
#   ./check-unity-layer.sh ads        with APPLOVIN_MAX defined (the ad code)
set -euo pipefail
cd "$(dirname "$0")"
OUT="${TMPDIR:-/tmp}/iplay-unity-check"
mkdir -p "$OUT"
DEFINE=""
[ "${1:-}" = "ads" ] && DEFINE="-define:APPLOVIN_MAX"
mcs $DEFINE -target:library -out:"$OUT/UnityLayer.dll" \
  -r:System.Core -r:System.Net.Http -r:System \
  ../../Assets/Scripts/Core/*.cs ../../Assets/Scripts/Unity/*.cs UnityStubs.cs
echo "Unity layer compiles against the stand-ins${DEFINE:+ (with ads)}."
