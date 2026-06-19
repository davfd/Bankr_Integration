#!/usr/bin/env bash
# Start (or restart) the Leonardo gateway reliably.
#
# Why this exists: the gateway's runtime env (LEONARDO_NEO4J_PASSWORD, SESSION_SECRET,
# GATEWAY_TOKEN, …) used to live only in an ad-hoc inline command. A restart that
# forgot one var would silently break a feature — e.g. a missing Neo4j password
# made `search_graph` 502 and Leonardo dead-end. This script sources one env file
# so that can't happen, and uses `setsid … & disown` because a plain `( … & )`
# gets SIGKILLed with the parent shell (the exit-144 gotcha).
#
# Setup once:  cp services/gateway/.env.gateway.example services/gateway/.env.gateway.local
#              # then fill GATEWAY_TOKEN + SESSION_SECRET to match the deployed web app
# Run:         ./scripts/start-gateway.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${GATEWAY_ENV_FILE:-$ROOT/services/gateway/.env.gateway.local}"
PORT="${PORT:-8787}"
LOG="${GATEWAY_LOG:-/tmp/leonardo-gateway.log}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found." >&2
  echo "  cp services/gateway/.env.gateway.example services/gateway/.env.gateway.local" >&2
  echo "  then fill GATEWAY_TOKEN and SESSION_SECRET." >&2
  exit 1
fi

# Required vars must be present AND non-empty, or refuse to start (fail loud, not silent).
set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a
missing=()
for v in GATEWAY_TOKEN SESSION_SECRET LEONARDO_NEO4J_PASSWORD CODEX_CLI_PATH WORKSHOP_SIDECAR_URL; do
  [[ -n "${!v:-}" ]] || missing+=("$v")
done
if (( ${#missing[@]} )); then
  echo "ERROR: missing/empty in $ENV_FILE: ${missing[*]}" >&2
  exit 1
fi

# Stop any gateway already on the port (clean restart).
if existing="$(lsof -ti tcp:"$PORT" 2>/dev/null)"; then
  [[ -n "$existing" ]] && { echo "stopping pid(s) on :$PORT → $existing"; kill $existing 2>/dev/null || true; sleep 1; }
fi

echo "starting gateway on :$PORT (log: $LOG)"
cd "$ROOT"
setsid env bun run services/gateway/src/serve.ts >"$LOG" 2>&1 < /dev/null &
disown || true

for _ in $(seq 1 30); do
  if curl -fsS -m 2 "http://localhost:$PORT/health" >/dev/null 2>&1; then
    echo "gateway healthy: $(curl -fsS -m 2 "http://localhost:$PORT/health")"
    exit 0
  fi
  sleep 1
done
echo "ERROR: gateway did not become healthy in 30s — see $LOG" >&2
tail -20 "$LOG" >&2 || true
exit 1
