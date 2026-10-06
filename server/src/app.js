import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { verifySignature } from './auth.js'
import { adminRoutes } from './routes/admin.js'
import { participantRoutes } from './routes/participant.js'
import { applySchedule } from './schedule.js'
import { createServices } from './services.js'
import { HttpError, forbidden, notFound } from './util.js'

/**
 * Arma la aplicacion. Recibe sus dependencias para poder probarla con una
 * base en memoria y una carpeta temporal.
 */
export function createApp({ db, storage, config }) {
  const svc = createServices({ db, storage, config })
  const app = new Hono()

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status)
    }
    console.error(err)
    return c.json({ error: { code: 'server_error', message: 'Error del servidor. Intenta de nuevo.' } }, 500)
  })

  const api = new Hono()
  api.use(
    '*',
    cors({
      origin: (origin) => (!config.corsOrigins.length || config.corsOrigins.includes(origin) ? origin : null),
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 86400,
    }),
  )

  // Eventos con inicio o fin programado: se abren y cierran solos.
  api.use('*', async (c, next) => {
    applySchedule(db)
    await next()
  })

  api.get('/health', (c) => {
    db.get('SELECT 1')
    return c.json({ ok: true, time: new Date().toISOString() })
  })

  // Fotos e imagenes: solo con URL firmada (ver auth.js).
  api.get('/media/:key{.+}', async (c) => {
    const key = c.req.param('key')
    const { exp, sig, dl } = c.req.query()
    if (!verifySignature(config.secret, `${key}:${exp}`, sig, exp)) throw forbidden('Enlace vencido.')
    const info = await storage.stat(key)
    if (!info) throw notFound()
    const maxAge = Math.max(0, Number(exp) - Math.floor(Date.now() / 1000))
    const headers = {
      'content-type': 'image/jpeg',
      'content-length': String(info.size),
      'cache-control': `private, max-age=${maxAge}, immutable`,
    }
    if (dl) headers['content-disposition'] = `attachment; filename="${key.split('/').pop()}"`
    return new Response(Readable.toWeb(storage.stream(key)), { headers })
  })

  api.route('/', participantRoutes(svc))
  api.route('/admin', adminRoutes(svc))
  api.all('*', () => {
    throw notFound('Ruta de API inexistente.')
  })
  app.route('/api', api)

  // Opcional: servir tambien el frontend compilado (todo en la Pi).
  if (config.staticDir && existsSync(join(config.staticDir, 'index.html'))) {
    const indexHtml = readFileSync(join(config.staticDir, 'index.html'), 'utf8')
    app.use(
      '/assets/*',
      serveStatic({
        root: config.staticDir,
        onFound: (_path, c) => c.header('cache-control', 'public, max-age=31536000, immutable'),
      }),
    )
    app.use('*', serveStatic({ root: config.staticDir }))
    // Rutas del SPA (/e/..., /admin/...): siempre index.html.
    app.get('*', (c) => c.html(indexHtml))
  }

  return app
}
