#!/usr/bin/env bash
# Install the systemd --user services that keep the platform UP: workshop sidecar,
# API gateway, and the stable Cloudflare named tunnel. Same pattern as the Hermes
# bots (Restart=always, start on boot via lingering) — that's why they never die.
#
# Prereqs (one-time):
#   loginctl enable-linger "$USER"                 # run services at boot w/o login
#   services/gateway/.env.gateway.local            # gateway env (see .example)
#   cloudflared named tunnel 'leonardo-gw' + ~/.cloudflared/leonardo-gw.yml
#     cloudflared tunnel create leonardo-gw
#     cloudflared tunnel --config ~/.cloudflared/leonardo-gw.yml route dns \
#       --overwrite-dns <tunnel-uuid> leo-gw.castorai.ca
#
# Run: ./scripts/install-services.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"

cat > "$UNIT_DIR/leonardo-platform-sidecar.service" <<UNIT
[Unit]
Description=Leonardo Platform - Workshop Sidecar (graph reads, :8799)
After=network-online.target

[Service]
ExecStart=$ROOT/scripts/run-sidecar-fg.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT

cat > "$UNIT_DIR/leonardo-platform-gateway.service" <<UNIT
[Unit]
Description=Leonardo Platform - API Gateway (:8787)
After=network-online.target leonardo-platform-sidecar.service
Wants=leonardo-platform-sidecar.service

[Service]
ExecStart=$ROOT/scripts/run-gateway-fg.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT

cat > "$UNIT_DIR/cloudflared-leonardo.service" <<UNIT
[Unit]
Description=Cloudflare Tunnel for leo-gw.castorai.ca (Leonardo gateway)
After=network-online.target leonardo-platform-gateway.service
Wants=leonardo-platform-gateway.service

[Service]
ExecStart=$HOME/cloudflared tunnel --config $HOME/.cloudflared/leonardo-gw.yml run leonardo-gw
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now \
  leonardo-platform-sidecar.service \
  leonardo-platform-gateway.service \
  cloudflared-leonardo.service

echo "installed. status:"
systemctl --user --no-pager --no-legend list-units 'leonardo-platform-*' 'cloudflared-leonardo*'
