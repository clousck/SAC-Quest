#!/usr/bin/env bash
# Actualiza SAC Quest en el servidor: backup, git pull y docker compose up.
# Lo lanza deploy/listener.py al recibir la señal de `git deploy`; tambien se
# puede correr a mano:  ./deploy/update.sh
#
# Deja el resultado en .deploy/status (primera palabra: running | ok | failed |
# paused) y el detalle en .deploy/log.
#
# Pausa (para los dias de evento):  touch .deploy/pause   ·   quitarla: rm .deploy/pause
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$REPO/.deploy"
mkdir -p "$STATE"
cd "$REPO"

# Una sola actualizacion a la vez.
exec 9>"$STATE/lock"
if ! flock -n 9; then
  echo "Ya hay una actualización en curso."
  exit 0
fi

status() { printf '%s\n' "$*" > "$STATE/status"; }
exec > >(tee "$STATE/log") 2>&1
echo "== $(date '+%Y-%m-%d %H:%M:%S') =="

if [ -e "$STATE/pause" ]; then
  status "paused Actualizaciones en pausa (.deploy/pause). No se cambió nada."
  echo "En pausa: no se actualiza."
  exit 0
fi

fail() {
  status "failed $*"
  echo "ERROR: $*"
  exit 1
}

status "running Actualizando…"

git fetch --quiet origin main || fail "No se pudo consultar GitHub."
OLD="$(git rev-parse --short HEAD)"
NEW="$(git rev-parse --short origin/main)"
RUNNING="$(docker compose ps --status running --quiet app 2>/dev/null)"

# Lo que cuenta es lo ultimo desplegado con exito, no lo que hay en la
# carpeta: si docker fallo, el codigo ya avanzo pero la app sigue en la version vieja.
DEPLOYED="$(cat "$STATE/deployed" 2>/dev/null || true)"

if [ "$DEPLOYED" = "$NEW" ] && [ -n "$RUNNING" ]; then
  status "ok Ya estaba al día ($NEW)."
  echo "Sin cambios."
  exit 0
fi

# Backup antes de tocar nada: una migracion de la base no se deshace sola.
if [ -n "$RUNNING" ]; then
  echo "-- backup"
  docker compose exec -T app npm run --silent backup -- /backups || fail "Falló el backup: no se actualizó."
fi

echo "-- git: $OLD → $NEW"
git merge --ff-only origin/main || fail "git no pudo avanzar (¿cambios locales en la Pi?)."

echo "-- docker compose up"
docker compose up -d --build || fail "Falló docker compose ($OLD → $NEW)."

PORT=8787
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "$NEW" > "$STATE/deployed"
    status "ok Actualizado a $NEW: $(git log -1 --format=%s)"
    echo "Listo: $NEW"
    exit 0
  fi
  sleep 2
done
fail "La app no responde tras actualizar a $NEW. Revisa: docker compose logs app"
