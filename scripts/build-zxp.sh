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
#
# -validityDays is not optional here. ZXPSignCmd defaults to a short validity,
# and a .zxp signed with an expired certificate stops installing — for everyone
# who downloads it after that date, including people who already bought it.
if [ ! -f "$CERT" ]; then
  echo "· generating self-signed certificate (10-year validity)…"
  "$BIN" -selfSignedCert TR Istanbul zipheron Subsper "$CERT_PASS" "$CERT" -validityDays 3650
fi

# 3) Stage a clean copy (skip repo noise) and sign
STAGE="$(mktemp -d)/com.whisper.studio"
mkdir -p "$STAGE"
rsync -a --exclude ".git" --exclude "__pycache__" --exclude ".DS_Store" \
      --exclude "index-classic.html" --exclude "README.md" "$SRC/" "$STAGE/"

rm -f "$ZXP"
echo "· signing → $ZXP"

# The signature MUST be timestamped. Without a timestamp the .zxp becomes
# uninstallable the day the certificate expires, rather than staying valid
# because it was signed while the certificate was live.
#
# This used to fall back to an untimestamped signature whenever the TSA was
# unreachable — silently, so a momentary network blip produced a release that
# looked fine and quietly carried an expiry date. Try the backup TSAs, then
# fail loudly.
signed=0
for TSA in http://timestamp.digicert.com \
           http://timestamp.sectigo.com \
           http://timestamp.apple.com/ts01; do
  if "$BIN" -sign "$STAGE" "$ZXP" "$CERT" "$CERT_PASS" -tsa "$TSA"; then
    echo "· timestamped via $TSA"
    signed=1
    break
  fi
  echo "· TSA unavailable: $TSA — trying the next one"
  rm -f "$ZXP"
done

if [ "$signed" -ne 1 ]; then
  echo "ERROR: every timestamp authority failed." >&2
  echo "Refusing to ship an untimestamped .zxp — it would stop installing when" >&2
  echo "the signing certificate expires. Re-run when a TSA is reachable." >&2
  echo "(Override deliberately, for a local test build only: ALLOW_UNTIMESTAMPED=1)" >&2
  if [ "${ALLOW_UNTIMESTAMPED:-0}" = "1" ]; then
    echo "· ALLOW_UNTIMESTAMPED=1 — signing without a timestamp (DO NOT RELEASE THIS)" >&2
    "$BIN" -sign "$STAGE" "$ZXP" "$CERT" "$CERT_PASS"
  else
    rm -rf "$(dirname "$STAGE")"
    exit 1
  fi
fi

rm -rf "$(dirname "$STAGE")"
echo "✓ $(du -h "$ZXP" | cut -f1) $ZXP"
