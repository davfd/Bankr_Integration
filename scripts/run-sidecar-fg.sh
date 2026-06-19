#!/usr/bin/env bash
# Foreground workshop-sidecar launcher for systemd (Type=simple). Runs uvicorn in
# the Leonardo venv; the app imports leonardo.* and resolves data/ relative to
# ~/Leonardo (so cwd matters).
set -euo pipefail
LEONARDO_ROOT="${LEONARDO_ROOT:-/home/exor/Leonardo}"
SIDECAR_DIR="${SIDECAR_DIR:-/home/exor/leonardo-platform/services/workshop-sidecar}"
# Council memory recall needs the Council graph (:7688) creds + an OpenAI key for
# query embeddings — kept out of git in .env.sidecar.local.
ENV_FILE="$SIDECAR_DIR/.env.sidecar.local"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
cd "$LEONARDO_ROOT"
exec "$LEONARDO_ROOT/.venv/bin/python" -m uvicorn app:app \
  --app-dir "$SIDECAR_DIR" --host 127.0.0.1 --port 8799
