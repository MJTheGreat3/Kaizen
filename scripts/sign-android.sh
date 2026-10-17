#!/bin/sh
# Signs an APK with the release key, carrying the rotation from the old
# debug key (src-tauri/gen/android/signing-lineage.bin). Phones that had a
# debug build then take this one as an update and keep their data; new
# installs just see the release key. Usage: scripts/sign-android.sh in.apk [out.apk]
set -eu
in="$1"
out="${2:-$1}"
props="$(dirname "$0")/../src-tauri/gen/android/key.properties"
lineage="$(dirname "$0")/../src-tauri/gen/android/signing-lineage.bin"
sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
apksigner="$(ls -d "$sdk"/build-tools/* | tail -1)/apksigner"
prop() { grep "^$1=" "$props" | cut -d= -f2-; }
KS_PW="$(prop storePassword)"
KEY_PW="$(prop keyPassword)"
export KS_PW KEY_PW
"$apksigner" sign --in "$in" --out "$out" \
  --ks "$HOME/.android/debug.keystore" --ks-key-alias androiddebugkey --ks-pass pass:android \
  --next-signer --ks "$(prop storeFile)" --ks-key-alias "$(prop keyAlias)" --ks-pass env:KS_PW --key-pass env:KEY_PW \
  --lineage "$lineage" --rotation-min-sdk-version 28
"$apksigner" verify --print-certs "$out" | grep -m2 -E "Signer|SHA-256" || true
