#!/usr/bin/env bash
# Kept for old local commands. The repository desktop copy is the source of
# truth; never import an older installed CEP extension over this checkout.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/scripts/sync-to-extension.sh"
