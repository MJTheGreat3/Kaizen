#!/bin/sh
# Builds Kaizen.app with its desktop widgets (src-tauri/macos/widgets, a
# WidgetKit extension) inside, signed ad hoc; with --dmg, also a disk image.
#   scripts/build-mac.sh [--dmg out.dmg]
# Needs Xcode. Leaves the app in src-tauri/target/release/bundle/macos.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$root/src-tauri/tauri.conf.json")"
build="$(echo "$version" | awk -F. '{ print $1 * 1000000 + $2 * 1000 + $3 }')"
derived="$root/src-tauri/target/widgets-build"
app="$root/src-tauri/target/release/bundle/macos/Kaizen.app"

xcodebuild -quiet -project "$root/src-tauri/macos/widgets/KaizenWidgets.xcodeproj" -scheme KaizenWidgets \
  -configuration Release -derivedDataPath "$derived" \
  MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$build"
(cd "$root" && pnpm tauri build --bundles app)

rm -rf "$app/Contents/PlugIns"
mkdir -p "$app/Contents/PlugIns"
ditto "$derived/Build/Products/Release/KaizenWidgets.appex" "$app/Contents/PlugIns/KaizenWidgets.appex"
# The extension keeps its own signature (and sandbox); this seals the app around it.
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"
echo "built $app ($version)"

if [ "${1:-}" = "--dmg" ]; then
  out="$2"
  stage="$(mktemp -d)"
  ditto "$app" "$stage/Kaizen.app"
  ln -s /Applications "$stage/Applications"
  rm -f "$out"
  hdiutil create -quiet -volname Kaizen -srcfolder "$stage" -format UDZO "$out"
  rm -rf "$stage"
  echo "built $out"
fi
