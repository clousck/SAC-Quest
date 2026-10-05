/**
 * Unico punto de contacto con el backend. El resto de la app no sabe que
 * servidor hay detras: solo usa estas funciones.
 * La API vive en /api del mismo dominio (en desarrollo, Vite hace de proxy).
 */
export const API_BASE = '/api'

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
  /** Error de red o del servidor: vale la pena reintentar. */
  get retryable() {
    return this.status === 0 || this.status >= 500 || this.status === 408 || this.status === 429
  }
}

/** Las URLs de fotos vienen relativas a la base de la API. */
export const mediaUrl = (path) => (path ? `${API_BASE}/${path}` : null)

async function parse(res) {
  const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => null) : null
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `Error ${res.status}`)
  }
  return data
}

export async function request(path, { method = 'GET', body, token, signal } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new ApiError(0, 'network', 'Sin conexión con el servidor. Revisa tu internet.')
  }
  return parse(res)
}

/** Subida multipart con progreso (fetch no informa progreso de subida). */
export function upload(path, form, { token, onProgress, timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}${path}`)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.timeout = timeout
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onload = () => {
      let data = null
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        // respuesta no JSON (p. ej. pagina de error de Cloudflare)
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new ApiError(xhr.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `Error ${xhr.status}`))
    }
    const networkError = () => reject(new ApiError(0, 'network', 'Se cortó la conexión mientras subía la foto.'))
    xhr.onerror = networkError
    xhr.ontimeout = networkError
    xhr.send(form)
  })
}
