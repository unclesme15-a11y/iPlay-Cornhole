#!/usr/bin/env bash
# Dump the database to ./backups, check the file can be read back, keep the newest N files (default 14),
# and copy them off this box if BACKUP_RSYNC_TARGET is set in .env.
#
#   ./backup.sh            one backup now
#   ./backup.sh --staging  a backup of the staging copy (into ./backups-staging, never copied off the box)
#   ./setup-host.sh        installs the nightly run (03:17) for you
#
# Off-box copy (a backup on the same disk does not survive losing the server). With a Hetzner Storage Box:
#   BACKUP_RSYNC_TARGET=u123456@u123456.your-storagebox.de:cornhole/
#   BACKUP_SSH_PORT=23
# and an SSH key for root that the Storage Box accepts (setup-host.sh prints how).
# If anything fails and ALERT_WEBHOOK_URL is set, a message goes there too.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

KEEP="${KEEP:-14}"
DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DIR/cornhole-$STAMP.dump"

alert() {
  echo "$1" >&2
  [ -n "${ALERT_WEBHOOK_URL:-}" ] || return 0
  local key=text
  case "$ALERT_WEBHOOK_URL" in *discord.com/api/webhooks/*|*discordapp.com/api/webhooks/*) key=content ;; esac
  local msg="[iPlay Cornhole ${ENVIRONMENT} backup] $1"
  msg="${msg//\\/\\\\}"; msg="${msg//\"/\\\"}"
  curl -fsS -m 10 -H 'content-type: application/json' -d "{\"$key\":\"$msg\"}" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
}
trap 'rm -f "$OUT.partial"; alert "Backup FAILED on $(hostname) at line $LINENO. Run deploy/backup.sh by hand to see why."' ERR

# -Fc is a compressed format that pg_restore can load into an empty database
dc exec -T postgres pg_dump -U cornhole -d cornhole -Fc > "$OUT.partial"
[ -s "$OUT.partial" ] || { rm -f "$OUT.partial"; alert "Backup was empty on $(hostname); something is wrong."; exit 1; }
# Prove the file is a complete, readable backup (pg_restore reads its table of contents).
dc exec -T postgres pg_restore --list < "$OUT.partial" > /dev/null
mv "$OUT.partial" "$OUT"
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"

# keep the newest $KEEP
ls -1t "$DIR"/cornhole-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

if [ -n "${BACKUP_RSYNC_TARGET:-}" ]; then
  # Mirror the folder: the off-box copy keeps the same newest $KEEP files.
  rsync -a --delete -e "ssh -p ${BACKUP_SSH_PORT:-22} -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
    "$DIR"/ "$BACKUP_RSYNC_TARGET"
  echo "Copied to $BACKUP_RSYNC_TARGET"
fi
