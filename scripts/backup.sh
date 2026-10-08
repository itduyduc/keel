#!/usr/bin/env bash
#
# Pulls a consistent snapshot of plumb.db from the VM into BACKUP_DIR, newest 7 kept.
#
#   bash scripts/backup.sh
#
# sqlite3 .backup, never cp: the server may be mid-write, and a plain copy of a
# live SQLite file can be torn. Schedule it yourself (cron, launchd) if you want it regular.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/_env.sh"
DEST="${BACKUP_DIR:-$HOME/Backups/duy-my-linear}"

stamp="$(date +%Y-%m-%d-%H%M)"
snap="/tmp/plumb-$stamp.db"
"${G[@]}" ssh "$VM" --zone="$ZONE" --quiet --command "sudo sqlite3 /var/lib/plumb/plumb.db \".backup '$snap'\" && sudo chmod 644 '$snap'"
mkdir -p "$DEST"
"${G[@]}" scp --zone="$ZONE" --quiet "$VM:$snap" "$DEST/plumb-$stamp.db"
"${G[@]}" ssh "$VM" --zone="$ZONE" --quiet --command "sudo rm -f '$snap'"
ls -1t "$DEST"/plumb-*.db | tail -n +8 | while read -r old; do rm -f "$old"; done
echo "✅ $DEST/plumb-$stamp.db ($(du -h "$DEST/plumb-$stamp.db" | cut -f1))"
