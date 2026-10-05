# CLAUDE.md — contexto para sesiones de Claude Code

SAC Quest: gamificación web para eventos de IEEE Ecuador. Nació como el booth AR
"Foto con Watt" y evolucionó sin reescribirse. Qué hace, rutas, comandos y
estructura: **README.md**. Guías en `docs/`: servidor (`docker.md`), panel
(`organizadores.md`), participantes (`reglas.md`), ensayo (`ensayo.md`). Este
archivo solo guarda lo que no se deduce leyendo el código.

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
- Fotos **no públicas**: solo participantes del evento y organizadores.
- El usuario escribe en español y prefiere: revisar diseño antes de cambios grandes, no
  reescribir, explicaciones claras y cortas. Commits en `main` (historial en español); pide el
  commit y el push explícitamente. Valora automatizar: que algo sea trabajo extra para la IA no es
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
- Roles del panel: `admin` (todo) y `moderator` (moderar, participantes, ver, descargar).

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
- SQLite no deja borrar una columna con CHECK (p. ej. `difficulty`): si deja de usarse, se ignora.
- En el PC del usuario (Windows): hay Python 3.12 y Edge; no hay Docker, `flock` ni `pkill`. Las
  pantallas se pueden revisar con Edge headless por CDP (servidor con datos de `seed-demo`).
  Para editar archivos con muchos caracteres especiales, usar Edit/Write y no scripts con comillas.

## Convenciones
- Comentarios en español **sin tildes** en el código (como el código original); textos de la UI con
  tildes. Comentarios que explican el porqué, densidad moderada.
- CSS plano por feature (`quest.css`, `admin.css`, `WattBooth.css`), tema oscuro, `--accent` por evento.
- Gráficos del panel: seguir el skill `dataviz` (color de serie `#3987e5` validado en modo oscuro).
- Cambios de esquema: **agregar** una migración nueva en `MIGRATIONS` (`db.js`), nunca editar una publicada.

## Verificar cambios
    cd server && npm test             # 27 pruebas (API completa + config)
    npx oxlint && npm run build       # 0 errores esperados (hay warnings de estilo conocidos)
    cd server && npm run seed-demo && npm run loadtest -- --code <código>

## Estado (2026-10-05)
- En producción en la Pi. Implementado: API, app del participante, panel, cola offline, backups,
  loadtest, XP de Rama, valores de reto, encuestas, avisos, `git deploy`, CI.
- Probado por el usuario en iPhone y Android (funcionalidad). Sin probar: Quick Look dentro de un
  reto (cambio del 2026-10-05) y el conjunto con varias personas (ver `docs/ensayo.md`).
- **Pendiente**: ensayo con 10 personas; backup fuera de la microSD (el usuario lo pospuso);
  puntos otorgados por el staff para torneos (propuesto, sin respuesta). Descartado por el
  usuario: repartir la cola de moderación (cada moderador filtra por su reto).
