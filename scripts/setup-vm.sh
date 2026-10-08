#!/usr/bin/env bash
#
# One-time setup on a Google Cloud VM that already has Node 22+ and Caddy
# (deploy/deploy.env says which). Safe to re-run: every step checks before it
# changes anything, and other sites in the same Caddyfile are left alone.
#
#   bash scripts/setup-vm.sh
#
# Everything but the public site works before DNS; the Caddy site is added on
# the first run after DOMAIN resolves to VM_IP. Google sign-in needs
# KEEL_GOOGLE_CLIENT_ID/SECRET in /etc/keel.env on the VM.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"

# Caddy asks Let's Encrypt for a certificate the moment the site exists, and failed
# validations are rate-limited, so the site is only added once the name resolves here.
dns_ok=0; dns_resolves && dns_ok=1
[ $dns_ok = 1 ] || echo "⏳ $DOMAIN does not resolve to $VM_IP yet — setting up everything but the Caddy site; re-run after the DNS record exists"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
name="keel-setup-$(date +%s)"; mkdir -p "$tmp/$name"
cp deploy/keel.service "$tmp/$name/"
sed "s|\${DOMAIN}|$DOMAIN|g" deploy/Caddyfile.template > "$tmp/$name/Caddyfile.keel"
"${G[@]}" scp --recurse --zone="$ZONE" --quiet "$tmp/$name" "$VM:/tmp/"

"${G[@]}" ssh "$VM" --zone="$ZONE" --quiet --command "
  set -e
  src=/tmp/$name
  id keel >/dev/null 2>&1 || sudo useradd --system --home /var/lib/keel --shell /usr/sbin/nologin keel
  sudo install -d -o keel -g keel -m 750 /var/lib/keel
  sudo install -d -m 755 /opt/keel
  if [ ! -f /etc/keel.env ]; then
    printf '%s\n' \
      'HOST=127.0.0.1' 'PORT=4747' 'KEEL_PUBLIC_URL=https://$DOMAIN' \
      'KEEL_ADMIN_EMAILS=${ADMIN_EMAIL:-}' \
      'KEEL_TEAM_NAME=Team' 'KEEL_TEAM_KEY=TM' 'KEEL_FIRST_ISSUE_NUMBER=1' 'KEEL_TIMEZONE=UTC' \
      'KEEL_OPERATOR_NAME=' 'KEEL_CONTACT_EMAIL=${ADMIN_EMAIL:-}' \
      'KEEL_GOOGLE_CLIENT_ID=' 'KEEL_GOOGLE_CLIENT_SECRET=' \
      'KEEL_GITHUB_ORG=' \"KEEL_GITHUB_WEBHOOK_SECRET=\$(openssl rand -hex 32)\" 'KEEL_GITHUB_TOKEN=' \
      | sudo tee /etc/keel.env >/dev/null
    sudo chown root:keel /etc/keel.env; sudo chmod 640 /etc/keel.env
    echo '   wrote /etc/keel.env — fill in the team, the Google client and GitHub before the first start'
  fi
  sudo install -m 644 \$src/keel.service /etc/systemd/system/keel.service
  sudo systemctl daemon-reload
  sudo systemctl enable keel >/dev/null 2>&1
  if [ $dns_ok = 1 ] && ! grep -q '$DOMAIN' /etc/caddy/Caddyfile; then
    # validate a copy first: a broken live Caddyfile would take every other site on the box down on the next restart
    sudo cp /etc/caddy/Caddyfile /tmp/Caddyfile.new
    printf '\n' | sudo tee -a /tmp/Caddyfile.new >/dev/null
    sudo tee -a /tmp/Caddyfile.new < \$src/Caddyfile.keel >/dev/null
    sudo caddy validate --config /tmp/Caddyfile.new --adapter caddyfile
    sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-keel
    sudo install -m 644 /tmp/Caddyfile.new /etc/caddy/Caddyfile && sudo rm -f /tmp/Caddyfile.new
    sudo systemctl reload caddy
    echo '   Caddy now serves $DOMAIN (backup: /etc/caddy/Caddyfile.before-keel)'
  fi
  command -v sqlite3 >/dev/null || echo '⚠️  sqlite3 is not installed; scripts/backup.sh needs it (sudo apt-get install -y sqlite3)'
  rm -rf \$src
"
if [ $dns_ok = 1 ]; then echo "✅ VM ready, Caddy serves $DOMAIN"; else echo "✅ VM ready except the Caddy site (waiting on DNS)"; fi
