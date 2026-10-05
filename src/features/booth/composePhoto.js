/**
 * Arma la foto final: fondo de la camara + Watt, con exactamente el encuadre
 * que se ve en pantalla (mismo recorte que object-fit: cover y mismo
 * espejado de la camara frontal).
 *
 * Fondo, de mejor a peor:
 *  1. Foto completa del sensor con ImageCapture.takePhoto() (Chrome/Android):
 *     misma calidad que la app de camara.
 *  2. El cuadro actual del video (iPhone y cualquier caso en que 1 falle).
 * `sensor: false` salta el paso 1: en un reto la foto se reduce antes de
 * subirla, asi que la resolucion del sensor se perderia igual.
 * Watt se renderiza a la resolucion final, no se estira.
 */
export async function composePhoto({ video, mirror, stage, viewW, viewH, rotation = 0, sensor = true }) {
  const hasVideo = video && video.videoWidth > 0
  let bg = null // { image, x, y, w, h } region de `image` que corresponde a la pantalla

  if (hasVideo) {
    const vis = visibleRegion(video.videoWidth, video.videoHeight, viewW, viewH)
    const still = !sensor ? null : await takeSensorPhoto(video).catch((e) => {
      console.warn('[foto] takePhoto no disponible, uso el video:', e?.message ?? e)
      return null
    })
    if (still) {
      // Region visible del video → pixeles de la foto del sensor.
      const m = still.frame.w / video.videoWidth
      bg = {
        image: still.image,
        x: still.frame.x + vis.x * m,
        y: still.frame.y + vis.y * m,
        w: vis.w * m,
        h: vis.h * m,
      }
    } else {
      bg = { image: video, ...vis }
    }
  }

  // Resolucion de salida: la del fondo, sin estirar. Sin camara (?nocam) o
  // con un video chico, al menos la del canvas de Watt.
  const gl = stage.canvas
  const base = bg ?? { w: viewW, h: viewH }
  const k = Math.max(1, gl.width / base.w)
  const outW = Math.round(base.w * k)
  const outH = Math.round(base.h * k)

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'

  if (bg) {
    if (mirror) {
      ctx.translate(outW, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(bg.image, bg.x, bg.y, bg.w, bg.h, 0, 0, outW, outH)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, outH)
    g.addColorStop(0, '#2b3a55')
    g.addColorStop(1, '#0f1115')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, outW, outH)
  }

  ctx.drawImage(stage.renderAtSize(outW, outH), 0, 0, outW, outH)
  bg?.image.close?.()

  return toJpeg(rotateCanvas(canvas, rotation))
}

/** Region del video (en sus pixeles) que se ve con object-fit: cover. */
function visibleRegion(vw, vh, viewW, viewH) {
  const cover = Math.max(viewW / vw, viewH / vh)
  const w = viewW / cover
  const h = viewH / cover
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h }
}

// --- foto completa del sensor ---

const TAKE_PHOTO_TIMEOUT = 6000
// Por debajo de esta correlacion no confiamos en la alineacion.
const MIN_MATCH = 0.6

/**
 * Dispara una foto real del sensor y averigua que parte de ella corresponde
 * al cuadro de video. La foto suele ser 4:3 y el video 16:9, puede venir
 * girada y el video puede estar recortado por estabilizacion: en vez de
 * suponerlo, lo medimos comparando miniaturas.
 *
 * Devuelve { image, frame } donde `frame` es el rectangulo de `image`
 * equivalente al cuadro de video completo, o null si no se puede.
 */
async function takeSensorPhoto(video) {
  if (typeof ImageCapture === 'undefined') return null
  const track = video.srcObject?.getVideoTracks?.()[0]
  if (!track || track.readyState !== 'live') return null

  // Referencia: el cuadro de video en el instante del disparo.
  const ref = thumbnail(video, 0, 0, video.videoWidth, video.videoHeight, video.videoWidth, video.videoHeight)
  const capture = new ImageCapture(track)
  const blob = await withTimeout(takeMaxPhoto(capture), TAKE_PHOTO_TIMEOUT)
  const bitmap = await createImageBitmap(blob)

  const fit = alignToVideo(bitmap, video.videoWidth, video.videoHeight, ref)
  if (!fit || fit.score < MIN_MATCH) {
    bitmap.close()
    throw new Error(`no se pudo alinear la foto con el video (${fit ? fit.score.toFixed(2) : 'sin candidatos'})`)
  }
  let image = bitmap
  if (fit.rotation) {
    image = rotateCanvas(bitmap, fit.rotation)
    bitmap.close()
  }
  return { image, frame: fit.frame }
}

async function takeMaxPhoto(capture) {
  try {
    const caps = await capture.getPhotoCapabilities()
    const settings = {}
    if (caps.imageWidth?.max) settings.imageWidth = caps.imageWidth.max
    if (caps.imageHeight?.max) settings.imageHeight = caps.imageHeight.max
    return await capture.takePhoto(settings)
  } catch {
    // Algunos dispositivos rechazan los ajustes: probamos con los de fabrica.
    return capture.takePhoto()
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('takePhoto tardó demasiado')), ms)),
  ])
}

const THUMB = 48 // ancho de las miniaturas que se comparan

/**
 * Busca giro (0/90/180/270) y escala tal que el centro de la foto, con el
 * aspecto del video, se parezca lo mas posible al cuadro de video.
 */
function alignToVideo(bitmap, vw, vh, ref) {
  const videoAspect = vw / vh
  let best = null

  for (const rotation of [0, 90, 180, 270]) {
    const rw = rotation % 180 ? bitmap.height : bitmap.width
    const rh = rotation % 180 ? bitmap.width : bitmap.height
    // El video y la foto deben tener la misma orientacion (ambos verticales u horizontales).
    if (rw >= rh !== vw >= vh) continue

    // Copia reducida de la foto girada, para medir rapido.
    const small = rotateCanvas(downscale(bitmap, 320), rotation)
    const sx = small.width / rw

    // Rectangulo mas grande, centrado, con el aspecto del video.
    const fullW = rw / rh > videoAspect ? rh * videoAspect : rw
    const fullH = fullW / videoAspect

    const tryScale = (f) => {
      const w = fullW * f
      const h = fullH * f
      const x = (rw - w) / 2
      const y = (rh - h) / 2
      const t = thumbnail(small, x * sx, y * sx, w * sx, h * sx, vw, vh)
      const score = correlation(ref, t)
      if (!best || score > best.score) best = { rotation, score, frame: { x, y, w, h } }
      return score
    }

    // Busqueda gruesa y luego fina alrededor del mejor.
    let top = { f: 1, score: -Infinity }
    for (let f = 1; f >= 0.6; f -= 0.02) {
      const s = tryScale(f)
      if (s > top.score) top = { f, score: s }
    }
    for (let f = top.f - 0.02; f <= Math.min(1, top.f + 0.02); f += 0.004) tryScale(f)
  }
  return best
}

function downscale(src, maxSide) {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height))
  const c = document.createElement('canvas')
  c.width = Math.round(src.width * s)
  c.height = Math.round(src.height * s)
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height)
  return c
}

/** Miniatura en escala de grises de una region, con el aspecto del video. */
function thumbnail(src, x, y, w, h, vw, vh) {
  const tw = THUMB
  const th = Math.round((THUMB * vh) / vw)
  const c = document.createElement('canvas')
  c.width = tw
  c.height = th
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(src, x, y, w, h, 0, 0, tw, th)
  const d = ctx.getImageData(0, 0, tw, th).data
  const out = new Float32Array(tw * th)
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  return out
}

/**
 * Correlacion normalizada (-1..1). Ignora diferencias de brillo y contraste
 * entre el procesamiento de foto y el de video.
 */
function correlation(a, b) {
  const n = Math.min(a.length, b.length)
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

// --- utilidades ---

/**
 * Gira la imagen para que quede derecha cuando el telefono estaba de lado y
 * la pagina no roto. `rotation` = cuanto giro el telefono en sentido
 * antihorario; la imagen se gira lo mismo en el mismo sentido.
 */
export function rotateCanvas(src, rotation) {
  const deg = ((rotation % 360) + 360) % 360
  if (!deg) return src
  const sideways = deg === 90 || deg === 270
  const out = document.createElement('canvas')
  out.width = sideways ? src.height : src.width
  out.height = sideways ? src.width : src.height
  const ctx = out.getContext('2d')
  ctx.translate(out.width / 2, out.height / 2)
  // En canvas el angulo positivo es horario: negativo = antihorario.
  ctx.rotate((-deg * Math.PI) / 180)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return out
}

export function toJpeg(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la foto'))), 'image/jpeg', 0.95),
  )
}

/** Solo para pruebas: alinea `photo` contra un cuadro de video dado. */
export function _testAlign(photo, frame) {
  const ref = thumbnail(frame, 0, 0, frame.width, frame.height, frame.width, frame.height)
  return alignToVideo(photo, frame.width, frame.height, ref)
}
