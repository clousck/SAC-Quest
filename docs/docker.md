# Despliegue en la Raspberry Pi (Docker)

Guía paso a paso, desde una Pi recién instalada hasta SAC Quest funcionando en
**https://sacquest.penginexr.com**. Sirve igual en cualquier PC/servidor Linux de
64 bits. Pensada para una Raspberry Pi 5 (8 GB) y eventos de ~150 personas.

```
Teléfonos ──HTTPS──▶ Cloudflare ──túnel──▶ contenedor cloudflared
 sacquest.penginexr.com                      └─▶ contenedor app (app:8787)
                                                   ├─ página (dist/) y API (/api)
                                                   └─ /data → quest.db + files/
```

| Archivo | Qué hace |
|---|---|
| `Dockerfile` | Compila la página, instala la API y arma una imagen con Node 22 que corre como usuario `node` (uid 1000). |
| `docker-compose.yml` | Servicio `app` y el túnel `cloudflared` (perfil `tunnel`). `SAC_BIND` abre el puerto a la red local. |
| `server/.env` | Configuración del servidor: `APP_DOMAIN`, `APP_SECRET`, `TUNNEL_TOKEN`. |
| `.env` (raíz, opcional) | Opciones de Docker: `SAC_DATA_DIR`, `SAC_BACKUP_DIR`, `COMPOSE_PROFILES`, `SAC_BIND`. |

## 0. Qué se necesita

- Raspberry Pi 5 con **Raspberry Pi OS Lite 64 bits**. Con Raspberry Pi Imager,
  en *Editar ajustes*: nombre de host (p. ej. `sac-quest`), usuario y contraseña,
  wifi si no va por cable, y **activar SSH**.
- Mejor por **cable de red** que por wifi.
- El dominio `penginexr.com` en una cuenta de **Cloudflare** (plan gratuito).
- Recomendado: un **SSD o pendrive USB 3** para los datos. Una foto ocupa
  ~0,5 MB más una miniatura de ~30 KB: 150 personas × 15 fotos ≈ **1,2 GB por
  evento**. Las microSD se corrompen con cortes de luz y escrituras constantes.
- Otra computadora en la misma red para conectarse por SSH.

## 1. Conectarse a la Pi

Desde la computadora (PowerShell en Windows):

```bash
ssh <usuario>@sac-quest.local          # o ssh <usuario>@<ip-de-la-pi>
```

Si `sac-quest.local` no responde, busca la IP de la Pi en el router. Una vez
dentro, `hostname -I` muestra la IP (la primera, p. ej. `192.168.1.50`); anótala.

Todos los comandos que siguen se escriben **en la Pi** (en esa sesión SSH).

## 2. Preparar la Pi e instalar Docker

```bash
sudo apt-get update && sudo apt-get full-upgrade -y
sudo apt-get install -y git
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exit                                   # salir y volver a entrar por SSH
```

Al volver a entrar, comprobar:

```bash
docker run --rm hello-world            # debe decir "Hello from Docker!"
docker compose version
```

Docker queda como servicio: arranca solo al encender la Pi, y con él los
contenedores de SAC Quest.

## 3. (Recomendado) Preparar el SSD

Saltar este paso si los datos van en la microSD.

```bash
lsblk -f                               # el SSD aparece como sda (sda1 si tiene partición)
```

**Si el SSD es nuevo o se puede borrar** (esto lo formatea y **borra todo** lo
que tenga):

```bash
sudo mkfs.ext4 -L sac-ssd /dev/sda1    # revisar bien que sea el SSD
```

Montarlo siempre en `/mnt/ssd`:

```bash
sudo mkdir -p /mnt/ssd
echo 'LABEL=sac-ssd /mnt/ssd ext4 defaults,noatime,nofail 0 2' | sudo tee -a /etc/fstab
sudo systemctl daemon-reload && sudo mount -a
df -h /mnt/ssd                         # debe mostrar el tamaño del SSD
sudo mkdir -p /mnt/ssd/sac-quest /mnt/ssd/sac-backups
sudo chown 1000:1000 /mnt/ssd/sac-quest /mnt/ssd/sac-backups
```

El `chown 1000` es porque el contenedor corre como el usuario `node` (uid 1000),
no como root. (`nofail`: si el SSD no está conectado, la Pi arranca igual.)

## 4. Descargar y configurar SAC Quest

```bash
git clone https://github.com/clousck/SAC-Quest.git ~/Git/sac-quest
cd ~/Git/sac-quest
cp server/.env.example server/.env
openssl rand -base64 32                # copia el resultado: es el APP_SECRET
nano server/.env
```

En `nano`:

- `APP_SECRET=` → pegar el valor generado.
- `APP_DOMAIN=sacquest.penginexr.com` ya viene puesto.
- `TUNNEL_TOKEN=` → se completa en el paso 5.

Guardar con `Ctrl+O`, `Enter`, y salir con `Ctrl+X`.

Opciones de Docker en el `.env` de la raíz (hay una plantilla en `.env.example`).
Con el túnel siempre activo y, si hiciste el paso 3, los datos en el SSD:

```bash
cat > .env <<'EOF'
COMPOSE_PROFILES=tunnel
SAC_DATA_DIR=/mnt/ssd/sac-quest
SAC_BACKUP_DIR=/mnt/ssd/sac-backups
EOF
```

Sin SSD, solo `COMPOSE_PROFILES=tunnel`, y crear la carpeta de backups local
**antes** de arrancar (si no existe, Docker la crea como root y el backup no
puede escribir):

```bash
echo 'COMPOSE_PROFILES=tunnel' > .env
mkdir -p backups
```

## 5. Crear el túnel de Cloudflare

El túnel publica la Pi en `sacquest.penginexr.com` sin abrir puertos en el router ni
tener IP fija: la Pi se conecta hacia Cloudflare.

1. **Si `sacquest.penginexr.com` estaba en Cloudflare Pages**: Workers & Pages → el
   proyecto → *Custom domains* → quitar `sacquest.penginexr.com` (o borrar el
   proyecto). Luego, en *DNS* de `penginexr.com`, borrar el registro `sacquest` si
   quedó. Si no, el túnel no puede usar ese nombre (y Pages seguiría
   respondiendo `405` al iniciar sesión).
2. Cloudflare → *Zero Trust* → *Networks* → *Tunnels* → *Create a tunnel* →
   *Cloudflared*, nombre `sac-quest`.
3. Copiar el **token**: el texto largo después de `--token` en los comandos que
   muestra. No hace falta instalar nada de lo que sugiere esa página.
4. *Public Hostname* → *Add*: subdominio `sacquest`, dominio `penginexr.com`, tipo
   **HTTP**, URL **`app:8787`**. Cloudflare crea el registro DNS solo.
5. En la Pi: `nano server/.env` → `TUNNEL_TOKEN=<token>`.

## 6. Arrancar

```bash
docker compose up -d --build           # la primera vez tarda varios minutos
docker compose ps                      # app (healthy) y cloudflared en marcha
curl http://127.0.0.1:8787/api/health  # {"ok":true,...}
curl https://sacquest.penginexr.com/api/health
```

Crear el primer usuario del panel (pide la contraseña):

```bash
docker compose exec app npm run create-admin -- --username victor --name "Victor" --role admin
```

Abrir **https://sacquest.penginexr.com/admin**, crear el evento y los retos. Los
demás usuarios (SAC team) se crean desde el panel → **Usuarios**: *moderador*
(revisa fotos, gestiona participantes, descarga) o *admin* (además edita retos
y ajustes).

## 7. (Opcional) Abrir el panel por la IP local

Útil si el túnel no anda y hay que entrar al panel desde la red del lugar:

```bash
echo 'SAC_BIND=0.0.0.0' >> .env
docker compose up -d
```

Desde la misma red: `http://<ip-de-la-pi>:8787/admin`. Solo para el panel:
**la cámara no funciona** en los teléfonos sin HTTPS. Para cerrarlo, borrar la
línea `SAC_BIND` de `.env` y `docker compose up -d`.

## 8. Backups automáticos

```bash
crontab -e                             # elegir nano si pregunta
```

Agregar al final (cada 15 min: instantánea de la base + copia incremental de
las fotos; conserva las últimas 48):

```
*/15 * * * * cd ~/Git/sac-quest && docker compose exec -T app npm run backup -- /backups >> /tmp/sac-backup.log 2>&1
```

Probarlo a mano una vez: `docker compose exec app npm run backup -- /backups`.
Los backups quedan en `SAC_BACKUP_DIR` (o `~/Git/sac-quest/backups`). Lo ideal es
que estén en **otro disco** que los datos.

Restaurar: `docker compose stop app`, copiar una instantánea como `quest.db` y
la carpeta `files/` en la carpeta de datos (`SAC_DATA_DIR`), `docker compose
start app`. Con el volumen por defecto (sin SSD), se entra a los datos así:
`docker run --rm -it -v sac-quest_sac-data:/data -v "$PWD/backups:/backups" busybox sh`.

Después del evento, descarga además el ZIP de fotos (panel → Galería →
Descargar ZIP) y guárdalo aparte.

## 9. Comprobar que arranca sola

```bash
sudo reboot
# esperar 1-2 minutos, volver a entrar por SSH
cd ~/Git/sac-quest && docker compose ps    # todo "Up", app (healthy)
```

## 10. Antes del evento (checklist)

1. Prueba de carga desde **otra** red (mide la Pi y el túnel juntos), desde una
   computadora con el repo y Node, contra un evento de prueba
   (`docker compose exec app npm run seed-demo` crea uno e imprime el código):
   `cd server && npm run loadtest -- --url https://sacquest.penginexr.com/api --code <código>`
2. Crear el evento (o **duplicar** uno anterior), cargar Ramas y retos, revisar
   niveles, logros y retos de Rama. Guía del panel: [organizadores.md](organizadores.md).
3. Imprimir los QR (Ajustes → Imprimir QRs): el de entrada en carteles, cada
   checkpoint en su lugar. Bajo cada QR va el código en texto.
4. Hacer el **ensayo con 10 personas**: [ensayo.md](ensayo.md).
5. El día: **pausar las actualizaciones** (`touch .deploy/pause`, sección 11) y **Abrir evento**; moderadores con sesión iniciada (Moderar funciona
   bien desde el teléfono); ranking en la pantalla grande (Ranking → Pantalla grande).
6. Al terminar: **Cerrar evento** (congela el ranking; la galería sigue visible).

## 11. Actualizar con `git deploy` (por Tailscale)

Para no entrar a la Pi cada vez: un comando en tu computadora hace el push y le
avisa a la Pi que se actualice. La señal viaja solo por **Tailscale**; la Pi no
escucha nada nuevo desde internet.

```
git deploy  →  push a GitHub  →  señal a http://<ip-tailscale>:8788  →  la Pi: backup, git pull, docker compose up
```

**En la Pi, una sola vez** (requiere Tailscale conectado):

```bash
cd ~/Git/sac-quest
git pull
./deploy/install-autodeploy.sh
```

Instala el servicio `sac-quest-deploy`, que escucha solo en la IP de Tailscale
y exige un token, y al final imprime tres comandos `git config`.

**En tu computadora, una sola vez**: pega esos tres comandos dentro de la
carpeta del repo. El token queda en la configuración local de git; no se sube.

**Desde entonces**, en vez de `git push`:

```bash
git deploy
```

Muestra el resultado al terminar: `Actualizado a <commit>`, o el registro si algo
falló. Cada actualización hace antes un backup de la base. Un `git push` normal
sigue funcionando y no actualiza la Pi; `git deploy --signal-only` manda solo la
señal.

| Para | En la Pi |
|---|---|
| **Pausar** las actualizaciones (días de evento) | `touch ~/Git/sac-quest/.deploy/pause` |
| Reanudarlas | `rm ~/Git/sac-quest/.deploy/pause` |
| Ver la última actualización | `cat ~/Git/sac-quest/.deploy/status` · detalle: `cat ~/Git/sac-quest/.deploy/log` |
| Actualizar a mano | `./deploy/update.sh` |
| El servicio no responde | `systemctl status sac-quest-deploy` · `journalctl -u sac-quest-deploy -n 30` |
| Quitarlo | `sudo systemctl disable --now sac-quest-deploy` |

Con la pausa puesta, `git deploy` sube el código a GitHub pero la Pi no cambia
hasta que la quites y vuelvas a mandar la señal.

## 12. Comandos útiles

| Para | Comando (en `~/Git/sac-quest`) |
|---|---|
| Actualizar a la última versión | `git deploy` desde tu computadora (sección 11), o aquí: `git pull && docker compose up -d --build` (la base se migra sola) |
| Ver logs | `docker compose logs -f app` (o `cloudflared`) |
| Reiniciar | `docker compose restart app` |
| Aplicar cambios de `server/.env` | `docker compose up -d` (`restart` **no** relee el archivo) |
| Contraseña del panel | `docker compose exec app npm run create-admin -- --username victor` |
| Evento de prueba | `docker compose exec app npm run seed-demo` |
| Espacio en disco | `df -h` (y panel → Resumen: MB de fotos) |
| Parar todo | `docker compose down` (los datos quedan) |

`docker compose down -v` **borra el volumen con la base y las fotos**: no usarlo.

**Cambiar de dominio:** editar `APP_DOMAIN` en `server/.env`, cambiar el
*Public Hostname* del túnel en Cloudflare, `docker compose up -d` y **reimprimir
los QR**.

## 13. Problemas comunes

| Síntoma | Revisar |
|---|---|
| `permission denied ... docker.sock` | Falta cerrar sesión tras `usermod -aG docker` (paso 2). |
| `env file ... server/.env not found` | Falta `cp server/.env.example server/.env` (paso 4). |
| `app` se reinicia en bucle | `docker compose logs app`. Si dice "APP_SECRET debe tener al menos 32 caracteres", completarlo en `server/.env` y `docker compose up -d`. |
| `cloudflared` se reinicia en bucle | `docker compose logs cloudflared`: falta o está mal el `TUNNEL_TOKEN`. |
| Error 1033 / 502 en el dominio | El túnel no llega a la app: `docker compose ps`; en Cloudflare la URL del *Public Hostname* debe ser `app:8787`. |
| `405` al iniciar sesión | El dominio todavía apunta a Cloudflare Pages: paso 5.1. |
| `EACCES` en `/data` o `/backups` | La carpeta del host no es del uid 1000: `sudo chown -R 1000:1000 <carpeta>`. |
| La cámara no abre en el teléfono | Se está usando `http://` (IP local): usar `https://sacquest.penginexr.com`. |
| Un reto sale bloqueado sin motivo, o un reto de Rama no se marca | `docker compose exec -T app npm run diagnose -- <evento> "<nombre>"`: muestra las reglas de desbloqueo, los envíos y el conteo de cada Rama (solo lee). |
| Los QR muestran `localhost` o la IP | Falta `APP_DOMAIN` en `server/.env` (el panel lo avisa en Ajustes). |
