#!/usr/bin/env bash
# Build and start (or update) iPlay Cornhole on this box. Safe to run any time: live matches are
# saved when the old server stops and restored by the new one, so players just see "reconnecting".
#
#   ./deploy.sh                 build, restart, wait until it is ready
#   ./deploy.sh --maintenance   also stop new matches from starting while it restarts (needs ADMIN_TOKEN)
#   ./deploy.sh --no-build      restart with the image that is already built
#
# Staging (a separate test copy, see docs/hetzner-deploy.md):
#   ./deploy.sh --staging       build and start the staging copy (port 3011, its own database)
#   ./deploy.sh --promote       put the exact version running on staging live in production (no rebuild)
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
BASE="http://127.0.0.1:${APP_PORT}"

MAINT=0
BUILD=1
PROMOTE=0
for arg in ${ARGS[@]+"${ARGS[@]}"}; do
  case "$arg" in
    --maintenance) MAINT=1 ;;
    --no-build) BUILD=0 ;;
    --promote) PROMOTE=1; BUILD=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$PROMOTE" = 1 ]; then
  [ "$ENVIRONMENT" = production ] || { echo "--promote moves staging into production; run it without --staging." >&2; exit 2; }
  docker image inspect iplay-cornhole-server:staging >/dev/null 2>&1 || { echo "No staging build yet. Run ./deploy.sh --staging first." >&2; exit 1; }
  # Keep the version that is live now, so a rollback is one command: docker tag iplay-cornhole-server:previous iplay-cornhole-server:latest && ./deploy.sh --no-build
  docker image inspect "iplay-cornhole-server:${TAG}" >/dev/null 2>&1 && docker tag "iplay-cornhole-server:${TAG}" iplay-cornhole-server:previous
  echo "==> Promoting the staging build to production (tag ${TAG})"
  docker tag iplay-cornhole-server:staging "iplay-cornhole-server:${TAG}"
fi
echo "==> ${ENVIRONMENT}: project ${PROJECT}, port ${APP_PORT}, image tag ${TAG}"

maintenance() {
  [ -n "${ADMIN_TOKEN:-}" ] || return 0
  curl -fsS -X POST -H "Authorization: Bearer ${ADMIN_TOKEN}" -H 'content-type: application/json' \
    -d "{\"enabled\":$1}" "${BASE}/admin/maintenance" >/dev/null 2>&1 || true
}

if [ "$BUILD" = 1 ]; then
  echo "==> Building"
  dc build app
fi

echo "==> Starting the database"
dc up -d postgres

if [ "$MAINT" = 1 ]; then echo "==> Maintenance on"; maintenance true; fi

echo "==> Restarting the game (saves live matches, restores them in the new one)"
# --force-recreate: restart even when the image did not change (for example with --no-build).
dc up -d --force-recreate --no-deps app

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
dc logs --tail 60 app >&2
[ "$MAINT" = 1 ] && echo "Maintenance is still ON. Turn it off when fixed." >&2
exit 1
