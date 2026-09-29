#!/usr/bin/env bash
# Dump the database to ./backups and keep the newest N files (default 14).
#
#   ./backup.sh            one backup now
#   crontab -e  ->  17 3 * * * /opt/iplay-cornhole/deploy/backup.sh >> /var/log/cornhole-backup.log 2>&1
#
# Copy the files off this box too (Hetzner Storage Box, rclone, rsync); a backup on the same disk
# does not survive losing the server.
set -euo pipefail
cd "$(dirname "$0")"

KEEP="${KEEP:-14}"
DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DIR/cornhole-$STAMP.dump"

# -Fc is a compressed format that pg_restore can load into an empty database
docker compose exec -T postgres pg_dump -U cornhole -d cornhole -Fc > "$OUT.partial"
[ -s "$OUT.partial" ] || { rm -f "$OUT.partial"; echo "Backup was empty, something is wrong." >&2; exit 1; }
mv "$OUT.partial" "$OUT"
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"

# keep the newest $KEEP
ls -1t "$DIR"/cornhole-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
