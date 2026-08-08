#!/usr/bin/env bash
# Run the DOM harness headlessly.
#
# The unit suite runs in JavaScriptCore, which has no DOM — it cannot tell you
# whether clicking a word still splits a segment. This drives the real segment
# list in a real browser and asserts on what the click actually did.
#
#   dev/test/dom-harness.sh              # skips with a notice if no browser
#   REQUIRE_BROWSER=1 dev/test/dom-harness.sh    # CI: no browser is a failure
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PAGE="${TMPDIR:-/tmp}/subsper-dom-harness.html"

python3 "$HERE/build-dom-harness.py" "$PAGE" >/dev/null || exit 1

BROWSER=""
for c in "google-chrome" "google-chrome-stable" "chromium" "chromium-browser" \
         "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then BROWSER="$c"; break; fi
done

if [ -z "$BROWSER" ]; then
    if [ "${REQUIRE_BROWSER:-0}" = "1" ]; then
        echo "[dom] no Chrome/Chromium found and REQUIRE_BROWSER=1 — failing rather than pretending to pass" >&2
        exit 1
    fi
    echo "[dom] no Chrome/Chromium found — skipping. Open this by hand instead:"
    echo "      $PAGE"
    exit 0
fi

echo "[dom] browser: $BROWSER"
OUT="$("$BROWSER" --headless --disable-gpu --no-sandbox \
        --virtual-time-budget=8000 --dump-dom "file://$PAGE" 2>/dev/null)"

# The page reports through <title>: one line, trivially parsed, and present
# even if the body markup changes.
TITLE="$(printf '%s' "$OUT" | sed -n 's/.*<title>SUBSPER-DOM \(.*\)<\/title>.*/\1/p' | head -1)"
if [ -z "$TITLE" ]; then
    echo "[dom] the page never reported a result — it probably threw. Tail of the DOM:" >&2
    printf '%s\n' "$OUT" | tail -25 >&2
    exit 1
fi

# Also surface the readable log so a failure says WHICH test broke.
printf '%s' "$OUT" \
  | sed -n 's/.*<div id="out"[^>]*>\(.*\)<\/div>.*/\1/p' \
  | sed 's/&lt;/</g; s/&gt;/>/g; s/&amp;/\&/g'

echo "[dom] $TITLE"
case "$TITLE" in
  *"fail=0") ;;
  *) echo "[dom] FAILED"; exit 1 ;;
esac
echo "[dom] ok"
