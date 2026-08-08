#!/usr/bin/env bash
# The desktop app and the Premiere extension share their front-end verbatim.
# scripts/sync-from-extension.sh keeps them in step by hand, which means a fix
# landed in one copy and forgotten in the other ships as a silent behaviour
# difference between the two products. This turns that invariant into a check.
#
# index.html is the one deliberate exception: the extension loads
# CSInterface + main.js, the desktop loads desktop-shim + main.js + desktop-app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
fail=0

for f in js/main.js js/whispercpp.js js/features-v2.js js/ui-v2.js css/style.css css/ui-v2.css; do
    if ! diff -q "extension/$f" "$f" >/dev/null 2>&1; then
        echo "OUT OF SYNC: extension/$f differs from $f"
        diff "extension/$f" "$f" | head -20 || true
        fail=1
    fi
done

for f in scripts/check_setup.py scripts/detect_silence.py scripts/enhance_audio.py \
         scripts/extract_audio.py scripts/transcribe.py; do
    if [ -f "extension/$f" ] && ! diff -q "extension/$f" "$f" >/dev/null 2>&1; then
        echo "OUT OF SYNC: extension/$f differs from $f"
        fail=1
    fi
done

# index.html: everything except the script footer must match.
strip_footer() { grep -vE 'js/(CSInterface|desktop-shim|desktop-app)\.js|desktop-app overrides' "$1"; }
if ! diff -q <(strip_footer extension/index.html) <(strip_footer index.html) >/dev/null; then
    echo "OUT OF SYNC: index.html differs beyond the script footer"
    diff <(strip_footer extension/index.html) <(strip_footer index.html) | head -20 || true
    fail=1
fi

# And each copy must keep the footer it needs.
grep -q 'js/CSInterface.js'  extension/index.html || { echo "extension/index.html lost its CSInterface footer"; fail=1; }
grep -q 'js/desktop-app.js'  index.html           || { echo "index.html lost its desktop-app footer";        fail=1; }
grep -q 'js/CSInterface.js'  index.html           && { echo "index.html has the EXTENSION footer — sync script bug"; fail=1; }

[ $fail -eq 0 ] && echo "✓ desktop and extension copies are in sync"
exit $fail
