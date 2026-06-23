#!/usr/bin/env bash
# Per-module LOC cap for the package's src/ tree.
#
# Default cap is 500 LOC. A module that genuinely needs more (e.g. a
# turn-loop that must stay whole to preserve byte-identical goldens)
# can be allowlisted by adding a case branch below.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(dirname "$SCRIPT_DIR")/src"

if [ ! -d "$SRC_DIR" ]; then
  echo "check-file-sizes: src/ absent — nothing to check."
  exit 0
fi

DEFAULT_CAP=500

cap_for() {
  case "$1" in
    # Add allowlisted modules here, one case per file:
    #   */some-large-module.mjs) echo 950 ;;
    *) echo "$DEFAULT_CAP" ;;
  esac
}

fail=0
while IFS= read -r -d '' f; do
  lines=$(wc -l < "$f" | tr -d ' ')
  cap=$(cap_for "$f")
  if [ "$lines" -gt "$cap" ]; then
    echo "FAIL: ${f#"$SRC_DIR"/} is $lines lines (cap $cap)"
    fail=1
  fi
done < <(find "$SRC_DIR" -type f -name '*.mjs' -print0)

if [ "$fail" -ne 0 ]; then
  echo "check-file-sizes: module(s) exceed their cap." >&2
  exit 1
fi

count=$(find "$SRC_DIR" -type f -name '*.mjs' | wc -l | tr -d ' ')
echo "check-file-sizes: $count module(s) within caps."
