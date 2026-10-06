#!/usr/bin/env bash
# Put a backup back. THIS REPLACES THE WHOLE DATABASE, so it asks first.
#
#   ./restore.sh backups/cornhole-20260929T031700Z.dump             into production
#   ./restore.sh --staging backups/cornhole-20260929T031700Z.dump   into staging (for example, a copy of last
#                                                                   night's production data to test an update on)
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

FILE="${ARGS[0]:-}"
[ -f "$FILE" ] || { echo "Usage: ./restore.sh [--staging] <backup file>" >&2; exit 2; }
echo "This will ERASE the ${ENVIRONMENT} cornhole database (project ${PROJECT}) and load: $FILE"
read -r -p "Type RESTORE to continue: " answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

dc stop app
dc up -d postgres
for i in $(seq 1 30); do dc exec -T postgres pg_isready -U cornhole -d cornhole >/dev/null 2>&1 && break; sleep 1; done
dc exec -T postgres dropdb -U cornhole --if-exists --force cornhole
dc exec -T postgres createdb -U cornhole cornhole
dc exec -T postgres pg_restore -U cornhole -d cornhole --no-owner < "$FILE"
dc up -d app
echo "Restored into ${ENVIRONMENT}. Matches that were live when the backup was taken come back as they were at that moment; anything played after it is gone."
