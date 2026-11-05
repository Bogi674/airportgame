#!/usr/bin/env bash
# Runs every check a task must pass before it is committed, in order, and prints a summary.
# Usage: npm run verify            all checks
#        npm run verify -- quick   rules, types, lint and tests only (no stress)
set -u
cd "$(dirname "$0")/.."
quick="${1:-}"
results=()
fail=0
run() {
  local name="$1"; shift
  echo ""
  echo "=== $name: $*"
  if "$@"; then results+=("PASS  $name"); else results+=("FAIL  $name"); fail=1; fi
}
run rules node scripts/rules-check.mjs
run types npx tsc --noEmit -p .
run lint npm run lint --silent
run tests npm run test --silent
if [ "$quick" != "quick" ]; then
  run stress npm run stress --silent
fi
echo ""
echo "=== summary"
for r in "${results[@]}"; do echo "$r"; done
if [ "$fail" -ne 0 ]; then
  echo "verify: FAILED. Do not commit. Fix the first failing check and run it again."
  exit 1
fi
echo "verify: all checks passed."
