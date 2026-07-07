#!/usr/bin/env bash
# Build a signed .zxp of the Premiere extension (extension/ folder) so end
# users can install it with ZXP Installer / anastasiy — no folder copying.
#
# Uses Adobe's ZXPSignCmd with a self-signed certificate (fine for sideloading;
# an Adobe-listed distribution would need an Exchange listing instead).
#
# Usage:  scripts/build-zxp.sh [output-dir]   (default: dist/)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist}"
SRC="$ROOT/extension"
VERSION="$(node -p "require('$ROOT/package.json').version")"
ZXP="$OUT/Subsper-Premiere-$VERSION.zxp"
TOOLS="$ROOT/.zxp-tools"
CERT="$TOOLS/subsper-selfsigned.p12"
CERT_PASS="subsper"

mkdir -p "$OUT" "$TOOLS"

# 1) Fetch ZXPSignCmd once (Adobe CEP-Resources repo, 4.1.3 ships raw binaries)
case "$(uname -s)" in
  Darwin) BIN="$TOOLS/ZXPSignCmd"
          URL="https://github.com/Adobe-CEP/CEP-Resources/raw/master/ZXPSignCMD/4.1.3/macOS/ZXPSignCmd" ;;
  *)      BIN="$TOOLS/ZXPSignCmd.exe"
          URL="https://github.com/Adobe-CEP/CEP-Resources/raw/master/ZXPSignCMD/4.1.3/x64/ZXPSignCmd.exe" ;;
esac

if [ ! -x "$BIN" ]; then
  echo "· downloading ZXPSignCmd…"
  curl -fsSL "$URL" -o "$BIN"
  chmod +x "$BIN"
  # macOS quarantines downloaded binaries — clear it so CI can execute
  xattr -d com.apple.quarantine "$BIN" 2>/dev/null || true
fi

# 2) Self-signed cert (created once, reused)
if [ ! -f "$CERT" ]; then
  echo "· generating self-signed certificate…"
  "$BIN" -selfSignedCert TR Istanbul zipheron Subsper "$CERT_PASS" "$CERT"
fi

# 3) Stage a clean copy (skip repo noise) and sign
STAGE="$(mktemp -d)/com.whisper.studio"
mkdir -p "$STAGE"
rsync -a --exclude ".git" --exclude "__pycache__" --exclude ".DS_Store" "$SRC/" "$STAGE/"

rm -f "$ZXP"
echo "· signing → $ZXP"
"$BIN" -sign "$STAGE" "$ZXP" "$CERT" "$CERT_PASS" -tsa http://timestamp.digicert.com \
  || "$BIN" -sign "$STAGE" "$ZXP" "$CERT" "$CERT_PASS"   # retry without TSA if it's down

rm -rf "$(dirname "$STAGE")"
echo "✓ $(du -h "$ZXP" | cut -f1) $ZXP"
