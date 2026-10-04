#!/bin/sh
# `git deploy`: hace push y le avisa al servidor (por Tailscale) que se
# actualice. Despues sigue el avance hasta que termina.
#
# Configuracion, una sola vez (la imprime deploy/install-autodeploy.sh):
#   git config sacquest.deployurl http://<ip-tailscale-del-servidor>:8788
#   git config sacquest.deploytoken <token>
#   git config alias.deploy '!sh deploy/push.sh'
# El token queda en la config local de git: no se sube al repo.
set -eu

url="$(git config --get sacquest.deployurl || true)"
token="$(git config --get sacquest.deploytoken || true)"
if [ -z "$url" ] || [ -z "$token" ]; then
  echo "Falta configurar sacquest.deployurl y sacquest.deploytoken (ver deploy/push.sh)." >&2
  exit 1
fi

# --signal-only: solo avisar al servidor (el push ya se hizo).
if [ "${1:-}" = "--signal-only" ]; then shift; else git push "$@"; fi

ask() { curl -fsS -m 10 -H "Authorization: Bearer $token" "$@"; }

if ! ask -X POST "$url/deploy" >/dev/null; then
  echo "El push se hizo, pero no se pudo avisar al servidor ($url)." >&2
  echo "¿Está Tailscale conectado en este equipo? Reintentar sin push: git deploy --signal-only" >&2
  exit 1
fi
echo "Señal enviada. Actualizando el servidor…"

# Hasta 15 minutos: la primera compilacion en la Pi es lenta.
i=0
while [ "$i" -lt 180 ]; do
  sleep 5
  i=$((i + 1))
  out="$(ask "$url/status" 2>/dev/null)" || continue
  state="$(printf '%s\n' "$out" | head -1 | cut -d' ' -f1)"
  case "$state" in
    running | idle) ;;
    ok | paused)
      printf '%s\n' "$out" | head -1 | cut -d' ' -f2-
      exit 0
      ;;
    *)
      printf '%s\n' "$out"
      exit 1
      ;;
  esac
done
echo "Sigue actualizando después de 15 minutos. Revisa en el servidor: cat .deploy/log" >&2
exit 1
