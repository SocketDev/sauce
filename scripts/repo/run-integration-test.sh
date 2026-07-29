#!/bin/bash
# Run integration tests locally.
#
# Usage:
#   ./scripts/repo/run-integration-test.sh                  # All E2E tests with default agent
#   ./scripts/repo/run-integration-test.sh --agent codex    # Specific agent
#   ./scripts/repo/run-integration-test.sh --skill scan     # Specific skill
#   ./scripts/repo/run-integration-test.sh --agent gemini --skill review  # Both

set -euo pipefail

AGENT=${TEST_AGENT:-claude-code}
SKILL=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent) AGENT="$2"; shift 2 ;;
    --skill) SKILL="$2"; shift 2 ;;
    *) shift ;;
  esac
done

export RUN_E2E=1
export TEST_AGENT="$AGENT"

echo "Running integration tests with agent: $AGENT"

if [ -n "$SKILL" ]; then
  echo "Skill filter: $SKILL"
  pnpm exec vitest run --config tests/vitest.config.mts "tier3-e2e/${SKILL}.e2e.test.ts"
else
  pnpm run test:e2e
fi
