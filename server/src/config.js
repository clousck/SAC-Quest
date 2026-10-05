import { resolve } from 'node:path'

/** "quest.ieee.org", "https://quest.ieee.org/" → "https://quest.ieee.org" */
export function publicUrl(domain) {
  const d = String(domain ?? '').trim().replace(/\/+$/, '')
  if (!d) return ''
  return /^https?:\/\//.test(d) ? d : `https://${d}`
}

/**
 * Configuracion desde variables de entorno (ver .env.example).
 * Nada del evento vive aca: los eventos se crean desde el panel.
 */
export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production'
  const secret = env.APP_SECRET || ''
  if (production && secret.length < 32) {
    throw new Error('APP_SECRET debe tener al menos 32 caracteres en produccion')
  }
  const appUrl = publicUrl(env.APP_DOMAIN)
  return {
    production,
    port: Number(env.PORT || 8787),
    host: env.HOST || '0.0.0.0',
    dataDir: resolve(env.DATA_DIR || './data'),
    // Firma las URLs de las fotos. En desarrollo se usa uno fijo.
    secret: secret || 'dev-secret-no-usar-en-produccion-0000',
    // URL publica donde abren los participantes (APP_DOMAIN). Con ella se
    // arman los QR aunque el panel se abra por localhost o por la IP local.
    appUrl,
    // Origen permitido para CORS: el propio APP_DOMAIN. Sin dominio
    // (desarrollo) vale cualquiera: la API usa tokens bearer, no cookies.
    corsOrigins: appUrl ? [appUrl] : [],
    // Opcional: carpeta del frontend compilado (dist/) para servir todo
    // desde la Pi con un solo dominio.
    staticDir: env.STATIC_DIR ? resolve(env.STATIC_DIR) : '',
    maxPhotoBytes: Number(env.MAX_PHOTO_MB || 10) * 1024 * 1024,
  }
}
