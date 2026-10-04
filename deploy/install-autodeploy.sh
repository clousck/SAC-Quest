#!/usr/bin/env bash
# Instala en el servidor el servicio que recibe la señal de `git deploy`
# (deploy/listener.py). Escucha solo en la IP de Tailscale.
#
#   ./deploy/install-autodeploy.sh
#
# Se puede volver a correr: conserva el token. Para quitarlo:
#   sudo systemctl disable --now sac-quest-deploy
#   sudo rm /etc/systemd/system/sac-quest-deploy.service && sudo systemctl daemon-reload
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$REPO/.deploy"
SERVICE=sac-quest-deploy
PORT=8788
RUN_USER="$(id -un)"

for cmd in python3 tailscale flock git docker curl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Falta «$cmd» en este equipo." >&2; exit 1; }
done
IP="$(tailscale ip -4 | head -1)"
[ -n "$IP" ] || { echo "Tailscale no está conectado (tailscale up)." >&2; exit 1; }

mkdir -p "$STATE"
if [ ! -s "$STATE/token" ]; then
  (umask 077; openssl rand -hex 24 > "$STATE/token")
fi
chmod 600 "$STATE/token"
chmod +x "$REPO/deploy/update.sh" "$REPO/deploy/listener.py"

# La IP se consulta al arrancar: si Tailscale aun no esta listo, systemd reintenta.
sudo tee /etc/systemd/system/$SERVICE.service > /dev/null <<EOF
[Unit]
Description=SAC Quest: recibe la señal de actualizar (solo Tailscale)
After=network-online.target tailscaled.service docker.service
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$REPO
Environment=DEPLOY_PORT=$PORT
ExecStart=/bin/sh -c 'DEPLOY_HOST="\$(tailscale ip -4 | head -1)" exec python3 $REPO/deploy/listener.py'
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE >/dev/null
sudo systemctl restart $SERVICE

sleep 2
if curl -fsS -m 5 -H "Authorization: Bearer $(cat "$STATE/token")" "http://$IP:$PORT/status" >/dev/null; then
  echo "✓ Servicio en marcha en http://$IP:$PORT (solo Tailscale)."
else
  echo "✗ El servicio no responde. Revisa: journalctl -u $SERVICE -n 30" >&2
  exit 1
fi

cat <<EOF

En tu computadora, dentro de la carpeta del repo (una sola vez):

  git config sacquest.deployurl http://$IP:$PORT
  git config sacquest.deploytoken $(cat "$STATE/token")
  git config alias.deploy '!sh deploy/push.sh'

Desde entonces:  git deploy   (hace push y actualiza este servidor)

Pausar las actualizaciones (días de evento):  touch $STATE/pause
Reanudarlas:                                  rm $STATE/pause
EOF
