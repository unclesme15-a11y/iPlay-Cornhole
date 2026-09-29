#!/usr/bin/env bash
# Put a backup back. THIS REPLACES THE WHOLE DATABASE, so it asks first.
#
#   ./restore.sh backups/cornhole-20260929T031700Z.dump
set -euo pipefail
cd "$(dirname "$0")"

FILE="${1:-}"
[ -f "$FILE" ] || { echo "Usage: ./restore.sh <backup file>" >&2; exit 2; }
echo "This will ERASE the current cornhole database and load: $FILE"
read -r -p "Type RESTORE to continue: " answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

docker compose stop app
docker compose up -d postgres
docker compose exec -T postgres dropdb -U cornhole --if-exists --force cornhole
docker compose exec -T postgres createdb -U cornhole cornhole
docker compose exec -T postgres pg_restore -U cornhole -d cornhole --no-owner < "$FILE"
docker compose up -d app
echo "Restored. Matches that were live when the backup was taken are not brought back; players start fresh matches."
