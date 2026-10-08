#!/bin/bash
# Builds Keel.app — a thin native window around the Keel web UI.
#
#   bash mac/build-app.sh --server https://your.tracker [dest-dir]
#                                            default dest-dir: ~/Applications
#
# --server (or SERVER_URL in the environment) is the address the app loads; it is
# written into the bundle's Info.plist, so every kind of launch agrees on it.
#
# The UI is served by the Keel server, so a web deploy needs NO rebuild.
# Rebuild only after editing mac/Keel/main.swift or mac/icon.swift.
#
# Everything is built in mac/build/ (gitignored). The signed bundle stays at
# mac/build/Keel.app — that is what mac/notarize.sh ships — and a copy goes
# to dest-dir. Signing uses a "Developer ID Application" identity when the
# keychain has one; otherwise it is ad-hoc, which runs on this Mac only.
set -euo pipefail

SERVER_URL="${SERVER_URL:-}"
DEST_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER_URL="${2:-}"; shift 2 ;;
    --server=*) SERVER_URL="${1#--server=}"; shift ;;
    *) DEST_ARG="$1"; shift ;;
  esac
done
case "$SERVER_URL" in
  http://*|https://*) ;;
  *) echo "✕ give the server: bash mac/build-app.sh --server https://your.tracker  (or set SERVER_URL)" >&2; exit 1 ;;
esac
SERVER_URL="${SERVER_URL%/}"
# dest-dir is resolved against the caller's directory, before the cd below.
DEST_ARG="${DEST_ARG:-$HOME/Applications}"
mkdir -p "$DEST_ARG"
DEST="$(cd "$DEST_ARG" && pwd)"

cd "$(dirname "$0")/.."
REPO="$(pwd)"
MAC="$REPO/mac"
BUILD="$MAC/build"
BUNDLE="$BUILD/Keel.app"
APP="$DEST/Keel.app"

VERSION="0.1.0"
BUILD_NUMBER="$(git -C "$REPO" rev-list --count HEAD 2>/dev/null || true)"
case "$BUILD_NUMBER" in ''|*[!0-9]*) BUILD_NUMBER=1 ;; esac   # no commits yet, or not a repo
ARCH="$(uname -m)"
MIN_MACOS="13.0"   # the -target below is what makes LSMinimumSystemVersion true;
                   # plain swiftc builds for the SDK's own macOS version

echo "→ compiling ($ARCH, macOS $MIN_MACOS+)…"
mkdir -p "$BUILD"
# -swift-version 6: main.swift is written for strict concurrency and builds
# warning-free under it. Pinned so a toolchain's default can't change the build.
swiftc -O -swift-version 6 -target "$ARCH-apple-macos$MIN_MACOS" \
  -o "$BUILD/Keel" "$MAC/Keel/main.swift" \
  -framework AppKit -framework WebKit -framework AuthenticationServices

echo "→ icon…"
swift -swift-version 6 "$MAC/icon.swift" "$BUILD/icon-1024.png"
rm -rf "$BUILD/icon.iconset"
mkdir -p "$BUILD/icon.iconset"
for s in 16 32 128 256 512; do
  d=$((s * 2))
  sips -z "$s" "$s" "$BUILD/icon-1024.png" --out "$BUILD/icon.iconset/icon_${s}x${s}.png" > /dev/null
  sips -z "$d" "$d" "$BUILD/icon-1024.png" --out "$BUILD/icon.iconset/icon_${s}x${s}@2x.png" > /dev/null
done
cp "$BUILD/icon-1024.png" "$BUILD/icon.iconset/icon_512x512@2x.png"   # the original, not a resample
iconutil -c icns "$BUILD/icon.iconset" -o "$BUILD/icon.icns"

echo "→ bundling…"
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
cp "$BUILD/Keel" "$BUNDLE/Contents/MacOS/Keel"
cp "$BUILD/icon.icns" "$BUNDLE/Contents/Resources/icon.icns"

cat > "$BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Keel</string>
  <key>CFBundleDisplayName</key><string>Keel</string>
  <key>CFBundleExecutable</key><string>Keel</string>
  <key>CFBundleIdentifier</key><string>com.duytran.Keel</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$BUILD_NUMBER</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>ServerURL</key><string>$SERVER_URL</string>
  <key>LSMinimumSystemVersion</key><string>$MIN_MACOS</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSRequiresAquaSystemAppearance</key><false/>
  <!-- NSAllowsLocalNetworking covers .local, bare hostnames and the RFC 1918
       ranges, so a dev server on the LAN loads over plain http. It does NOT
       cover a Tailscale address (100.64.0.0/10), which failed with
       NSURLErrorDomain -1022 and a blank window in a sibling app.
       ...InWebContent frees the web view only; ATS stays on for anything else. -->
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSAllowsArbitraryLoadsInWebContent</key><true/>
  </dict>
</dict>
</plist>
PLIST
plutil -lint -s "$BUNDLE/Contents/Info.plist"

echo "→ signing…"
DEVID_LINE="$(security find-identity -v -p codesigning 2>/dev/null | grep -m1 '"Developer ID Application:' || true)"
if [ -n "$DEVID_LINE" ]; then
  DEVID_HASH="$(echo "$DEVID_LINE" | awk '{ print $2 }')"          # the hash: a renewed cert can share the name
  DEVID_NAME="$(echo "$DEVID_LINE" | sed -e 's/^[^"]*"//' -e 's/"$//')"
  codesign --force --options runtime --timestamp --sign "$DEVID_HASH" "$BUNDLE"
  echo "  signed: $DEVID_NAME (hardened runtime, timestamped) — ready for bash mac/notarize.sh"
else
  codesign --force --sign - "$BUNDLE"
  echo "  ⚠️  ad-hoc signed: no \"Developer ID Application\" identity in the keychain."
  echo "     Runs on this Mac only; Gatekeeper refuses it on a teammate's Mac."
  echo "     For them: install a Developer ID cert, rebuild, then bash mac/notarize.sh"
fi
codesign --verify --strict "$BUNDLE"

if [ "$APP" != "$BUNDLE" ]; then
  echo "→ installing to $DEST…"
  rm -rf "$APP"
  ditto "$BUNDLE" "$APP"
fi
touch "$APP"   # nudges Finder and the Dock to pick up a changed icon

echo "✅ $APP  (v$VERSION, build $BUILD_NUMBER, server $SERVER_URL)"
if pgrep -f "Keel.app/Contents/MacOS/Keel" > /dev/null; then
  echo "   Keel is running: ⌘Q it and reopen, or the running copy keeps the old build"
  echo "   (a second launch only raises the first — one copy, always)."
fi
