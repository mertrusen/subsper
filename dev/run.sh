#!/usr/bin/env bash
# Launch the desktop app for local testing.
#
# WHY THIS EXISTS: the repo lives under ~/Documents, which is synced by iCloud
# Drive. iCloud mangles .app bundles (Electron.app loses Frameworks/Info.plist),
# so `npx electron .` from node_modules gets killed by macOS as damaged/malware.
# We keep a known-good Electron outside iCloud and point it at the repo.
set -e
DEV="$HOME/Library/Application Support/subsper-dev/electron"
APP="$DEV/Electron.app/Contents/MacOS/Electron"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -x "$APP" ]; then
  echo "Electron not staged yet — extracting from the npm cache…"
  Z=$(find "$HOME/Library/Caches/electron" -name "electron-v31*darwin-arm64.zip" | head -1)
  [ -n "$Z" ] || { echo "No cached electron zip. Run: npm i electron@31 (then re-run)"; exit 1; }
  rm -rf "$DEV"; mkdir -p "$DEV"
  unzip -q "$Z" -d "$DEV"
  xattr -cr "$DEV/Electron.app"
  codesign --force --deep --sign - "$DEV/Electron.app" >/dev/null 2>&1 || true
fi

exec "$APP" "$REPO" "$@"
