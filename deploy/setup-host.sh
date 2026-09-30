#!/usr/bin/env bash
# One-time set-up of the Hetzner box for iPlay Cornhole. Safe to run again (it only adds what is missing).
#
#   sudo ./setup-host.sh              nightly backup, Docker on boot
#   sudo ./setup-host.sh --firewall   also: firewall allows only SSH, 80 and 443 (ufw)
#   ./setup-host.sh --dry-run         show what it would do, change nothing
#
# It does NOT touch your web server or other games on the box.
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"

DRY=0
FIREWALL=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --firewall) FIREWALL=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

run() {
  if [ "$DRY" = 1 ]; then echo "  would run: $*"; else "$@"; fi
}
ok() { echo "  ok: $*"; }
todo() { echo "  YOU: $*"; }

echo "==> Checking the basics"
command -v docker >/dev/null || { echo "Docker is not installed. Install it first: https://docs.docker.com/engine/install/ubuntu/" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "The Docker Compose plugin is missing (apt install docker-compose-plugin)." >&2; exit 1; }
ok "docker and docker compose"
[ -f .env ] && ok ".env exists" || todo "cp .env.example .env and fill it in, then ./deploy.sh"

echo "==> Docker starts when the box boots"
if command -v systemctl >/dev/null && systemctl list-unit-files docker.service >/dev/null 2>&1; then
  if systemctl is-enabled docker >/dev/null 2>&1; then ok "already enabled"; else run systemctl enable docker; fi
else
  todo "make sure Docker starts on boot (no systemd found)"
fi

echo "==> Nightly backup at 03:17 (server time)"
LINE="17 3 * * * $HERE/backup.sh >> /var/log/cornhole-backup.log 2>&1 # iplay-cornhole-backup"
command -v crontab >/dev/null || { [ "$DRY" = 1 ] && crontab() { true; }; } || { echo "crontab is missing (apt install cron)." >&2; exit 1; }
CURRENT="$(crontab -l 2>/dev/null || true)"
if printf '%s\n' "$CURRENT" | grep -qF "# iplay-cornhole-backup"; then
  if printf '%s\n' "$CURRENT" | grep -qxF "$LINE"; then ok "already installed"
  else
    if [ "$DRY" = 1 ]; then echo "  would update the backup line to: $LINE"
    else { printf '%s\n' "$CURRENT" | grep -vF "# iplay-cornhole-backup"; echo "$LINE"; } | crontab -; ok "updated"; fi
  fi
else
  if [ "$DRY" = 1 ]; then echo "  would add: $LINE"
  else { [ -n "$CURRENT" ] && printf '%s\n' "$CURRENT"; echo "$LINE"; } | crontab -; ok "installed"; fi
fi

echo "==> Off-box copy of the backups"
if [ -f .env ] && grep -qE '^BACKUP_RSYNC_TARGET=.+' .env; then
  ok "BACKUP_RSYNC_TARGET is set"
  if [ ! -f "$HOME/.ssh/id_ed25519" ]; then
    run ssh-keygen -q -t ed25519 -N '' -f "$HOME/.ssh/id_ed25519"
  fi
  todo "add this key to your Storage Box once (Hetzner: install-ssh-key), then run ./backup.sh to test:"
  [ -f "$HOME/.ssh/id_ed25519.pub" ] && echo "       $(cat "$HOME/.ssh/id_ed25519.pub")"
else
  todo "set BACKUP_RSYNC_TARGET (and BACKUP_SSH_PORT=23 for a Hetzner Storage Box) in .env, then run this again"
fi

echo "==> Firewall"
if [ "$FIREWALL" = 1 ]; then
  command -v ufw >/dev/null || { echo "ufw is missing (apt install ufw)." >&2; exit 1; }
  # Keep the SSH port you are connected on, so you never lock yourself out.
  SSH_PORT="${SSH_CONNECTION:+$(echo "$SSH_CONNECTION" | awk '{print $4}')}"
  SSH_PORT="${SSH_PORT:-22}"
  run ufw allow "$SSH_PORT/tcp"
  run ufw allow 80/tcp
  run ufw allow 443/tcp
  run ufw --force enable
  ok "only $SSH_PORT (SSH), 80 and 443 are open. The game itself listens on 127.0.0.1 only."
  echo "     Note: Docker publishes ports around ufw. This setup only publishes 127.0.0.1:${APP_PORT:-3010} (and 80/443 for"
  echo "     the bundled Caddy if you use it), so nothing else is reachable. Hetzner's Cloud Firewall is a good second layer."
else
  todo "run again with --firewall to allow only SSH, 80 and 443 (or use Hetzner's Cloud Firewall)"
fi

echo "==> Still for you (once)"
todo "turn on Hetzner's own server backups in the Hetzner console"
todo "an uptime check on https://your-domain/ready (UptimeRobot is free), and ALERT_WEBHOOK_URL in .env for alerts"
todo "one test restore on a spare machine: ./restore.sh backups/<newest>.dump"
