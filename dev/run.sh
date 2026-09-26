#!/usr/bin/env bash
# Launch the desktop app only when macOS accepts the local Electron bundle.
# A damaged or revoked bundle must be replaced, never unquarantined or re-signed.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP="$REPO/node_modules/electron/dist/Electron.app"
EXEC="$APP/Contents/MacOS/Electron"

if [ ! -x "$EXEC" ]; then
  echo "Electron is missing. Install dependencies from a trusted source." >&2
  exit 1
fi
if ! codesign --verify --deep --strict "$APP" >/dev/null 2>&1 ||
   ! spctl --assess --type execute "$APP" >/dev/null 2>&1; then
  echo "macOS did not accept the Electron app. It will not be launched." >&2
  exit 1
fi

exec "$EXEC" "$REPO" "$@"
