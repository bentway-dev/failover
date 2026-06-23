#!/usr/bin/env bash
# Run @microsoft/api-extractor for every `api-extractor.*.json` config at
# the repo root, diffing the live extraction against the committed
# `etc/*.api.md` snapshot. Any drift fails the gate.
#
# The script auto-discovers configs by glob — add a new `exports` subpath
# by writing one extends-only `api-extractor.<sub>.json` (see the bundle's
# api-extractor-base.json) and the gate picks it up on the next run. No
# script edit needed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PKG_DIR"

if [ ! -d dist ]; then
  echo "check-api-report: dist/ absent — run 'pnpm build' first." >&2
  exit 1
fi

shopt -s nullglob
configs=( api-extractor.*.json )
if [ ${#configs[@]} -eq 0 ]; then
  echo "check-api-report: no api-extractor.*.json configs found." >&2
  echo "  Author one per `exports` subpath; see api-extractor-base.json." >&2
  exit 1
fi

for cfg in "${configs[@]}"; do
  ./node_modules/.bin/api-extractor run --config "$cfg"
done
echo "check-api-report: public API matches committed snapshot (${#configs[@]} entry point(s))."
