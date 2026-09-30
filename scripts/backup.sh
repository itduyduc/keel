#!/usr/bin/env bash
#
# Pulls a consistent snapshot of plumb.db from the VM into iCloud, newest 7 kept.
#
#   bash scripts/backup.sh
#
# sqlite3 .backup, never cp: the server may be mid-write, and a plain copy of a
# live SQLite file can be torn. Not scheduled — scheduling is a decision for Duy
# (and goes through the scheduled-task-rules skill when it happens).
set -euo pipefail

VM="duymydo"; ZONE="us-west1-b"; PROJ="duy-personal"
DEST="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Backups/Plumb"
# launchd hands scripts a bare PATH; gcloud lives in Homebrew
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH
GCLOUD="$(command -v gcloud 2>/dev/null || true)"
[ -n "$GCLOUD" ] || { echo "❌ gcloud not found"; exit 1; }
G=("$GCLOUD" compute --project="$PROJ")

stamp="$(date +%Y-%m-%d-%H%M)"
snap="/tmp/plumb-$stamp.db"
"${G[@]}" ssh "$VM" --zone="$ZONE" --quiet --command "sudo sqlite3 /var/lib/plumb/plumb.db \".backup '$snap'\" && sudo chmod 644 '$snap'"
mkdir -p "$DEST"
"${G[@]}" scp --zone="$ZONE" --quiet "$VM:$snap" "$DEST/plumb-$stamp.db"
"${G[@]}" ssh "$VM" --zone="$ZONE" --quiet --command "sudo rm -f '$snap'"
ls -1t "$DEST"/plumb-*.db | tail -n +8 | while read -r old; do rm -f "$old"; done
echo "✅ $DEST/plumb-$stamp.db ($(du -h "$DEST/plumb-$stamp.db" | cut -f1))"
