# SAC Quest

Gamificación para eventos de IEEE Ecuador. Desde el
teléfono, sin instalar nada:

    QR del evento → nombre y Rama → retos → cámara → subir → puntos

- **Retos**: 📷 foto, 🐱 AR con Watt (el booth de abajo), 📍 checkpoints QR y
  📝 encuestas sobre las charlas (se abren con su propio QR, un solo intento).
  Cada reto tiene un valor (que define sus puntos), categoría, horario, cupo,
  desbloqueo por otros retos o XP y modo secreto. Las fotos las aprueba un moderador; los QR y las
  encuestas se aprueban solos.
- **Gamificación liviana**: XP, niveles, logros y ranking individual. El XP de
  una Rama suma el de sus 5 mejores (ponderado), un bono por participación y los
  retos de Rama; los inscritos que no juegan no suman.
- **Capturar**: el botón central de la app abre la cámara para escanear
  cualquier QR del evento sin salir de la página; la pantalla de entrada y los
  retos con código tienen el mismo escáner junto al campo.
- **Avisos** de los organizadores a todos los participantes, e icono para la
  pantalla de inicio del teléfono.
- **Galería privada** del evento (solo fotos aprobadas, solo participantes),
  con filtros por reto y Rama y likes.
- **Panel** (`/admin`): crear y editar retos sin tocar código, moderar fotos
  (también desde el teléfono), participantes, ranking con pantalla grande,
  estadísticas, descarga de fotos en ZIP, imprimir QRs, abrir y cerrar el
  evento (a mano o solo, con hora de inicio y de fin), duplicar un evento para
  el siguiente. Cuatro roles (admin, moderador, revisor de fotos y editor de
  retos); salvo el admin, cada cuenta ve solo los eventos que tiene asignados.
- **Multi-evento**: ningún evento está en el código; cada uno se crea en el panel.

## Instalación

### Qué se necesita

| | |
|---|---|
| **Servidor** | Raspberry Pi 5 (u otro Linux de 64 bits) con **Docker**. Idealmente un SSD por USB para los datos. |
| **Dominio** | `sacquest.penginexr.com`, gestionado en Cloudflare (plan gratuito). |
| **API keys** | **Ninguna.** El proyecto no usa servicios externos. Los únicos secretos son `APP_SECRET`, el token del túnel de Cloudflare y las contraseñas del panel. |

### Dónde va cada configuración

| Qué | Dónde | Notas |
|---|---|---|
| **Dominio** | `server/.env` → `APP_DOMAIN` | **El único lugar.** Con él se arman los QR y el CORS. El túnel apunta a ese mismo nombre (panel de Cloudflare). |
| Secreto de firmas | `server/.env` → `APP_SECRET` | `openssl rand -base64 32`. |
| Túnel de Cloudflare | `server/.env` → `TUNNEL_TOKEN` | Se copia del panel de Cloudflare. |
| Carpeta de datos, backups | `.env` (raíz) → `SAC_DATA_DIR`, `SAC_BACKUP_DIR` | Opcional. Por defecto, un volumen de Docker y `./backups`. |
| Eventos, retos, Ramas, logros | Panel `/admin` | Nada de eso se configura en archivos. |

Plantillas comentadas: [`server/.env.example`](server/.env.example) y [`.env.example`](.env.example).
Los `.env` reales están en `.gitignore`: nunca se suben al repo.

### En el servidor (Docker)

La página y la API van en un solo contenedor; el túnel de Cloudflare, en otro.
No hay que abrir puertos en el router.

```bash
git clone https://github.com/clousck/SAC-Quest.git ~/Git/sac-quest
cd ~/Git/sac-quest
cp server/.env.example server/.env     # completar APP_SECRET y TUNNEL_TOKEN
mkdir -p backups
docker compose --profile tunnel up -d --build
docker compose exec app npm run create-admin -- --username admin
```

Luego: `https://sacquest.penginexr.com/admin`. Actualizar: `git pull && docker compose up -d --build`,
o con un solo comando desde tu computadora (`git deploy`, por Tailscale; ver la guía).

Guía paso a paso desde una Pi recién instalada (Docker, SSD, túnel, backups,
checklist del evento, problemas comunes): **[docs/docker.md](docs/docker.md)**.

### Documentación

| Para quién | Documento |
|---|---|
| Organizadores y moderadores (usar el panel) | [docs/organizadores.md](docs/organizadores.md) |
| Participantes (cómo se juega y se puntúa) | [docs/reglas.md](docs/reglas.md) |
| Ensayo antes del evento | [docs/ensayo.md](docs/ensayo.md) |
| Quien instala y mantiene el servidor | [docs/docker.md](docs/docker.md) |

### En tu computadora (desarrollo)

Requiere Node.js ≥ 22.13.

```bash
npm install
cd server && npm install
npm run seed-demo                                # evento "demo" con un reto de cada tipo (imprime el código)
npm run create-admin -- --username admin         # pide la contraseña
npm run dev                                      # API en http://localhost:8787/api
```

En otra terminal, en la raíz:

```bash
npm run dev                                      # https://localhost:5173 (pasa /api a la API)
```

- Participante: `https://localhost:5173/e/demo?c=<código de seed-demo>`
- Panel: `https://localhost:5173/admin`
- Desde el celular en la misma red: `npm run build && npm run preview` y abrir
  `https://<ip-de-tu-pc>:4173` (aceptar el certificado; la cámara exige HTTPS).

En desarrollo no hace falta ningún `.env`: se usan valores de prueba.

```bash
cd server && npm test                                     # pruebas de la API
cd server && npm run loadtest -- --code <código> --users 150
cd server && npm run diagnose -- <evento> ["<nombre>"]    # estado de un evento (solo lee)
```

En cada push, GitHub corre solo las pruebas y la compilación
(`.github/workflows/pruebas.yml`); el resultado se ve en la pestaña **Actions**
del repo.

## Arquitectura

```
Frontend (React + Vite)          API (server/)              Raspberry Pi
servido por la API    ──▶  Node + Hono  ──▶  SQLite (quest.db) + fotos en disco
src/api/client.js es el único       /api/...            detrás de Cloudflare Tunnel
contacto con el backend
```

- El frontend solo habla con la API a través de `src/api/` (`/api` del mismo dominio).
- Las fotos pasan por `server/src/storage.js`: hoy disco local, mañana R2/S3
  implementando los mismos métodos.
- Las fotos **no son públicas**: la API entrega URLs firmadas con vencimiento
  solo a participantes y moderadores con sesión.
- Participantes sin cuenta: un token por evento en el teléfono y un **código de
  recuperación** en el perfil para seguir desde otro teléfono.
- XP, niveles, logros y ranking se calculan a partir de los retos aprobados:
  aprobar, rechazar o borrar corrige todo automáticamente.

## Estructura

    src/app/App.jsx               rutas (cada parte se descarga solo al abrirla)
    src/api/                      client.js (fetch/subidas), quest.js, admin.js
    src/features/quest/           app del participante: entrar, retos, envío de
                                  evidencia, QR, ranking, galería, perfil, cola offline
    src/features/admin/           panel: moderación, retos, participantes, ranking,
                                  galería/ZIP, ajustes, usuarios, impresión de QRs
    src/features/booth/           booth de Watt (ver abajo)
    src/shared/                   imageResize (reduce la foto y quita el EXIF), toasts…
    server/src/
      app.js                      Hono: CORS, errores, /api/media firmadas, estáticos
      db.js                       esquema SQLite y migraciones
      rules.js                    niveles, logros, desbloqueos, ranking, puntaje de Rama
      survey.js                   encuestas: validar, corregir, resumir
      routes/participant.js       API de participantes
      routes/admin.js             API del panel
      storage.js                  fotos en disco
    server/scripts/               create-admin, seed-demo, backup, loadtest
    Dockerfile, docker-compose.yml   imagen (página + API) y túnel de Cloudflare
    deploy/                       actualización con `git deploy` (señal por Tailscale)
    docs/                         guías: servidor, organizadores, reglas (y su PDF), ensayo

### Rutas

| URL | Qué es |
|---|---|
| `/e/:evento?c=CÓDIGO` | QR del evento: entrar y jugar |
| `/e/:evento/q/:código` | QR impreso de un checkpoint o de una encuesta |
| `/e/:evento/s/:id` | encuesta |
| `/e/:evento/capturar` | botón central: escáner de QR y retos de foto |
| `/` | entrar escribiendo el código del evento o escaneando su QR |
| `/e/:evento/watt` | booth libre con Watt |
| `/watt` | booth de Watt sin evento |
| `/admin` | panel |

# Booth de Watt

Es la experiencia original: se abre la cámara con Watt encima, se elige una
pose, se toma la foto y se comparte. En SAC
Quest es además el reto **AR**: en modo `challenge` la foto se envía como
evidencia en vez de compartirse.

## Cómo funciona

La página abre en **modo cámara** (Watt encima del video) y, si el teléfono lo
soporta, ofrece el botón **"Poner a Watt en el piso (AR)"**:

| Dispositivo | AR | Poses en AR | Foto 3s en AR |
|---|---|---|---|
| Android + Chrome (ARCore) | WebXR: Watt apoyado en el piso real | Sí, botones en pantalla | Sí (cámara + Watt) |
| iPhone / iPad (Safari) | AR Quick Look con la pose elegida | Se elige antes de entrar | No: botón de foto de Quick Look o captura de pantalla |
| Otros | Solo modo cámara | Sí | Sí |

- **Modo cámara**: `getUserMedia`, trasera por defecto (⇄ cambia a la frontal). Watt fijo en
  pantalla: un dedo lo mueve, dos dedos lo agrandan y lo giran, ⟲ lo centra.
- **AR en Android**: sesión WebXR `immersive-ar` con `hit-test` (detecta el piso),
  `dom-overlay` (los botones siguen visibles) y `camera-access` (para que la foto
  incluya la imagen de la cámara). Apuntas al piso, aparece un anillo amarillo,
  tocas y Watt queda ahí mirando al teléfono, a 0.8 m de alto. Tocar el piso lo
  mueve; pellizcar lo agranda y lo gira. Compartir/Descargar salen primero del AR.
- **AR en iPhone**: Safari no tiene WebXR, así que se usa Quick Look. La pose
  elegida se "hornea" en una malla estática y se exporta a USDZ en el propio
  navegador (Quick Look no permite cambiar poses adentro). Para otra pose: salir,
  elegirla y volver a entrar.
- **Poses**: cada pose del FBX es un clip de un solo keyframe; los huesos
  interpolan hacia la pose nueva. Cada pose se ajusta para que su punto más bajo
  toque el piso: "Acostado" queda tendido en el suelo (0.34 m alto × 0.8 m largo).
- **Foto**: JPG con exactamente lo que se ve, sin los botones. Resolución:
  - *Android (Chrome)*, solo en el booth libre (en un reto la foto se reduce a
    2048 px antes de subirla, así que se usa el cuadro de video): foto real del
    sensor con `ImageCapture.takePhoto()`, a la
    resolución máxima de la cámara, recortada al encuadre de la pantalla sin
    estirar (en un Pixel 9, ~1820×4080). La foto del sensor es 4:3 y puede venir
    girada, y el video puede estar recortado por estabilización: en vez de
    suponerlo, se compara una miniatura del video con la foto para encontrar el
    giro y el recorte. Si la coincidencia no es confiable, se usa el cuadro de video.
  - *iPhone*: Safari no tiene `ImageCapture`; la foto sale del video, pedido en 4K.
  - *AR*: la imagen de la cámara la fija ARCore; la foto sale a la resolución
    nativa de la pantalla.
  - Watt se renderiza directo a la resolución final. JPG calidad 0.95.
- **Foto horizontal**: si la rotación automática está activada, la página gira
  y la foto sale horizontal sola. Si está bloqueada, el acelerómetro detecta que
  el teléfono está de lado: Watt se muestra derecho, aparece la etiqueta
  "Foto horizontal" y la foto se guarda girada, en horizontal. La interfaz no
  gira. Funciona en modo cámara y en AR. En iPhone el acelerómetro pide
  permiso; se solicita con el primer toque. `?rot=90` simula el giro en escritorio.
- **Salir**: en AR vuelve al modo cámara; fuera del AR apaga la cámara y muestra
  una pantalla de cierre (una página abierta desde un QR no puede cerrar su propia
  pestaña). "Volver a empezar" reabre la cámara.
- **Compartir**: Web Share API → hoja de compartir del sistema → WhatsApp → grupo.
  Ninguna web puede mandar una imagen directo a un grupo; el usuario lo elige.

En un reto AR en iPhone, Quick Look abre fuera de la página: la foto se toma
ahí, queda en la galería y al volver se sube con el botón «Subir la foto del AR
desde la galería». El modo cámara sigue disponible y entrega la foto directo.

## Estructura del booth

    src/shared/inAppBrowser.js detecta el navegador interno de Instagram, Facebook y TikTok
    src/features/booth/
      WattBooth.jsx            UI: poses, foto, vista previa
                               (mode "free": compartir · "challenge": onSubmit(blob))
      poses.js                 botones: clip del FBX → etiqueta
      faces.js                 botones de cara: textura → etiqueta
      WattCanvas.jsx           canvas de three.js
      wattStage.js             escena, carga del FBX, poses, gestos, AR WebXR
      quickLook.js             pose → USDZ para Quick Look (iPhone)
      useCamera.js             cámara frontal/trasera, autoplay bloqueado, sin imagen
      useDeviceRotation.js     teléfono de lado con la rotación bloqueada
      composePhoto.js          video + Watt → JPG
      assets/                  watt.fbx y las texturas de las caras

## Poses

El FBX trae 10 clips. Los que se usan:

| Clip              | Botón    |
|-------------------|----------|
| `Armature|Pose 1` | Baile    |
| `Armature|Pose 2` | Tierno   |
| `Armature|Pose 3` | ¡Fuerza! |
| `Armature|Pose 4` | Abrazo   |
| `Armature|Pose 5` | Acostado |
| `Armature|Pose 6` | Pícaro   |

`Pose T`, `Action`, `Action.001` y `Action.002` quedan fuera: las tres `Action`
son copias exactas de la Pose T (restos de Blender). Para renombrar o reordenar
botones, edita `src/features/booth/poses.js`.

`?pose=Pose%203` en la URL elige la pose inicial.

## Caras de Watt

La textura no viene embebida en el FBX (apunta a `C:\Users\Oscar\...\gatoieeee.png`,
una ruta de otra PC). La app la reemplaza por las caras de `src/features/booth/assets/`:

| Archivo | Botón | Boca / ojos |
|---|---|---|
| `watt-cara-1.png` | 😺 Tranquilo | boca ":3", ojos normales (inicial) |
| `watt-cara-2.png` | 😸 Feliz | boca abierta, ojos normales |
| `watt-cara-3.png` | 😵 Mareado | lengua afuera, ojos en espiral |

Cada archivo es la textura completa del modelo (1024×1024); solo cambian boca y
ojos. Las tres se precargan, así que el cambio es instantáneo, y la foto y el
USDZ de iPhone llevan la cara elegida. Para agregar o renombrar caras, edita
`src/features/booth/faces.js`. `?cara=2` en la URL elige la cara inicial.

## Probar en el celular

    npm run dev                          # https://localhost:5173, para programar
    npm run build && npm run preview     # https://<tu-ip>:4173, para probar en el celular

Las dos corren por HTTPS (certificado autofirmado): sin HTTPS el navegador no
da acceso a la cámara. En el celular hay que aceptar la advertencia del
certificado una vez. Para probar desde el celular usa `preview`, no `dev`:
en dev three.js se sirve sin minificar y tarda mucho en cargar por wifi.

`?nocam` en la URL no pide la cámara (fondo liso), útil en escritorio.

## Si la cámara se ve en negro

La app detecta estos casos y avisa en pantalla:

- **Navegador dentro de una app** (Instagram, Facebook, TikTok): la cámara
  suele verse en negro. Aviso con instrucciones para abrir en Safari/Chrome y
  botón para copiar el enlace.
- **Reproducción automática bloqueada** (iPhone en modo de bajo consumo): botón
  "Toca para activar la cámara".
- **Cámara abierta sin imagen** durante 5 s: aviso para reintentar o cambiar de
  navegador.
- **Gráfico 3D perdido** (iOS le quita la GPU a la página por memoria): aviso con
  botón para recargar; three.js intenta recuperarlo solo. La foto se renderiza por
  mosaicos de 1024×1024 para no pedir de golpe un canvas enorme a la GPU.
