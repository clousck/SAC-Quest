# CLAUDE.md — contexto para sesiones de Claude Code

SAC Quest (antes RNR Quest): gamificación web para eventos de IEEE Ecuador. Nació como el booth AR
"Foto con Watt" y evolucionó sin reescribirse. Qué hace, rutas, comandos y
estructura: **README.md**. Despliegue: **docs/docker.md**. Este archivo solo
guarda lo que no se deduce leyendo el código.

## Usuario y contexto
- Se usará en **2027** en varios eventos de IEEE Ecuador (multi-evento real; los eventos se crean
  en el panel). El producto se llama **SAC Quest** desde 2026-10-02.
- Del nombre anterior quedan **a propósito** los identificadores internos: proyecto y volumen de
  Compose (`rnr-quest`, `rnr-data`: ahí están los datos de producción), variables `RNR_*`, claves
  de localStorage/IndexedDB (`rnrquest:*`: renombrarlas cierra sesiones), el túnel `rnr-quest` y la
  carpeta del repo. No renombrarlos sin migrar los datos.
- ~100–150 participantes. Moderan el usuario y el **SAC team (~10 personas)**.
- Servidor: **Raspberry Pi 5, 8 GB, 32 GB** (probablemente microSD → recomendar SSD), detrás de
  **Cloudflare Tunnel**. Dominio (por ahora): **sacquest.penginexr.com**. Va en un solo lugar,
  `server/.env` → `APP_DOMAIN` (QR y CORS salen de ahí). No hay API keys externas.
- Despliegue **solo con Docker** (desde 2026-10-01; se quitaron `deploy/` con systemd y Cloudflare
  Pages): `Dockerfile` (página + API en una imagen, datos en `/data`, usuario `node` uid 1000) y
  `docker-compose.yml` (`app` + `cloudflared` con token, perfil `tunnel`; perfil `quick` =
  trycloudflare para pruebas). Compose fija NODE_ENV/HOST/PORT/DATA_DIR/STATIC_DIR y pisa
  `server/.env`; el `.env` de la raíz solo lleva opciones de Docker (`RNR_*`, `COMPOSE_PROFILES`).
  Sin probar aún en la Pi: el PC del usuario no tiene Docker.
- Actualización con **`git deploy`** (alias local → `deploy/push.sh`): push + señal HTTP con token a
  `deploy/listener.py` (servicio `sac-quest-deploy`, Python de la Pi, escucha **solo en la IP de
  Tailscale**, puerto 8788) → `deploy/update.sh` (backup, `git merge --ff-only`, `compose up --build`,
  health). Estado en `.deploy/` (ignorado por git): `token`, `status`, `log`, `deployed`, `pause`.
  El usuario no quiso SSH ni sondeo periódico. Pausar en días de evento: `touch .deploy/pause`.
  En la Pi el repo está en `~/Git/sac-quest`.
- Pages se dejó porque solo servía la página: el login daba 405 (POST a un hosting estático).
  `VITE_API_URL` sigue en el código pero no se usa.
- Fotos **no públicas**: solo participantes del evento y organizadores.
- El usuario escribe en español y prefiere: revisar diseño antes de cambios grandes, no
  reescribir, explicaciones claras. Commits en `main` (historial en español).

## Arquitectura (decisiones y por qué)
- Frontend React 19 + Vite 8 (raíz del repo) / API en `server/` (Node ≥22.13, Hono,
  **`node:sqlite`** para no compilar módulos nativos en la Pi) / fotos en disco vía
  `server/src/storage.js` (interfaz cambiable a R2/S3).
- El frontend solo habla con el backend a través de `src/api/` (`/api` del mismo dominio;
  en desarrollo Vite hace proxy a `localhost:8787`). La API sirve también `dist/` (`STATIC_DIR`).
- **XP, niveles, logros y ranking se calculan** desde las submissions aprobadas (no hay contadores
  guardados) → aprobar/rechazar/borrar corrige todo solo. No hay tabla ParticipantBadge.
- **Score de Rama** (desde 2026-10-02, `teamRanking` en `rules.js`): máx. 300 = desempeño 150 (XP de los
  5 mejores ponderado 100/60/40/25/15 %, frente a todo el XP de los retos publicados, activos o no)
  + participación 75 (activos = ≥1 reto aprobado con puntos; curva log, tope 10) + colectivo 75
  (tabla `team_goals`: «N integrantes completan el reto X», N ≤ 5, sin XP). Valores por evento en
  `settings.teamScore`. Decidido con simulaciones (`server/scripts/simulate-team-ranking.js`): la suma
  de XP hacía ganar siempre a la Rama más grande; los inscritos inactivos no deben sumar. Las Ramas
  muy chicas se juntan a mano en el panel (máx. 5 personas por Rama unida).
- Aprobación fija por tipo: QR y encuestas automático; PHOTO/AR siempre con moderador (`applyTypeRules`).
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
  para que el navegador las cachee.
- Identidad sin cuentas: token por evento (localStorage `rnrquest:v1:<slug>`) + **código de
  recuperación**. Entrar exige el **código del evento** (va en el QR como `?c=`).
- Subidas idempotentes por `clientId`; si no hay red quedan en IndexedDB (`uploadQueue.js`).
- "Reto secreto" es una **visibilidad**, no un tipo. Tipos implementados: PHOTO, AR, QR,
  TRIVIA (el esquema ya admite TEXT).
- Roles del panel: `admin` (todo) y `moderator` (moderar, participantes, ver, descargar).

## Trampas conocidas (no repetir)
- **Límites por IP altos** en join/recover/join-codes: todo el wifi del evento sale por una IP (NAT).
  Con 15/min se bloqueaba al 90 % en la prueba de carga.
- **iPhone + reto AR**: Quick Look abre fuera de la página y la foto nunca vuelve → en modo
  `challenge` el booth usa el modo cámara (`WattBooth.jsx`).
- `node:sqlite` rechaza claves de más, booleanos y `undefined`: `db.js` normaliza los parámetros;
  usar siempre parámetros con nombre (`:nombre`).
- Hono: un patrón como `/:id{[0-9]+}.zip` no funciona (sufijo literal tras regex); parsear a mano.
- Estado que debe sobrevivir a `refresh()` (p. ej. el festejo tras enviar) va en el componente
  padre: al refrescar, el reto cambia de estado y el flujo hijo se desmonta.
- `/` sigue abriendo el booth porque hay QRs viejos que apuntan ahí.
- Windows del usuario: no hay `python` ni `pkill`; usar node o PowerShell. Desde 2026-10-01 el
  Control de aplicaciones de Windows bloquea el binario nativo de oxlint en ese PC (no es del código).
- Los QR del panel usan `appUrl` (de `APP_DOMAIN`, vía `/api/admin/me`), no `window.location`.

## Convenciones
- Comentarios en español **sin tildes** en el código (como el código original); textos de la UI con
  tildes. Comentarios que explican el porqué, densidad moderada.
- CSS plano por feature (`quest.css`, `admin.css`, `WattBooth.css`), tema oscuro, `--accent` por evento.
- Gráficos del panel: seguir el skill `dataviz` (color de serie `#3987e5` validado en modo oscuro).
- Cambios de esquema: **agregar** una migración nueva en `MIGRATIONS` (`db.js`), nunca editar una publicada.

## Verificar cambios
    cd server && npm test             # 25 pruebas (API completa + config)
    npx oxlint && npm run build       # 0 errores esperados (hay ~22 warnings de estilo conocidos)
    cd server && npm run seed-demo && npm run loadtest -- --code <código>

## Estado (2026-09-30)
- Fases 0–5 implementadas: API, app del participante, panel, cola offline, backups, loadtest.
- Probado: tests de API, recorrido E2E en navegador headless (Edge + puppeteer-core, cámara
  falsa), carga de 150 usuarios simultáneos en el PC (no en la Pi).
- **Pendiente**: probar en iPhone y Android reales (cámara, AR, subida); desplegar en la Pi con
  Docker (docs/docker.md); decidir si `/` pasa a ser `/entrar` con el dominio nuevo; probar
  encuestas y Score de Rama con gente real.
