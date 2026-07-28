#!/usr/bin/env bash
# socket-auth.sh — Check and configure Socket CLI authentication.
#
# Usage:
#   socket-auth.sh check   — Output JSON auth state to stdout
#   socket-auth.sh setup   — Auto-configure public demo token if no token set
#
# Portable: macOS (Bash 3.2) + Linux. No jq, no Bash 4+ features.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

PUBLIC_TOKEN="sktsec_t_--RAN5U4ivauy4w37-6aoKyYPDt5ZbaT5JBVMqiwKo_api"
PUBLIC_ORG="SocketDemo"

# ---------- helpers ----------------------------------------------------------

# Always use npx socket to ensure the latest CLI version.
find_socket_cmd() {
  echo "npx socket"
}

# Emit a JSON string to stdout. Uses node for safe JSON encoding.
emit_json() {
  local hasToken="$1"
  local tokenSource="$2"
  local org="$3"
  local tier="$4"
  local canPersistScans="$5"
  local canScan="$6"

  node -e "
    process.stdout.write(JSON.stringify({
      hasToken: $hasToken,
      tokenSource: $(node -e "process.stdout.write(JSON.stringify('$tokenSource'))"),
      org: $(node -e "process.stdout.write(JSON.stringify('$org'))"),
      tier: $(node -e "process.stdout.write(JSON.stringify('$tier'))"),
      canPersistScans: $canPersistScans,
      canScan: $canScan
    }) + '\n');
  "
}

# ---------- check ------------------------------------------------------------

do_check() {
  local socket_cmd
  socket_cmd="$(find_socket_cmd)"

  local hasToken=false
  local tokenSource="none"
  local org=""
  local tier="none"
  local canPersistScans=false
  local canScan=false

  # 1. Check SOCKET_CLI_API_TOKEN env var
  if [ -n "${SOCKET_CLI_API_TOKEN:-}" ]; then
    hasToken=true
    tokenSource="env"
  else
    # 2. Check socket config
    local configToken=""
    configToken="$($socket_cmd config get apiToken --no-banner --no-spinner 2>/dev/null || true)"
    # Strip whitespace
    configToken="$(echo "$configToken" | tr -d '[:space:]')"
    if [ -n "$configToken" ] && [ "$configToken" != "undefined" ] && [ "$configToken" != "null" ]; then
      hasToken=true
      tokenSource="config"
    fi
  fi

  # 3. Get org info if we have a token
  if [ "$hasToken" = true ]; then
    local orgJson=""
    orgJson="$($socket_cmd organization list --no-banner --no-spinner --json 2>/dev/null || true)"

    if [ -n "$orgJson" ]; then
      # Parse org info using node
      local orgInfo=""
      orgInfo="$(node -e "
        try {
          var data = JSON.parse(process.argv[1]);
          var orgs = Array.isArray(data) ? data : (data.organizations || data.results || []);
          if (orgs.length > 0) {
            var o = orgs[0];
            var name = o.slug || o.name || o.id || '';
            var plan = (o.plan || o.tier || '').toLowerCase();
            process.stdout.write(name + '|' + plan);
          }
        } catch(e) {}
      " "$orgJson" 2>/dev/null || true)"

      if [ -n "$orgInfo" ]; then
        org="${orgInfo%%|*}"
        local plan="${orgInfo##*|}"

        case "$plan" in
          *enterprise*) tier="enterprise"; canPersistScans=true; canScan=true ;;
          *team*|*pro*)  tier="paid"; canPersistScans=true; canScan=true ;;
          *free*)        tier="free"; canPersistScans=true; canScan=true ;;
          *)
            # If we got an org but can't determine plan, assume free
            if [ -n "$org" ]; then
              tier="free"
              canPersistScans=true
              canScan=true
            fi
            ;;
        esac
      fi
    fi

    # If we have a token but no org, it's likely the public demo token
    if [ -z "$org" ]; then
      tier="public"
      canPersistScans=false
      canScan=false
    fi
  fi

  emit_json "$hasToken" "$tokenSource" "$org" "$tier" "$canPersistScans" "$canScan"
}

# ---------- setup ------------------------------------------------------------

do_setup() {
  local socket_cmd
  socket_cmd="$(find_socket_cmd)"

  # Check if we already have a token
  local hasToken=false

  if [ -n "${SOCKET_CLI_API_TOKEN:-}" ]; then
    hasToken=true
  else
    local configToken=""
    configToken="$($socket_cmd config get apiToken --no-banner --no-spinner 2>/dev/null || true)"
    configToken="$(echo "$configToken" | tr -d '[:space:]')"
    if [ -n "$configToken" ] && [ "$configToken" != "undefined" ] && [ "$configToken" != "null" ]; then
      hasToken=true
    fi
  fi

  if [ "$hasToken" = true ]; then
    echo "Token already configured — skipping setup." >&2
    do_check
    return 0
  fi

  # No token found — set up public demo token
  echo "No Socket token found. Configuring public demo token..." >&2
  $socket_cmd config set apiToken "$PUBLIC_TOKEN" --no-banner --no-spinner 2>/dev/null
  $socket_cmd config set defaultOrg "$PUBLIC_ORG" --no-banner --no-spinner 2>/dev/null
  echo "Public demo token configured (org: $PUBLIC_ORG)." >&2
  echo "Note: The demo token enables CLI features like 'socket fix' and 'socket package score'" >&2
  echo "but NOT 'socket scan create' (requires a free account at https://socket.dev)." >&2

  # Output the new auth state
  do_check
}

# ---------- main -------------------------------------------------------------

case "${1:-}" in
  check) do_check ;;
  setup) do_setup ;;
  *)
    echo "Usage: socket-auth.sh {check|setup}" >&2
    exit 1
    ;;
esac
