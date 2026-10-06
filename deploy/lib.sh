# Shared by deploy.sh, backup.sh and restore.sh: picks production or staging.
#
#   production (default)  settings in .env           project iplay-cornhole          port 3010  image tag latest
#   --staging             settings in .env.staging   project iplay-cornhole-staging  port 3011  image tag staging
#
# The two never share anything: separate database, separate data volume, separate port and image tag. Staging is
# where you try an update first; `./deploy.sh --promote` then puts exactly the tested version live.
# After sourcing: $ENVIRONMENT, $ENV_FILE, $PROJECT, ARGS (the arguments minus --staging), and dc (docker compose
# pointed at the right copy).

ENVIRONMENT=production
ENV_FILE=.env
PROJECT=iplay-cornhole
ARGS=()
for _a in "$@"; do
  if [ "$_a" = "--staging" ]; then ENVIRONMENT=staging; ENV_FILE=.env.staging; PROJECT=iplay-cornhole-staging
  else ARGS+=("$_a"); fi
done

if [ ! -f "$ENV_FILE" ]; then
  if [ "$ENVIRONMENT" = staging ]; then
    echo "No .env.staging here. Run: cp .env.staging.example .env.staging  and fill it in." >&2
  else
    echo "No .env here. Run: cp .env.example .env  and fill it in." >&2
  fi
  exit 1
fi
set -a; . "./$ENV_FILE"; set +a

if [ "$ENVIRONMENT" = staging ]; then
  # Never let staging overwrite the production image or use its port, backups or off-box copy.
  case "${TAG:-}" in ''|latest) TAG=staging ;; esac
  [ "${APP_PORT:-3010}" = 3010 ] && APP_PORT=3011
  BACKUP_DIR="${BACKUP_DIR:-./backups-staging}"
  BACKUP_RSYNC_TARGET=""
else
  TAG="${TAG:-latest}"
  APP_PORT="${APP_PORT:-3010}"
fi
export ENV_FILE TAG APP_PORT

dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" "$@"; }
