#!/usr/bin/env bash
# Foreground gateway launcher for systemd (Type=simple). Sources the env file and
# exec's bun so systemd owns the process and can Restart=always it. Unlike
# start-gateway.sh (which setsid-detaches for manual use), this stays in the
# foreground.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${GATEWAY_ENV_FILE:-$ROOT/services/gateway/.env.gateway.local}"
[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE" >&2; exit 1; }
set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a
cd "$ROOT"
# systemd doesn't load the shell profile, so bun isn't on PATH — use it directly.
export PATH="/home/exor/.bun/bin:$PATH"
exec /home/exor/.bun/bin/bun run services/gateway/src/serve.ts
