#!/usr/bin/env bash
#
# One command from a commit to the VM serving it:
#
#   bash scripts/deploy.sh
#
# Builds the web UI, copies server/ + web/dist to /opt/plumb on the VM, restarts
# the service (migrations run at start; open windows reconnect on their own and
# offer "New version · Reload"), and reads /version from outside before saying done.
# The Mac app needs no rebuild for any of this: it loads the UI from the server.
set -euo pipefail
cd "$(dirname "$0")/.."

VM="duymydo"; ZONE="us-west1-b"; PROJ="duy-personal"
URL="https://plumb.itsduy.com"
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH
GCLOUD="$(command -v gcloud 2>/dev/null || true)"
[ -n "$GCLOUD" ] || { echo "❌ gcloud not found"; exit 1; }
G=("$GCLOUD" compute --project="$PROJ")

echo "→ tests…"
npm test --silent >/dev/null 2>&1 || { echo "❌ npm test failed — not deploying"; npm test; exit 1; }
echo "→ building the web UI…"
npm --prefix web run build --silent >/dev/null

# the stamp /version answers: commit, +dirty for uncommitted server or web edits, and the time
dirty=""; [ -z "$(git status --porcelain -- server web/src web/index.html)" ] || dirty="+dirty"
VERSION="$(git rev-parse --short HEAD)$dirty $(date -u +%Y-%m-%dT%H:%MZ)"
[ -z "$dirty" ] || echo "⚠️  uncommitted edits are going up as $VERSION"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
name="plumb-deploy-$(date +%s)"; stage="$tmp/$name"
mkdir -p "$stage/web"
cp -R server package.json "$stage/"
cp -R web/dist "$stage/web/dist"
printf '%s\n' "$VERSION" > "$stage/VERSION"

echo "→ $VERSION → $VM"
"${G[@]}" scp --recurse --zone="$ZONE" --quiet "$stage" "$VM:/tmp/"
"${G[@]}" ssh "$VM" --zone="$ZONE" --quiet --command "
  set -e
  src=/tmp/$name
  sudo rm -rf /opt/plumb.next && sudo cp -R \$src /opt/plumb.next
  sudo rm -rf /opt/plumb.prev && { [ -d /opt/plumb/server ] && sudo mv /opt/plumb /opt/plumb.prev || sudo rm -rf /opt/plumb; }
  sudo mv /opt/plumb.next /opt/plumb
  sudo chown -R root:root /opt/plumb
  sudo systemctl restart plumb; sleep 2
  if systemctl is-active --quiet plumb; then echo '   service active'
  else echo '❌ plumb is not active — the previous build is in /opt/plumb.prev'; sudo journalctl -u plumb -n 30 --no-pager; exit 1; fi
  rm -rf \$src
"

served="$(curl -s --max-time 15 "$URL/version" | python3 -c 'import sys,json; print(json.load(sys.stdin)["version"])' 2>/dev/null || true)"
if [ "$served" = "$VERSION" ]; then echo "✅ $URL serves $VERSION"
else echo "❌ $URL serves '${served:-nothing}', expected '$VERSION'"; exit 1; fi
