#!/usr/bin/env python3
"""Recibe la señal de actualizar SAC Quest y lanza deploy/update.sh.

Escucha solo en la IP de Tailscale de la Pi (DEPLOY_HOST): no se llega desde
internet ni desde el tunel de Cloudflare. Ademas pide un token, para que
otro equipo de la red de Tailscale tampoco pueda dispararlo sin querer.

  POST /deploy   lanza la actualizacion (responde enseguida; sigue en segundo plano)
  GET  /status   estado + ultimas lineas del registro (texto plano)

No recibe parametros: lo unico que puede hacer es correr update.sh.
Lo instala deploy/install-autodeploy.sh como servicio (sac-quest-deploy).
"""
import hmac
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
STATE = REPO / ".deploy"
HOST = os.environ["DEPLOY_HOST"]
PORT = int(os.environ.get("DEPLOY_PORT", "8788"))
TOKEN = (STATE / "token").read_text().strip()


def read(name, default=""):
    try:
        return (STATE / name).read_text(errors="replace")
    except OSError:
        return default


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, text):
        body = (text.rstrip("\n") + "\n").encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def allowed(self):
        given = self.headers.get("Authorization", "")
        if hmac.compare_digest(given.encode(), ("Bearer " + TOKEN).encode()):
            return True
        self.reply(401, "token incorrecto")
        return False

    def do_POST(self):
        if self.path != "/deploy":
            return self.reply(404, "no existe")
        if not self.allowed():
            return
        try:
            # Se marca antes de lanzar: quien consulta no ve el resultado anterior.
            (STATE / "status").write_text("running Señal recibida…" + chr(10))
            # Sesion propia: la actualizacion sigue aunque este servicio se reinicie.
            subprocess.Popen(
                [str(REPO / "deploy" / "update.sh")],
                cwd=REPO,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except OSError as e:
            (STATE / "status").write_text(f"failed No se pudo lanzar update.sh: {e}" + chr(10))
            return self.reply(500, "no se pudo lanzar la actualizacion")
        self.reply(202, "actualizacion lanzada")

    def do_GET(self):
        if self.path != "/status":
            return self.reply(404, "no existe")
        if not self.allowed():
            return
        status = read("status", "idle sin actualizaciones todavia").strip()
        log = "\n".join(read("log").splitlines()[-40:])
        self.reply(200, status + "\n" + log)

    def log_message(self, *args):
        pass  # sin registro por peticion: el detalle esta en .deploy/log


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
