#!/usr/bin/env bash
# Refresh the Premiere package from this repository's shared desktop sources.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
for f in js/CSInterface.js js/main.js js/whispercpp.js js/features-v2.js js/ui-v2.js js/ui-v3.js \
         css/style.css css/ui-v2.css css/ui-v3.css css/panel.css; do
  cp "$f" "extension/$f"
done
mkdir -p extension/assets
rm -rf extension/assets/fonts
cp -R assets/fonts extension/assets/fonts
for f in scripts/check_setup.py scripts/detect_silence.py scripts/enhance_audio.py \
         scripts/extract_audio.py scripts/transcribe.py; do
  if [ -f "extension/$f" ]; then cp "$f" "extension/$f"; fi
done
cp index.html extension/index.html
python3 - <<'PY'
from pathlib import Path
p = Path('extension/index.html')
s = p.read_text()
s = s.replace('<script src="js/desktop-shim.js"></script>', '<script src="js/CSInterface.js"></script>')
s = s.replace('  <script src="js/desktop-app.js"></script>\n', '')
s = s.replace('  <script src="js/ui-v3.js"></script>', '  <script src="js/ui-v3.js"></script>\n  <script src="js/caption-exclusions.js"></script>')
p.write_text(s)
PY
bash dev/test/check-mirror.sh
