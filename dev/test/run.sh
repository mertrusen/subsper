#!/usr/bin/env bash
# Run the unit suite. Uses Node when it is installed (CI, most dev machines) and
# falls back to macOS JavaScriptCore via osascript, so the tests still run on a
# freshly-reset Mac with no Node.
#
#   dev/test/run.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="${TMPDIR:-/tmp}/subsper-test-bundle.js"

python3 "$HERE/build-bundle.py" "$BUNDLE"

if command -v node >/dev/null 2>&1; then
    echo "[test] runtime: node $(node --version)"
    exec node "$BUNDLE"
elif [ "$(uname -s)" = "Darwin" ]; then
    echo "[test] runtime: JavaScriptCore (no node found)"
    # JXA cannot set an exit code from the script, and a thrown error exits 1
    # with the message on stderr — so capture both and decide from the summary.
    set +e
    OUT="$(osascript -l JavaScript "$BUNDLE" 2>&1)"
    RC=$?
    set -e
    echo "$OUT"
    if [ $RC -ne 0 ] && ! grep -q "execution error" <<<"$OUT"; then
        echo "[test] runtime failed (exit $RC)"; exit 1
    fi
    grep -q "execution error" <<<"$OUT" && { echo "[test] a test file crashed"; exit 1; }
    grep -qE ", 0 failed$" <<<"$OUT" || { echo "[test] FAILED"; exit 1; }
else
    echo "[test] no JavaScript runtime available (install node)" >&2
    exit 1
fi
