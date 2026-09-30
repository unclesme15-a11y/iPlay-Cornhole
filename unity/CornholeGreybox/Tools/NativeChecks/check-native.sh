#!/usr/bin/env bash
# Compiles the phone-native plugins without Xcode or Android Studio:
#   - Assets/Plugins/Android/IPlayNative.java with javac, against the real Android 14 framework (Robolectric's
#     android-all jar from Maven Central, downloaded once) plus stand-ins for androidx.credentials / googleid / UnityPlayer.
#   - Assets/Plugins/iOS/IPlayNative.mm with clang (syntax, types and ARC rules) against small stand-in headers for
#     Foundation, Security and AuthenticationServices. That cannot prove the headers match Apple's; Xcode is the real test.
# Needs: javac (11+), clang, curl.
set -euo pipefail
cd "$(dirname "$0")"
PLUGINS=../../Assets/Plugins
OUT="${TMPDIR:-/tmp}/iplay-native-check"
CACHE="${ANDROID_JAR_CACHE:-$HOME/.cache/iplay-android}"
JAR_VER=14-robolectric-10818077
JAR="$CACHE/android-all-$JAR_VER.jar"
mkdir -p "$OUT" "$CACHE"

if [ ! -s "$JAR" ]; then
  echo "Downloading the Android 14 framework jar (android-all $JAR_VER, about 130 MB)..."
  curl -fsSL -o "$JAR.partial" "https://repo1.maven.org/maven2/org/robolectric/android-all/$JAR_VER/android-all-$JAR_VER.jar"
  mv "$JAR.partial" "$JAR"
fi

rm -rf "$OUT/classes"
mkdir -p "$OUT/classes"
javac --release 11 -Xlint:all,-options,-processing,-classfile,-serial -Werror -d "$OUT/classes" -cp "$JAR" \
  $(find android-stubs -name '*.java') "$PLUGINS/Android/IPlayNative.java"
echo "Android plugin compiles (javac, real Android 14 framework)."

clang -fsyntax-only -nostdinc -x objective-c++ -fobjc-arc -fblocks -fobjc-runtime=ios-13.0 -target arm64-apple-ios13.0 \
  -Iios-stubs -Wall -Wextra -Werror "$PLUGINS/iOS/IPlayNative.mm"
echo "iOS plugin compiles (clang, ARC, stand-in Apple headers)."
