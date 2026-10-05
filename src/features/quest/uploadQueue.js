import { ApiError } from '../../api/client'
import { submitPhoto } from '../../api/quest'

/**
 * Envio de evidencias a prueba de wifi de evento:
 *  1. Reintenta un par de veces si falla la red o el servidor.
 *  2. Si sigue sin poder, guarda la foto en IndexedDB y la manda sola
 *     cuando vuelva la conexion (o la proxima vez que se abra la app).
 * El clientId hace que un reintento nunca duplique el envio en el servidor.
 */

export class QueuedError extends Error {
  constructor() {
    super('Sin conexión: la foto quedó guardada y se enviará sola cuando vuelva la señal.')
    this.queued = true
  }
}

const DB_NAME = 'sacquest'
const STORE = 'uploads'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'clientId' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore(mode, fn) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const result = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(result.result ?? result)
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

const enqueue = (item) => withStore('readwrite', (s) => s.put(item))
const remove = (clientId) => withStore('readwrite', (s) => s.delete(clientId))

export async function listQueued(slug) {
  try {
    const all = await withStore('readonly', (s) => s.getAll())
    return all.filter((i) => i.slug === slug)
  } catch {
    return [] // IndexedDB no disponible (navegacion privada en algunos navegadores)
  }
}

export const newClientId = () =>
  crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Envia la evidencia. Devuelve la respuesta del servidor, o lanza
 * QueuedError si quedo guardada para mas tarde, o ApiError si el servidor
 * la rechazo (reto bloqueado, ya completado, etc.).
 */
export async function sendEvidence({ slug, token, challengeId, prepared, capturedWith, onProgress }) {
  const item = { clientId: newClientId(), slug, challengeId, capturedWith, ...prepared, createdAt: Date.now() }
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await submitPhoto(slug, token, challengeId, item, onProgress)
    } catch (e) {
      lastError = e
      if (!(e instanceof ApiError) || !e.retryable) throw e
      onProgress?.(0)
      await sleep(1500 * (attempt + 1))
    }
  }
  try {
    await enqueue(item)
  } catch {
    throw lastError
  }
  throw new QueuedError()
}

let flushing = null

/**
 * Reintenta lo que quedo en cola. Devuelve { sent, failed } con los envios
 * que el servidor acepto o rechazo definitivamente.
 */
export function flushQueue(slug, token) {
  flushing ??= (async () => {
    const sent = []
    const failed = []
    for (const item of await listQueued(slug)) {
      try {
        sent.push(await submitPhoto(slug, token, item.challengeId, item))
        await remove(item.clientId)
      } catch (e) {
        if (e instanceof ApiError && e.retryable) break // sigue sin red: probar despues
        failed.push({ item, error: e })
        await remove(item.clientId)
      }
    }
    return { sent, failed }
  })().finally(() => {
    flushing = null
  })
  return flushing
}
