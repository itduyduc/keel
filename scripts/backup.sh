#!/usr/bin/env bash
#
# Pulls a consistent snapshot of keel.db from the VM into BACKUP_DIR, newest 7 kept.
#
#   bash scripts/backup.sh
#
# sqlite3 .backup, never cp: the server may be mid-write, and a plain copy of a
# live SQLite file can be torn. Schedule it yourself (cron, launchd) if you want it regular.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"
DEST="${BACKUP_DIR:-$HOME/Backups/keel}"

stamp="$(date +%Y-%m-%d-%H%M)"
snap="/tmp/keel-$stamp.db"
"${G[@]}" ssh "$VM" --zone="$ZONE" --quiet --command "sudo sqlite3 /var/lib/keel/keel.db \".backup '$snap'\" && sudo chmod 644 '$snap'"
mkdir -p "$DEST"
"${G[@]}" scp --zone="$ZONE" --quiet "$VM:$snap" "$DEST/keel-$stamp.db"
"${G[@]}" ssh "$VM" --zone="$ZONE" --quiet --command "sudo rm -f '$snap'"
ls -1t "$DEST"/keel-*.db | tail -n +8 | while read -r old; do rm -f "$old"; done
echo "✅ $DEST/keel-$stamp.db ($(du -h "$DEST/keel-$stamp.db" | cut -f1))"
