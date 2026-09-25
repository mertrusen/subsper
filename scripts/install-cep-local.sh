#!/usr/bin/env bash
# Install the current source into the local macOS CEP extension directory.
# Existing engine binaries remain in place; this does not create a ZXP/release.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.whisper.studio"

if pgrep -f 'Adobe Premiere Pro.*Contents/MacOS' >/dev/null 2>&1; then
  echo "Close Premiere before updating its CEP extension." >&2
  exit 1
fi

bash "$ROOT/scripts/sync-to-extension.sh"
mkdir -p "$DEST"
rsync -a --exclude '.DS_Store' --exclude '.gitignore' --exclude 'README.md' \
  --exclude '__pycache__' "$ROOT/extension/" "$DEST/"

node "$ROOT/dev/test/version-consistency.test.js"
cmp "$ROOT/extension/index.html" "$DEST/index.html"
cmp "$ROOT/extension/js/caption-exclusions.js" "$DEST/js/caption-exclusions.js"
cmp "$ROOT/extension/CSXS/manifest.xml" "$DEST/CSXS/manifest.xml"
echo "Installed Subsper $(node -p "require('$ROOT/package.json').version") at $DEST"
echo "Open Premiere to load this local version."
