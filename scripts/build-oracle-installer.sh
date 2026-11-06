#!/usr/bin/env bash
# Builds a single self-contained installer for the VRF oracle:
#   scripts/build-oracle-installer.sh [out-file]
# The output embeds the oracle sources (no git access needed on the server)
# and, when run with sudo on Ubuntu, installs Node 22, the oracle, and a
# systemd service that restarts on crash/reboot. It contains NO secrets —
# it prompts for the keys on the server.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-dist/install-doge-oracle.sh}"
mkdir -p "$(dirname "$OUT")"
BUNDLE=$(tar -czf - -C bot package.json package-lock.json ecvrf.mjs vrf-oracle.mjs | base64 -w0)
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
cat > "$OUT" <<EOF
#!/usr/bin/env bash
# DogeOS VRF oracle installer (built from doge-raffle @ $COMMIT)
# Usage on a fresh Ubuntu 22.04/24.04 server:   sudo bash install-doge-oracle.sh
set -euo pipefail
[ "\$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

APP=/opt/doge-oracle
ENVF=/etc/doge-oracle.env

echo "==> Installing Node.js 22"
if ! command -v node >/dev/null || [ "\$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node --version

echo "==> Installing oracle to \$APP"
id doge-oracle >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin doge-oracle
mkdir -p "\$APP"
echo "$BUNDLE" | base64 -d | tar -xzf - -C "\$APP"
(cd "\$APP" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
chown -R root:root "\$APP"

if [ ! -f "\$ENVF" ]; then
  echo "==> Configuration (input is hidden for keys)"
  read -rp  "Coordinator address [0x4463AF4EAccFFB4AC14e87e9dac09B59e9E3614c]: " COORD
  COORD=\${COORD:-0x4463AF4EAccFFB4AC14e87e9dac09B59e9E3614c}
  read -rsp "VRF_SECRET_KEY (0x...): " VRFK; echo
  read -rsp "ORACLE_PRIVATE_KEY - gas wallet (0x...): " ORK; echo
  umask 077
  cat > "\$ENVF" <<ENV
COORDINATOR_ADDRESS=\$COORD
VRF_SECRET_KEY=\$VRFK
ORACLE_PRIVATE_KEY=\$ORK
POLL_MS=3000
ENV
  chown root:doge-oracle "\$ENVF"; chmod 640 "\$ENVF"
else
  echo "==> Keeping existing \$ENVF"
fi

echo "==> Installing systemd service"
cat > /etc/systemd/system/doge-oracle.service <<UNIT
[Unit]
Description=DogeOS VRF oracle
After=network-online.target
Wants=network-online.target

[Service]
User=doge-oracle
Group=doge-oracle
WorkingDirectory=\$APP
EnvironmentFile=\$ENVF
ExecStart=/usr/bin/node vrf-oracle.mjs --watch
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now doge-oracle
sleep 5
systemctl --no-pager --lines=5 status doge-oracle || true
echo
echo "Done. Follow logs with:  sudo journalctl -u doge-oracle -f"
echo "Update later: upload a newer installer and run it again (keys are kept)."
EOF
chmod +x "$OUT"
echo "built $OUT ($(wc -c < "$OUT") bytes, commit $COMMIT)"
