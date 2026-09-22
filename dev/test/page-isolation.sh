#!/usr/bin/env bash
# Run the page-isolation contract headlessly. Same reporting shape as
# dom-harness.sh: the page states its result in <title>.
#
#   dev/test/page-isolation.sh
#   REQUIRE_BROWSER=1 dev/test/page-isolation.sh    # CI: no browser is a failure
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="${TMPDIR:-/tmp}/subsper-iso"
PAGE="$DIR/page-isolation.html"

rm -rf "$DIR"; mkdir -p "$DIR"
python3 "$HERE/build-page-isolation.py" "$PAGE" >/dev/null || exit 1

BROWSER=""
for c in "google-chrome" "google-chrome-stable" "chromium" "chromium-browser" \
         "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then BROWSER="$c"; break; fi
done

if [ -z "$BROWSER" ]; then
    if [ "${REQUIRE_BROWSER:-0}" = "1" ]; then
        echo "[iso] no Chrome/Chromium found and REQUIRE_BROWSER=1 — failing rather than pretending to pass" >&2
        exit 1
    fi
    echo "[iso] no Chrome/Chromium found — skipping. Open this by hand instead:"
    echo "      $PAGE"
    exit 0
fi

echo "[iso] browser: $BROWSER"
OUT="$("$BROWSER" --headless --disable-gpu --no-sandbox \
        --virtual-time-budget=6000 --dump-dom "file://$PAGE" 2>/dev/null)"

TITLE="$(printf '%s' "$OUT" | sed -n 's/.*<title>SUBSPER-ISO \(.*\)<\/title>.*/\1/p' | head -1)"
if [ -z "$TITLE" ]; then
    echo "[iso] the page never reported a result — it probably threw. Tail of the DOM:" >&2
    printf '%s\n' "$OUT" | tail -25 >&2
    exit 1
fi

printf '%s' "$OUT" \
  | sed -n 's/.*<div id="iso-out">\(.*\)<\/div>.*/\1/p' \
  | tr '|' '\n' | sed 's/^ *//'

echo "[iso] $TITLE"
# A pass that checked nothing is the failure this suite exists to prevent.
case "$TITLE" in
  *"pass=0 "*) echo "[iso] hicbir sey kontrol edilmedi — FAILED"; exit 1 ;;
esac
case "$TITLE" in
  *"fail=0") ;;
  *) echo "[iso] FAILED"; exit 1 ;;
esac
echo "[iso] ok"
