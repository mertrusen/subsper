#!/usr/bin/env bash
# Sync shared files from the Premiere CEP extension into the desktop app.
# CRITICAL: the extension's index.html ships a CSInterface+main.js footer; the
# desktop needs desktop-shim → main → desktop-app instead. This script copies
# the shared files AND restores the desktop footer so we never ship a broken
# desktop build again (the v1.1.0 regression).
set -e
EXT="${SUBSPER_EXT:-/Users/mert/Library/Application Support/Adobe/CEP/extensions/com.whisper.studio}"
DESK="$(cd "$(dirname "$0")/.." && pwd)"

for f in js/main.js js/whispercpp.js css/style.css index.html; do
  cp "$EXT/$f" "$DESK/$f"
done
cp "$EXT"/scripts/*.py "$DESK/scripts/" 2>/dev/null || true

node -e '
const fs = require("fs"), p = process.argv[1];
let s = fs.readFileSync(p, "utf8");
const ext  = `  <script src="js/CSInterface.js"></script>\n  <script src="js/main.js"></script>`;
const desk = `  <script src="js/desktop-shim.js"></script>\n  <script src="js/main.js"></script>\n  <script src="js/desktop-app.js"></script>`;
if (s.includes(ext)) { fs.writeFileSync(p, s.replace(ext, desk)); console.log("✓ desktop footer restored"); }
else if (s.includes(desk)) console.log("✓ footer already desktop");
else { console.error("⚠ footer pattern not found — check index.html manually"); process.exit(1); }
' "$DESK/index.html"

echo "✓ synced shared files from extension → desktop"
