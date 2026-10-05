import { mediaExpiry, sign } from './auth.js'
import { badRequest, createRateLimiter, isJpeg } from './util.js'

/** Dependencias compartidas por todas las rutas. */
export function createServices({ db, storage, config }) {
  const limit = createRateLimiter()

  /** URL firmada, relativa a la base de la API (el frontend le antepone /api). */
  function mediaUrl(key, { download = false } = {}) {
    if (!key) return null
    const exp = mediaExpiry()
    const sig = sign(config.secret, `${key}:${exp}`)
    return `media/${key}?exp=${exp}&sig=${sig}${download ? '&dl=1' : ''}`
  }

  /** Lee un archivo de un multipart y verifica que sea un JPG de tamaño razonable. */
  async function readJpeg(file, field, maxBytes = config.maxPhotoBytes) {
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      throw badRequest(`Falta la imagen «${field}»`, 'photo_required')
    }
    if (file.size > maxBytes) throw badRequest('La imagen es demasiado grande.', 'photo_too_large')
    const buf = Buffer.from(await file.arrayBuffer())
    if (!isJpeg(buf)) throw badRequest('La imagen debe ser JPG.', 'photo_invalid')
    return buf
  }

  return { db, storage, config, limit, mediaUrl, readJpeg }
}
