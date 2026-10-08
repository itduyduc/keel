#!/usr/bin/env bash
#
# One command from a commit to the VM serving it:
#
#   bash scripts/deploy.sh
#
# Builds the web UI, copies server/ + web/dist to /opt/keel on the VM, restarts
# the service (migrations run at start; open windows reconnect on their own and
# offer "New version · Reload"), and reads /version from outside before saying done.
# The Mac app needs no rebuild for any of this: it loads the UI from the server.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"
URL="https://$DOMAIN"

echo "→ tests…"
npm test --silent >/dev/null 2>&1 || { echo "❌ npm test failed — not deploying"; npm test; exit 1; }
echo "→ building the web UI…"
npm --prefix web run build --silent >/dev/null

# the stamp /version answers: commit, +dirty for uncommitted server or web edits, and the time
dirty=""; [ -z "$(git status --porcelain -- server web/src web/index.html)" ] || dirty="+dirty"
VERSION="$(git rev-parse --short HEAD)$dirty $(date -u +%Y-%m-%dT%H:%MZ)"
[ -z "$dirty" ] || echo "⚠️  uncommitted edits are going up as $VERSION"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
name="keel-deploy-$(date +%s)"; stage="$tmp/$name"
mkdir -p "$stage/web"
cp -R server package.json "$stage/"
cp -R web/dist "$stage/web/dist"
printf '%s\n' "$VERSION" > "$stage/VERSION"

echo "→ $VERSION → $VM"
"${G[@]}" scp --recurse --zone="$ZONE" --quiet "$stage" "$VM:/tmp/"
"${G[@]}" ssh "$VM" --zone="$ZONE" --quiet --command "
  set -e
  src=/tmp/$name
  sudo rm -rf /opt/keel.next && sudo cp -R \$src /opt/keel.next
  sudo rm -rf /opt/keel.prev && { [ -d /opt/keel/server ] && sudo mv /opt/keel /opt/keel.prev || sudo rm -rf /opt/keel; }
  sudo mv /opt/keel.next /opt/keel
  sudo chown -R root:root /opt/keel
  sudo systemctl restart keel; sleep 2
  if systemctl is-active --quiet keel; then echo '   service active'
  else echo '❌ keel is not active — the previous build is in /opt/keel.prev'; sudo journalctl -u keel -n 30 --no-pager; exit 1; fi
  # node takes a couple of seconds to listen; a bare curl under set -e ended the script silently (2026-09-30)
  onvm=''
  for i in 1 2 3 4 5 6 7 8 9 10; do
    onvm=\$(curl -s --max-time 2 http://127.0.0.1:4747/version || true)
    case \"\$onvm\" in *\"$VERSION\"*) break ;; esac
    sleep 1
  done
  case \"\$onvm\" in *\"$VERSION\"*) echo '   answers on the VM with this build' ;; *) echo \"❌ on the VM /version says: '\$onvm'\"; exit 1 ;; esac
  rm -rf \$src
"

# not public until the DNS record exists and setup-vm.sh has added the Caddy site
if ! dns_resolves; then
  echo "✅ deployed and running on the VM · ⏳ not public yet: $DOMAIN does not resolve to $VM_IP"; exit 0
fi

served="$(curl -s --max-time 15 --resolve "$DOMAIN:443:$VM_IP" "$URL/version" | python3 -c 'import sys,json; print(json.load(sys.stdin)["version"])' 2>/dev/null || true)"
if [ "$served" = "$VERSION" ]; then echo "✅ $URL serves $VERSION"
else echo "❌ $URL serves '${served:-nothing}', expected '$VERSION'"; exit 1; fi
