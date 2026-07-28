#!/usr/bin/env bash
# socket-scan.sh — Wrapper for Socket CLI dependency scans.
#
# Usage:
#   socket-scan.sh [options] [target_dir]
#     --persist          Persistent dashboard scan (requires org access)
#     --org <slug>       Override organization
#     --repo-name <name> Repository name for dashboard metadata (maps to CLI --repo)
#     --branch <name>    Branch name for the scan
#     --reach            Run reachability analysis (enterprise only)
#     --raw              Skip output cleanup (pass through raw CLI output)
#
# Outputs clean JSON to stdout, diagnostics to stderr.
# Portable: macOS (Bash 3.2) + Linux. No jq, no Bash 4+ features.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---------- defaults ---------------------------------------------------------

PERSIST=false
ORG_OVERRIDE=""
REPO_NAME=""
BRANCH=""
REACH=false
RAW=false
TARGET_DIR="."

# ---------- parse args -------------------------------------------------------

while [ $# -gt 0 ]; do
  case "$1" in
    --persist)   PERSIST=true; shift ;;
    --org)       ORG_OVERRIDE="$2"; shift 2 ;;
    --repo-name) REPO_NAME="$2"; shift 2 ;;
    --branch)    BRANCH="$2"; shift 2 ;;
    --reach)     REACH=true; shift ;;
    --raw)       RAW=true; shift ;;
    -*)        echo "Unknown option: $1" >&2; exit 1 ;;
    *)         TARGET_DIR="$1"; shift ;;
  esac
done

# ---------- auth check -------------------------------------------------------

AUTH_JSON="$("$SCRIPT_DIR/socket-auth.sh" check)"

HAS_TOKEN="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).hasToken))" "$AUTH_JSON")"
TIER="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).tier)" "$AUTH_JSON")"
AUTH_ORG="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).org)" "$AUTH_JSON")"
CAN_PERSIST="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).canPersistScans))" "$AUTH_JSON")"
CAN_SCAN="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).canScan))" "$AUTH_JSON")"

# Auto-setup if no token
if [ "$HAS_TOKEN" = "false" ]; then
  echo "No token detected — running auto-setup..." >&2
  AUTH_JSON="$("$SCRIPT_DIR/socket-auth.sh" setup)"
  TIER="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).tier)" "$AUTH_JSON")"
  AUTH_ORG="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).org)" "$AUTH_JSON")"
  CAN_PERSIST="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).canPersistScans))" "$AUTH_JSON")"
  CAN_SCAN="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).canScan))" "$AUTH_JSON")"
fi

# Check if this token can create scans
if [ "$CAN_SCAN" = "false" ]; then
  echo "Error: Your current token (tier: $TIER) cannot create scans." >&2
  echo "The public demo token lacks the 'full-scans:create' permission." >&2
  echo "To scan, create a free account at https://socket.dev and authenticate with 'socket login' or set SOCKET_CLI_API_TOKEN." >&2
  exit 1
fi

# ---------- find socket command ----------------------------------------------

# Always use npx socket to ensure the latest CLI version.
SOCKET_CMD="npx socket"

# ---------- build scan command -----------------------------------------------

CMD="$SOCKET_CMD scan create --no-banner --no-spinner --json --no-interactive"

# Add --tmp unless persist mode AND account supports it
if [ "$PERSIST" = true ] && [ "$CAN_PERSIST" = "true" ]; then
  echo "Running persistent dashboard scan..." >&2
else
  CMD="$CMD --tmp"
  if [ "$PERSIST" = true ]; then
    echo "Warning: --persist requested but account cannot persist scans. Using --tmp." >&2
  fi
fi

# Org: use override, else auth org
SCAN_ORG="${ORG_OVERRIDE:-$AUTH_ORG}"
if [ -n "$SCAN_ORG" ]; then
  CMD="$CMD --org $SCAN_ORG"
fi

# Repo name (dashboard metadata)
if [ -n "$REPO_NAME" ]; then
  CMD="$CMD --repo $REPO_NAME"
fi

# Branch
if [ -n "$BRANCH" ]; then
  CMD="$CMD --branch $BRANCH"
fi

# Target directory (positional arg — must be last)
CMD="$CMD $TARGET_DIR"

# ---------- execute ----------------------------------------------------------

STDOUT_TMP="$(mktemp /tmp/socket-scan.XXXXXX)"
STDERR_TMP="$(mktemp /tmp/socket-scan.XXXXXX)"
trap 'rm -f "$STDOUT_TMP" "$STDERR_TMP"' EXIT

echo "Running: $CMD" >&2

set +e
eval "$CMD" >"$STDOUT_TMP" 2>"$STDERR_TMP"
EXIT_CODE=$?
set -e

# Show stderr diagnostics
if [ -s "$STDERR_TMP" ]; then
  cat "$STDERR_TMP" >&2
fi

if [ $EXIT_CODE -ne 0 ]; then
  echo "Scan failed (exit code $EXIT_CODE)." >&2
  # Detect 403 Forbidden — likely a token without scan permissions
  if grep -qi "403\|forbidden\|full-scans:create" "$STDERR_TMP" "$STDOUT_TMP" 2>/dev/null; then
    echo "" >&2
    echo "This looks like a permissions error. The public demo token cannot create scans." >&2
    echo "To scan dependencies, create a free account at https://socket.dev" >&2
    echo "and authenticate with 'socket login' or set SOCKET_CLI_API_TOKEN." >&2
  fi
  # Still output whatever stdout we got (may contain partial results)
  cat "$STDOUT_TMP"
  exit $EXIT_CODE
fi

# ---------- output -----------------------------------------------------------

if [ "$RAW" = true ]; then
  cat "$STDOUT_TMP"
else
  # Strip non-JSON lines (banners, spinners, ANSI noise) from stdout
  node -e "
    var fs = require('fs');
    var lines = fs.readFileSync(process.argv[1], 'utf-8').split('\n');
    var jsonLines = [];
    var inJson = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/[\x1b\x9b]\[[0-9;]*[a-zA-Z]/g, '').trim();
      if (!line) continue;
      if (line[0] === '{' || line[0] === '[' || inJson) {
        jsonLines.push(lines[i]);
        inJson = true;
      }
    }
    if (jsonLines.length > 0) {
      process.stdout.write(jsonLines.join('\n') + '\n');
    } else {
      // No JSON found — output everything (fallback)
      process.stdout.write(fs.readFileSync(process.argv[1], 'utf-8'));
    }
  " "$STDOUT_TMP"
fi

# ---------- reachability (optional) ------------------------------------------

if [ "$REACH" = true ]; then
  if [ "$TIER" = "enterprise" ]; then
    echo "Running reachability analysis..." >&2
    REACH_ORG="${ORG_OVERRIDE:-$AUTH_ORG}"
    REACH_CMD="$SOCKET_CMD scan reach --org $REACH_ORG $TARGET_DIR"
    echo "Running: $REACH_CMD" >&2
    eval "$REACH_CMD" >&2
  else
    echo "Skipping reachability analysis — requires enterprise tier (current: $TIER)." >&2
  fi
fi
