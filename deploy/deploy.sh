#!/usr/bin/env bash
# Build and start (or update) iPlay Cornhole on this box. Safe to run any time: live matches are
# saved when the old server stops and restored by the new one, so players just see "reconnecting".
#
#   ./deploy.sh                 build, restart, wait until it is ready
#   ./deploy.sh --maintenance   also stop new matches from starting while it restarts (needs ADMIN_TOKEN)
#   ./deploy.sh --no-build      restart with the image that is already built
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "No .env here. Run: cp .env.example .env  and fill it in." >&2; exit 1; }
set -a; . ./.env; set +a
PORT="${APP_PORT:-3010}"
BASE="http://127.0.0.1:${PORT}"

MAINT=0
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --maintenance) MAINT=1 ;;
    --no-build) BUILD=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

maintenance() {
  [ -n "${ADMIN_TOKEN:-}" ] || return 0
  curl -fsS -X POST -H "Authorization: Bearer ${ADMIN_TOKEN}" -H 'content-type: application/json' \
    -d "{\"enabled\":$1}" "${BASE}/admin/maintenance" >/dev/null 2>&1 || true
}

if [ "$BUILD" = 1 ]; then
  echo "==> Building"
  docker compose build app
fi

echo "==> Starting the database"
docker compose up -d postgres

if [ "$MAINT" = 1 ]; then echo "==> Maintenance on"; maintenance true; fi

echo "==> Restarting the game (saves live matches, restores them in the new one)"
# --force-recreate: restart even when the image did not change (for example with --no-build).
docker compose up -d --force-recreate --no-deps app

echo "==> Waiting for it to be ready"
for i in $(seq 1 90); do
  if curl -fsS "${BASE}/ready" >/dev/null 2>&1; then
    echo "Ready after ~${i}s: $(curl -fsS "${BASE}/ready")"
    if [ "$MAINT" = 1 ]; then echo "==> Maintenance off"; maintenance false; fi
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 1
done

echo "It did not become ready in 90 seconds. Recent logs:" >&2
docker compose logs --tail 60 app >&2
[ "$MAINT" = 1 ] && echo "Maintenance is still ON. Turn it off when fixed." >&2
exit 1
