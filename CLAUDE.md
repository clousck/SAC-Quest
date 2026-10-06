# CLAUDE.md — contexto para sesiones de Claude Code

SAC Quest: gamificación web para eventos de IEEE Ecuador. Nació como el booth AR
"Foto con Watt" y evolucionó sin reescribirse. Qué hace, rutas, comandos y
estructura: **README.md**. Guías en `docs/`: servidor (`docker.md`), panel
(`organizadores.md`), participantes (`reglas.md`), ensayo (`ensayo.md`). Este
archivo solo guarda lo que no se deduce leyendo el código. `docs/reglas.pdf` es la versión para compartir de
`reglas.md`: al cambiar las reglas, regenerarlo con `node docs/reglas-pdf.mjs` (usa `npx marked` y Edge
sin ventana) y subir los dos.

## Usuario y contexto
- Eventos de IEEE Ecuador, multi-evento real (los eventos se crean en el panel). ~100 inscritos
  en 17 Ramas muy desiguales (de 29 a 1). Moderan el usuario y el **SAC team (~10 personas)**.
- **Un solo nombre: SAC Quest** (`sac-quest`, `sacquest`, `SAC_*`). No reintroducir nombres
  anteriores en código, docs ni identificadores.
- Servidor: **Raspberry Pi 5 (8 GB) con microSD de 64 GB**, sin SSD ni disco de backup todavía,
  detrás de **Cloudflare Tunnel**. Dominio: **sacquest.penginexr.com**, en un solo lugar:
  `server/.env` → `APP_DOMAIN` (QR y CORS salen de ahí). No hay API keys externas. En la Pi el
  repo está en `~/Git/sac-quest`. Ya está en producción ahí.
- Despliegue **solo con Docker**: `Dockerfile` (página + API en una imagen, datos en `/data`,
  usuario `node` uid 1000) y `docker-compose.yml` (proyecto `sac-quest`, volumen `sac-data`, `app` +
  `cloudflared` con token, perfil `tunnel`). Compose fija NODE_ENV/HOST/PORT/DATA_DIR/STATIC_DIR y
  pisa `server/.env`; el `.env` de la raíz solo lleva opciones de Docker (`SAC_*`, `COMPOSE_PROFILES`).
- Actualización con **`git deploy`** (alias local → `deploy/push.sh`): push + señal HTTP con token a
  `deploy/listener.py` (servicio `sac-quest-deploy`, Python de la Pi, escucha **solo en la IP de
  Tailscale**, puerto 8788) → `deploy/update.sh` (backup, `git merge --ff-only`, `compose up --build`,
  health). Estado en `.deploy/` (ignorado por git): `token`, `status`, `log`, `deployed`, `pause`.
  El usuario no quiso SSH ni sondeo periódico. Pausar en días de evento: `touch .deploy/pause`.
  `main` va directo a producción; GitHub Actions (`.github/workflows/pruebas.yml`) solo avisa.
- **`git deploy` en un equipo nuevo** (el usuario espera que Claude pueda desplegar): el equipo
  debe estar en el Tailscale del usuario (la Pi es `raspberrypi`, `100.106.155.106`). La
  configuración vive en el `.git/config` local y no viaja con el repo:
      git config sacquest.deployurl http://100.106.155.106:8788
      git config sacquest.deploytoken <token>
      git config alias.deploy '!sh deploy/push.sh'
  El token está en la Pi (`cat ~/Git/sac-quest/.deploy/token`; se entra con
  `ssh victorees@raspberrypi`) o en el archivo que el usuario se llevó del equipo anterior.
  **El repo es público: el token no se escribe en ningún archivo versionado.** Comprobar con
  `git deploy --signal-only` (no hace push). Si el token no está, pedírselo al usuario.
- Fotos **no públicas**: solo participantes del evento y organizadores.
- El usuario escribe en español y prefiere: revisar diseño antes de cambios grandes, no
  reescribir, explicaciones claras y cortas. Commits en `main` (historial en español). Si pide
  planear o una propuesta, no subir nada; si pide hacer algo directamente, subir y desplegar sin
  preguntar, salvo dudas o algo pendiente de su parte. Valora automatizar: que algo sea trabajo extra para la IA no es
  motivo para no hacerlo; que complique el uso en el evento, sí.

## Arquitectura (decisiones y por qué)
- Frontend React 19 + Vite 8 (raíz del repo) / API en `server/` (Node ≥22.13, Hono,
  **`node:sqlite`** para no compilar módulos nativos en la Pi) / fotos en disco vía
  `server/src/storage.js`.
- El frontend solo habla con el backend a través de `src/api/` (`/api` del mismo dominio;
  en desarrollo Vite hace proxy a `localhost:8787`). La API sirve también `dist/` (`STATIC_DIR`).
- **XP, niveles, logros y ranking se calculan** desde las submissions aprobadas (no hay contadores
  guardados) → aprobar/rechazar/borrar corrige todo solo. No hay tabla ParticipantBadge.
- **XP de Rama** (`teamRanking` en `rules.js`), en las mismas unidades que el XP personal:
  mejores (XP de los 5 mejores ponderado 100/60/40/25/15 %) + bono de participación (activos = ≥1
  reto aprobado con puntos; curva log, completo con 10) + retos de Rama (tabla `team_goals`: «N
  integrantes completan el reto X», N ≤ 5, sin XP personal). `settings.teamScore` guarda pesos
  relativos (150/75/75 = participación y retos valen cada uno hasta la mitad del máximo de los
  mejores, que es 2.4 × el XP de todos los retos publicados). Se decidió con simulaciones: la suma
  de XP hacía ganar siempre a la Rama más grande; los inscritos inactivos no deben sumar. Antes se
  mostraba normalizado a 300 y al usuario le pareció artificial. Con pocos retos todos se acercan
  al máximo. Las Ramas muy chicas se juntan a mano en el panel (máx. 5 por Rama unida).
- **Valor del reto** (`settings.pointTiers`, columna `challenges.tier`): los puntos salen del valor
  elegido; `tier` nulo = puntos a mano (retos viejos o «Sin XP»). Los puntos ya otorgados
  (`submissions.points_awarded`) **siguen al valor actual del reto** (`syncAwardedPoints`): en
  producción hubo personas con 100 y 25 XP por un reto de 20 tras editarlo. Una encuesta fallada
  sigue en 0. La «dificultad» se quitó (la columna queda sin uso).
- **Avisos** (`announcements`): viajan en la respuesta de `/challenges` (sondeo de 45 s) y el
  teléfono muestra cada uno una vez (`sacquest:avisos:<slug>`), como el aviso de «nuevo reto».
- Icono de pantalla de inicio: `manifest.webmanifest` con `display: browser` a propósito (en modo
  app, iOS usa otro almacenamiento y la persona perdería su sesión).
- Aprobación fija por tipo: QR y encuestas automático; PHOTO/AR siempre con moderador
  (`applyTypeRules`). El usuario descartó la aprobación automática de fotos.
- **Encuestas** = retos `TRIVIA` (`server/src/survey.js`), sin tablas nuevas: preguntas en
  `challenges.config.survey`, respuestas en `submissions.answer`. Un solo intento, se corrigen en el
  servidor (las correctas no viajan al teléfono hasta que la encuesta cierra), QR propio
  (`qrOnly`: sin su código no se responde) y pantalla propia `/e/:slug/s/:id` porque una encuesta
  secreta no está en la lista de retos. Sin el mínimo de aciertos queda aprobada con 0 puntos. Con
  respuestas ya no se pueden cambiar las preguntas. «Cerrar ahora» del panel = poner `availableUntil`
  (desactivar el reto lo esconde y ya no se ven las respuestas). El participante solo puede borrar
  envíos con foto: borrar una encuesta permitiría reintentarla.
- Fotos: el teléfono las reduce a 2048 px JPEG y quita el EXIF (`src/shared/imageResize.js`); la API
  entrega **URLs firmadas** (`media/...?exp&sig`, relativas a la base de la API), ventanas de 6 h
  para que el navegador las cachee. Por esa reducción, en un reto el booth no usa la foto del
  sensor (`composePhoto({ sensor: false })`); en el booth libre sí.
- Identidad sin cuentas: token por evento (localStorage `sacquest:v1:<slug>`) + **código de
  recuperación**. Entrar exige el **código del evento** (va en el QR como `?c=`).
- Subidas idempotentes por `clientId`; si no hay red quedan en IndexedDB (`uploadQueue.js`).
- "Reto secreto" es una **visibilidad**, no un tipo. Tipos implementados: PHOTO, AR, QR,
  TRIVIA (el esquema ya admite TEXT).
- Roles del panel: `admin` (todo) y `moderator` (moderar, participantes, ver, descargar). Un
  moderador **solo ve los eventos donde está asignado** (tabla `event_moderators`, se marca en
  Ajustes del evento). Se comprueba en un solo lugar: el middleware de sesión de `admin.js` saca el
  evento de la ruta (`requestEventId`); una ruta nueva del panel con id propio debe agregarse a
  `EVENT_TABLES` o quedaría abierta a cualquier moderador. Evento nuevo o duplicado = sin moderadores.
- **Botón central «Capturar»** de la barra (`/e/:slug/capturar`, `CaptureScreen.jsx`): escáner de QR
  dentro de la app + lista de retos de foto disponibles. `qrScan.js` usa `BarcodeDetector` si existe
  y, si no (iPhone), **jsQR** en un chunk aparte. Un QR leído solo navega a `/e/:slug/q/:código`
  (`QrClaim` hace el resto). Los QR impresos siguen sirviendo con la cámara del teléfono.
- El visor del escáner es `QrScanner.jsx`. `QrCodeField.jsx` = campo de código + botón QR a la
  derecha que abre el visor debajo; lo usan `EnterCode` (QR del evento), los retos QR y las
  encuestas «solo con QR». El usuario prefiere ese botón a un botón largo de «Escanear».
- Booth: la foto se toma al tocar el obturador, **sin cuenta regresiva** (la quitó el usuario). En
  AR (WebXR), tocar el piso para mover a Watt conserva el giro y el tamaño que le dio la persona;
  solo la primera colocación lo orienta hacia el teléfono.
- Panel → Participantes → «Código nuevo»: regenera el código de recuperación (el anterior deja de
  servir; la sesión abierta sigue).
- Iconos en `public/`: logo de IEEE (original: `public/ieee_icon.webp`, 512 px, transparente).
  `icon-192/512` y `favicon.png` transparentes; `icon-maskable-512` y `apple-touch-icon` con fondo
  blanco y margen (generados con System.Drawing desde PowerShell).
- Al moderar **no se cambian los puntos**: aprobar da siempre los del reto (el servidor ignora
  `points` en `/submissions/:id/review`). Lo pidió el usuario.
- `/` y las rutas desconocidas abren `EnterCode`; el booth sin evento quedó en `/watt`. `/entrar`
  ya no se usa ni se menciona (el usuario lo pidió): sigue abriendo lo mismo solo por ser una ruta
  desconocida.
- Ajustes → «XP por Rama» muestra el máximo de cada parte calculado en el navegador con los valores
  del formulario (misma cuenta que `teamRanking`): si cambia la fórmula, cambiar las dos.

## Trampas conocidas (no repetir)
- **Límites por IP altos** en join/recover/join-codes: todo el wifi del evento sale por una IP (NAT).
  Con 15/min se bloqueaba al 90 % en la prueba de carga.
- **iPhone + reto AR**: Quick Look abre fuera de la página y la foto no vuelve sola → en modo
  `challenge` la foto queda en la galería y se sube con un botón del booth (`WattBooth.jsx`).
- `node:sqlite` rechaza claves de más, booleanos y `undefined`: `db.js` normaliza los parámetros;
  usar siempre parámetros con nombre (`:nombre`).
- Hono: un patrón como `/:id{[0-9]+}.zip` no funciona (sufijo literal tras regex); parsear a mano.
- Estado que debe sobrevivir a `refresh()` (p. ej. el festejo tras enviar) va en el componente
  padre: al refrescar, el reto cambia de estado y el flujo hijo se desmonta.
- Los QR del panel usan `appUrl` (de `APP_DOMAIN`, vía `/api/admin/me`), no `window.location`.
- Reglas de desbloqueo: los ids de `unlock_rule.afterChallenges` no tienen clave foránea. Un
  requisito borrado o desactivado **no se exige** (`effectiveRule` en `rules.js`); en producción un
  reto borrado dejó a otro bloqueado para todos con «Completa otros retos» y el panel no lo mostraba.
- Datos de producción: `docker compose exec -T app npm run diagnose -- <slug> ["<alias>"]` (solo
  lee; retos y reglas, envíos, retos de Rama con el conteo por Rama y cómo ve los retos una persona).
  Los retos de Rama se calculan al vuelo: uno recién creado ya cuenta lo aprobado antes.
- SQLite no deja borrar una columna con CHECK (p. ej. `difficulty`): si deja de usarse, se ignora.
- En el PC del usuario (Windows): hay Python 3.12 y Edge; no hay Docker, `flock` ni `pkill`. Las
  pantallas se pueden revisar con Edge headless por CDP (servidor con datos de `seed-demo`; Node 24
  trae `WebSocket`, no hace falta puppeteer; la cámara se simula reemplazando `getUserMedia` por un
  `canvas.captureStream()`). El Control de aplicaciones de Windows bloquea el binario de `oxlint`
  en ese PC: el lint lo corre el CI.
  Para editar archivos con muchos caracteres especiales, usar Edit/Write y no scripts con comillas.

## Convenciones
- Comentarios en español **sin tildes** en el código (como el código original); textos de la UI con
  tildes. Comentarios que explican el porqué, densidad moderada.
- CSS plano por feature (`quest.css`, `admin.css`, `WattBooth.css`), tema oscuro, `--accent` por evento.
- Gráficos del panel: seguir el skill `dataviz` (color de serie `#3987e5` validado en modo oscuro).
- Cambios de esquema: **agregar** una migración nueva en `MIGRATIONS` (`db.js`), nunca editar una publicada.

## Verificar cambios
    cd server && npm test             # 29 pruebas
    cd server && npm run diagnose -- <slug>   # estado de un evento (retos, Ramas, ranking, envíos) (API completa + config)
    npx oxlint && npm run build       # 0 errores y 0 warnings esperados
    cd server && npm run seed-demo && npm run loadtest -- --code <código>

## Estado (2026-10-05)
- En producción en la Pi. Implementado: API, app del participante, panel, cola offline, backups,
  loadtest, XP de Rama, valores de reto, encuestas, avisos, `git deploy`, CI.
- Probado por el usuario en iPhone y Android (funcionalidad); él mismo dice que faltan más pruebas.
  Sin probar: Quick Look dentro de un reto (cambio del 2026-10-05), el conjunto con varias personas
  (ver `docs/ensayo.md`) y el **escáner de «Capturar» en teléfonos reales** (2026-10-05: solo
  verificado en Edge headless con un QR simulado, ruta jsQR).
- **Lo primero a confirmar con el usuario**: si ya hizo en la Pi el paso manual del cambio de
  nombre del proyecto de Docker (copiar el volumen viejo a `sac-quest_sac-data`; los comandos
  están en la conversación del 2026-10-05 y se resumen abajo). Hasta entonces producción sigue en
  una versión anterior y **`git deploy` fallaría** (el puerto 8787 lo ocupa el proyecto viejo):
      docker compose exec -T app npm run backup -- /backups && docker compose --profile tunnel down
      git pull && sed -i 's/^[A-Z]*_\(DATA_DIR\|BACKUP_DIR\|BIND\)=/SAC_\1=/' .env
      docker volume create sac-quest_sac-data
      docker run --rm -v <volumen-viejo>:/from -v sac-quest_sac-data:/to busybox cp -a /from/. /to/
      docker compose up -d --build
  (`docker volume ls` muestra el volumen viejo). Sin probar en Docker.
- Después de eso, en el panel: asignar un valor a cada reto existente (aparecen como «Actual ·
  N XP») y revisar el reto de Rama «Cinco con Watt» (pide 3 integrantes y el texto dice 5).
- **Pendiente**: ensayo con 10 personas; backup fuera de la microSD (el usuario lo pospuso).
- **Descartado por el usuario**: repartir la cola de moderación (cada moderador filtra por su
  reto) y puntos otorgados por el staff para torneos.
