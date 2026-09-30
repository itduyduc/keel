#!/usr/bin/env bash
#
# One-time setup of Plumb on the free GCP VM that already runs Duy My Do
# (project duy-personal, VM duymydo, us-west1-b). Safe to re-run: every step
# checks before it changes anything, and nothing here touches Duy My Do.
#
#   bash scripts/setup-vm.sh
#
# Everything but the public site works before DNS; the Caddy site is added on
# the first run after plumb.itsduy.com resolves to the VM (A record at Hostinger,
# 8.235.111.45). Google sign-in needs PLUMB_GOOGLE_CLIENT_ID/SECRET in /etc/plumb.env.
set -euo pipefail
cd "$(dirname "$0")/.."

VM="duymydo"; ZONE="us-west1-b"; PROJ="duy-personal"
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH
GCLOUD="$(command -v gcloud 2>/dev/null || true)"
[ -n "$GCLOUD" ] || { echo "❌ gcloud not found"; exit 1; }
G=("$GCLOUD" compute --project="$PROJ")

# Caddy asks Let's Encrypt for a certificate the moment the site exists, and failed
# validations are rate-limited, so the site is only added once the name resolves here.
resolved="$(dig +short plumb.itsduy.com | tail -1)"
dns_ok=0; [ "$resolved" = "8.235.111.45" ] && dns_ok=1
[ $dns_ok = 1 ] || echo "⏳ plumb.itsduy.com resolves to '${resolved:-nothing}' — setting up everything but the Caddy site; re-run after the DNS record exists"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
name="plumb-setup-$(date +%s)"; mkdir -p "$tmp/$name"
cp deploy/plumb.service deploy/Caddyfile.plumb "$tmp/$name/"
"${G[@]}" scp --recurse --zone="$ZONE" --quiet "$tmp/$name" "$VM:/tmp/"

"${G[@]}" ssh "$VM" --zone="$ZONE" --quiet --command "
  set -e
  src=/tmp/$name
  id plumb >/dev/null 2>&1 || sudo useradd --system --home /var/lib/plumb --shell /usr/sbin/nologin plumb
  sudo install -d -o plumb -g plumb -m 750 /var/lib/plumb
  sudo install -d -m 755 /opt/plumb
  if [ ! -f /etc/plumb.env ]; then
    printf '%s\n' \
      'HOST=127.0.0.1' 'PORT=4747' 'PLUMB_PUBLIC_URL=https://plumb.itsduy.com' \
      'PLUMB_ADMIN_EMAILS=it.duy.duc@gmail.com' \
      'PLUMB_GOOGLE_CLIENT_ID=' 'PLUMB_GOOGLE_CLIENT_SECRET=' \
      'PLUMB_GITHUB_ORG=HeyAnurAI' \"PLUMB_GITHUB_WEBHOOK_SECRET=\$(openssl rand -hex 32)\" 'PLUMB_GITHUB_TOKEN=' \
      | sudo tee /etc/plumb.env >/dev/null
    sudo chown root:plumb /etc/plumb.env; sudo chmod 640 /etc/plumb.env
    echo '   wrote /etc/plumb.env (Google client still empty)'
  fi
  sudo install -m 644 \$src/plumb.service /etc/systemd/system/plumb.service
  sudo systemctl daemon-reload
  sudo systemctl enable plumb >/dev/null 2>&1
  if [ $dns_ok = 1 ] && ! grep -q 'plumb.itsduy.com' /etc/caddy/Caddyfile; then
    # validate a copy first: a broken live Caddyfile would take todo. and obsidian. down on the next restart
    sudo cp /etc/caddy/Caddyfile /tmp/Caddyfile.new
    printf '\n' | sudo tee -a /tmp/Caddyfile.new >/dev/null
    sudo tee -a /tmp/Caddyfile.new < \$src/Caddyfile.plumb >/dev/null
    sudo caddy validate --config /tmp/Caddyfile.new --adapter caddyfile
    sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-plumb
    sudo install -m 644 /tmp/Caddyfile.new /etc/caddy/Caddyfile && sudo rm -f /tmp/Caddyfile.new
    sudo systemctl reload caddy
    echo '   Caddy now serves plumb.itsduy.com (backup: /etc/caddy/Caddyfile.before-plumb)'
  fi
  command -v sqlite3 >/dev/null || echo '⚠️  sqlite3 is not installed; scripts/backup.sh needs it (sudo apt-get install -y sqlite3)'
  rm -rf \$src
"
if [ $dns_ok = 1 ]; then echo "✅ VM ready, Caddy serves plumb.itsduy.com"; else echo "✅ VM ready except the Caddy site (waiting on DNS)"; fi
