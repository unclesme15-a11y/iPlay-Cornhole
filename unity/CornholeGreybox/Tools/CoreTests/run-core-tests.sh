#!/usr/bin/env bash
# Compiles the Unity-free core (Assets/Scripts/Core) and its tests with mono's C# compiler, and runs them.
#   ./run-core-tests.sh                                  offline tests
#   ./run-core-tests.sh --live http://127.0.0.1:3000     plus a real server (see Program.cs for how to start it)
# Needs: mono-mcs and mono-runtime (Ubuntu: apt-get install mono-mcs mono-runtime).
set -euo pipefail
cd "$(dirname "$0")"
OUT="${TMPDIR:-/tmp}/iplay-core-tests"
mkdir -p "$OUT"
mcs -debug -target:exe -out:"$OUT/CoreTests.exe" \
  -r:System.Core -r:System.Net.Http -r:System \
  ../../Assets/Scripts/Core/*.cs ../../Assets/Tests/EditMode/CoreSuite.cs Program.cs
exec mono --debug "$OUT/CoreTests.exe" "$@"
