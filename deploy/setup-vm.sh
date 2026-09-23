#!/usr/bin/env bash
#
# One-shot server setup for LGCY Core on a fresh Ubuntu VM (Oracle Cloud / GCP).
# Installs Node 24, installs dependencies, and registers a systemd service that
# keeps the bot online 24/7 (auto-start on boot + auto-restart on crash).
#
# Run from the project root on the server:
#   bash deploy/setup-vm.sh
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_USER="$(whoami)"
echo "==> App dir: $APP_DIR"
echo "==> Service user: $SERVICE_USER"

# 1. Node 24 (only if missing or older than 22) ----------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -v | sed 's/v//' | cut -d. -f1)"
  [ "$major" -ge 22 ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  echo "==> Installing Node 24..."
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "==> Node: $(node -v)"

# 2. Dependencies (includes tsx + the native @napi-rs/canvas prebuild) ------
cd "$APP_DIR"
echo "==> Installing npm dependencies..."
npm install --no-audit --no-fund

# 3. .env must exist before we start -----------------------------------------
mkdir -p "$APP_DIR/data"
if [ ! -f "$APP_DIR/.env" ]; then
  echo ""
  echo "!! No .env found. Create it first:"
  echo "     cp deploy/.env.example .env && nano .env   # paste your bot token"
  echo "   Then re-run: bash deploy/setup-vm.sh"
  exit 1
fi

# 4. systemd service ---------------------------------------------------------
echo "==> Installing systemd service..."
sudo tee /etc/systemd/system/lgcy-core.service >/dev/null <<UNIT
[Unit]
Description=LGCY Core Discord bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/env node node_modules/tsx/dist/cli.mjs src/index.ts
Restart=always
RestartSec=5
StandardOutput=append:$APP_DIR/data/bot.log
StandardError=append:$APP_DIR/data/bot.log

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable lgcy-core
sudo systemctl restart lgcy-core
sleep 4
echo ""
echo "==> Service status:"
sudo systemctl --no-pager --full status lgcy-core | head -n 12 || true
echo ""
echo "Done. Useful commands:"
echo "  sudo systemctl status lgcy-core     # is it running?"
echo "  tail -f $APP_DIR/data/bot.log       # live logs"
echo "  sudo systemctl restart lgcy-core    # restart after changes"
