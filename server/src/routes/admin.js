import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import yazl from 'yazl'
import {
  hashPassword,
  randomCode,
  randomToken,
  recoveryCode,
  sha256,
  sign,
  verifyPassword,
  verifySignature,
} from '../auth.js'
import { now, parseJson } from '../db.js'
import {
  CHALLENGE_TYPES,
  DEFAULT_LEVELS,
  DEFAULT_SETTINGS,
  DEFAULT_TEAM_SCORE,
  TEAM_GOAL_MAX_MEMBERS,
  normalizeLevels,
  participantRanking,
  teamRanking,
  toBadge,
  toChallenge,
  toEvent,
  toTeamGoal,
} from '../rules.js'
import { normalizeSurvey, summarize } from '../survey.js'
import {
  HttpError,
  badRequest,
  bearer,
  clientIp,
  conflict,
  forbidden,
  int,
  isoDate,
  jsonBody,
  notFound,
  oneOf,
  pick,
  slugify,
  str,
} from '../util.js'
import { formatRecovery } from './participant.js'

const SESSION_DAYS = 14

export const DEFAULT_BADGES = [
  { name: 'Primer paso', icon: '👣', description: 'Completa tu primer reto', rule: { type: 'count', n: 1 } },
  { name: 'Imparable', icon: '⚡', description: 'Completa 5 retos', rule: { type: 'count', n: 5 } },
  { name: 'Amigo de Watt', icon: '🐱', description: 'Completa un reto AR con Watt', rule: { type: 'challengeType', challengeType: 'AR', n: 1 } },
  { name: 'Explorador', icon: '🧭', description: 'Encuentra todos los checkpoints QR', rule: { type: 'allOfType', challengeType: 'QR' } },
]

// Roles del panel. `admin` puede todo y ve todos los eventos; los demas solo
// los eventos donde estan asignados y solo lo que diga ACCESS.
const STAFF_ROLES = ['moderator', 'reviewer']
const ROLES = ['admin', ...STAFF_ROLES]

/** Rol efectivo de una fila de `admins` (ver la migracion de staff_role). */
const roleOf = (row) => (row.role === 'admin' ? 'admin' : STAFF_ROLES.includes(row.staff_role) ? row.staff_role : 'moderator')

/**
 * Lo que puede hacer cada rol que no es admin: [metodo, ruta, roles]. Una
 * peticion que no aparece aca es solo para administradores. Es el unico lugar
 * donde se decide; los requireAdmin de cada ruta quedan como segunda barrera.
 *  - moderator: moderar, borrar envios, participantes, ver y descargar, y
 *               crear y editar retos (borrarlos no: se lleva fotos y puntos).
 *  - reviewer:  solo la cola de fotos: aprobar y rechazar.
 */
const ACCESS = [
  ['GET', /^\/(me|events)$/, STAFF_ROLES],
  ['POST', /^\/logout$/, STAFF_ROLES],
  // Lecturas que usan los formularios y filtros de todas las pantallas.
  ['GET', /^\/events\/\d+$/, STAFF_ROLES],
  ['GET', /^\/events\/\d+\/(teams|challenges|badges|team-goals)$/, STAFF_ROLES],
  ['GET', /^\/challenges\/\d+$/, STAFF_ROLES],
  // Moderacion.
  ['GET', /^\/events\/\d+\/submissions$/, ['moderator', 'reviewer']],
  ['POST', /^\/submissions\/\d+\/review$/, ['moderator', 'reviewer']],
  ['DELETE', /^\/submissions\/\d+$/, ['moderator']],
  // Participantes.
  ['GET', /^\/events\/\d+\/participants$/, ['moderator']],
  ['PATCH', /^\/participants\/\d+$/, ['moderator']],
  ['POST', /^\/participants\/\d+\/recovery-code$/, ['moderator']],
  // Ver y descargar.
  ['GET', /^\/events\/\d+\/(ranking|stats|announcements)$/, ['moderator']],
  ['POST', /^\/events\/\d+\/(announcements|export)$/, ['moderator']],
  ['DELETE', /^\/announcements\/\d+$/, ['moderator']],
  ['GET', /^\/challenges\/\d+\/survey-results$/, ['moderator']],
  // Retos.
  ['POST', /^\/events\/\d+\/challenges(\/reorder)?$/, ['moderator']],
  ['PATCH', /^\/challenges\/\d+$/, ['moderator']],
  ['POST', /^\/challenges\/\d+\/(regenerate-qr|image)$/, ['moderator']],
  ['DELETE', /^\/challenges\/\d+\/image$/, ['moderator']],
]

const BADGE_RULES = ['count', 'xp', 'category', 'challengeType', 'challenge', 'allOfType']

/** Rutas del panel: /api/admin/... */
export function adminRoutes(svc) {
  const { db, storage, config, limit, mediaUrl, readJpeg } = svc
  const r = new Hono()

  // --- sesion ---

  r.post('/login', async (c) => {
    limit(`login:${clientIp(c)}`, 10, 60_000)
    const body = await jsonBody(c)
    const admin = db.get('SELECT * FROM admins WHERE username = :username AND active = 1', {
      username: String(body.username ?? '').trim().toLowerCase(),
    })
    if (!admin || !(await verifyPassword(String(body.password ?? ''), admin.password_hash))) {
      throw new HttpError(401, 'bad_credentials', 'Usuario o contraseña incorrectos.')
    }
    const token = randomToken()
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()
    db.run('DELETE FROM admin_sessions WHERE expires_at < :t', { t: now() })
    db.run('INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (:hash, :id, :expires)', {
      hash: sha256(token),
      id: admin.id,
      expires,
    })
    return c.json({ token, admin: publicAdmin(admin), appUrl: config.appUrl || null })
  })

  // Descarga del ZIP: la firma de la URL es la autorizacion (un <a href>
  // no puede mandar la cabecera Authorization).
  r.get('/export/:file', (c) => {
    const eventId = Number(/^(\d+)\.zip$/.exec(c.req.param('file'))?.[1])
    const q = c.req.query()
    const payload = exportPayload(eventId, q.status, q.challengeId, q.teamId, q.exp)
    if (!verifySignature(config.secret, payload, q.sig, q.exp)) throw forbidden('El enlace de descarga venció.')
    const ev = getEvent(eventId)
    const rows = exportRows(ev.id, q)

    const zip = new yazl.ZipFile()
    const used = new Set()
    for (const row of rows) {
      const folder = slugify(row.challenge_title) || `reto-${row.challenge_id}`
      const who = [slugify(row.team_name || ''), slugify(row.alias)].filter(Boolean).join('_')
      let name = `${folder}/${who || 'participante'}_${row.id}.jpg`
      if (used.has(name)) name = name.replace(/\.jpg$/, `_${used.size}.jpg`)
      used.add(name)
      // JPG ya esta comprimido: se guarda sin comprimir (mas rapido en la Pi).
      zip.addReadStreamLazy(name, { compress: false, mtime: new Date(row.created_at) }, (cb) =>
        cb(null, storage.stream(row.key)),
      )
    }
    zip.end()
    return new Response(Readable.toWeb(zip.outputStream), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${ev.slug}-fotos.zip"`,
      },
    })
  })

  // Todo lo demas requiere sesion.
  r.use('*', async (c, next) => {
    const token = bearer(c)
    const admin =
      token &&
      db.get(
        `SELECT a.* FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
          WHERE s.token_hash = :hash AND s.expires_at > :t AND a.active = 1`,
        { hash: sha256(token), t: now() },
      )
    if (!admin) throw new HttpError(401, 'unauthenticated', 'Inicia sesión.')
    admin.role = roleOf(admin)
    c.set('admin', admin)
    // Un moderador solo entra a los eventos donde esta asignado. Para quien no
    // lo esta, el evento (y todo lo suyo) no existe.
    if (admin.role !== 'admin') {
      const eventId = requestEventId(c.req.path)
      if (eventId != null && !moderates(admin.id, eventId)) throw notFound('Evento no encontrado.')
      const path = c.req.path.replace(/^.*?\/admin(?=\/)/, '')
      const rule = ACCESS.find(([method, pattern]) => method === c.req.method && pattern.test(path))
      if (!rule?.[2].includes(admin.role)) throw forbidden('Tu rol no permite hacer esto.')
    }
    await next()
  })

  // Tablas cuyas rutas van por id propio (/challenges/7) y no por evento.
  const EVENT_TABLES = {
    teams: 'teams',
    challenges: 'challenges',
    badges: 'badges',
    announcements: 'announcements',
    'team-goals': 'team_goals',
    submissions: 'submissions',
    participants: 'participants',
  }

  /** Evento al que apunta una peticion del panel, o null si no es de un evento. */
  function requestEventId(path) {
    const direct = /\/events\/(\d+)(?:\/|$)/.exec(path)
    if (direct) return Number(direct[1])
    const m = /\/(teams|challenges|badges|announcements|team-goals|submissions|participants)\/(\d+)(?:\/|$)/.exec(path)
    if (!m) return null
    return db.get(`SELECT event_id FROM ${EVENT_TABLES[m[1]]} WHERE id = :id`, { id: Number(m[2]) })?.event_id ?? null
  }

  const moderates = (adminId, eventId) =>
    !!db.get('SELECT 1 FROM event_moderators WHERE admin_id = :adminId AND event_id = :eventId', { adminId, eventId })

  /** Eventos, ajustes, equipos, badges y usuarios: solo rol admin (ver tambien ACCESS). */
  const requireAdmin = (c) => {
    if (c.get('admin').role !== 'admin') throw forbidden('Solo un administrador puede hacer esto.')
  }

  r.post('/logout', (c) => {
    db.run('DELETE FROM admin_sessions WHERE token_hash = :hash', { hash: sha256(bearer(c)) })
    return c.json({ ok: true })
  })

  r.get('/me', (c) => c.json({ admin: publicAdmin(c.get('admin')), appUrl: config.appUrl || null }))

  // --- helpers ---

  function getEvent(id) {
    const ev = toEvent(db.get('SELECT * FROM events WHERE id = :id', { id }))
    if (!ev) throw notFound('Evento no encontrado.')
    return ev
  }
  const eventParam = (c) => getEvent(int(c.req.param('eventId'), 'eventId'))

  function getChallenge(id) {
    const ch = toChallenge(db.get('SELECT * FROM challenges WHERE id = :id', { id }))
    if (!ch) throw notFound('Reto no encontrado.')
    return ch
  }

  function uniqueCode(table, column, length) {
    let code
    do {
      code = randomCode(length)
    } while (db.get(`SELECT 1 FROM ${table} WHERE ${column} = :code`, { code }))
    return code
  }

  function adminChallenge(ch) {
    const counts = db.get(
      `SELECT SUM(status = 'approved') approved, SUM(status = 'pending') pending, SUM(status = 'rejected') rejected
         FROM submissions WHERE challenge_id = :id`,
      { id: ch.id },
    )
    return {
      ...ch,
      imageUrl: mediaUrl(ch.imageKey),
      counts: { approved: counts.approved ?? 0, pending: counts.pending ?? 0, rejected: counts.rejected ?? 0 },
    }
  }

  /** Aplica un UPDATE solo con las columnas presentes en `data`. */
  function update(table, id, data, columns) {
    const sets = []
    const params = { id }
    for (const [key, [column, encode = (v) => v]] of Object.entries(columns)) {
      if (!Object.hasOwn(data, key)) continue
      sets.push(`${column} = :${key}`)
      params[key] = encode(data[key])
    }
    if (sets.length) db.run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = :id`, params)
  }

  const json = (v) => (v == null ? null : JSON.stringify(v))

  // --- eventos ---

  function eventSummary(ev) {
    const n = db.get(
      `SELECT (SELECT COUNT(*) FROM participants WHERE event_id = :id) participants,
              (SELECT COUNT(*) FROM submissions WHERE event_id = :id AND status = 'pending') pending,
              (SELECT COUNT(*) FROM challenges WHERE event_id = :id) challenges`,
      { id: ev.id },
    )
    return { ...ev, counts: { participants: n.participants, pending: n.pending, challenges: n.challenges } }
  }

  r.get('/events', (c) => {
    const me = c.get('admin')
    const rows =
      me.role === 'admin'
        ? db.all('SELECT * FROM events ORDER BY created_at DESC')
        : db.all(
            `SELECT e.* FROM events e JOIN event_moderators m ON m.event_id = e.id
              WHERE m.admin_id = :adminId ORDER BY e.created_at DESC`,
            { adminId: me.id },
          )
    return c.json({ events: rows.map(toEvent).map(eventSummary) })
  })

  // Moderadores del evento: todas las cuentas de moderador, con cuales lo tienen asignado.
  const listModerators = (eventId) =>
    db
      .all(
        `SELECT a.id, a.username, a.name, a.active, a.role, a.staff_role, m.event_id IS NOT NULL AS assigned
           FROM admins a LEFT JOIN event_moderators m ON m.admin_id = a.id AND m.event_id = :eventId
          WHERE a.role = 'moderator' ORDER BY a.name COLLATE NOCASE`,
        { eventId },
      )
      .map((a) => ({ id: a.id, username: a.username, name: a.name, role: roleOf(a), active: !!a.active, assigned: !!a.assigned }))

  r.get('/events/:eventId/moderators', (c) => {
    requireAdmin(c)
    return c.json({ moderators: listModerators(eventParam(c).id) })
  })

  r.post('/events/:eventId/moderators', async (c) => {
    requireAdmin(c)
    const ev = eventParam(c)
    const body = await jsonBody(c)
    const ids = new Set((Array.isArray(body.adminIds) ? body.adminIds : []).map(Number))
    db.tx(() => {
      db.run('DELETE FROM event_moderators WHERE event_id = :eventId', { eventId: ev.id })
      for (const a of db.all(`SELECT id FROM admins WHERE role = 'moderator'`)) {
        if (ids.has(a.id)) db.run('INSERT INTO event_moderators (event_id, admin_id) VALUES (:eventId, :adminId)', { eventId: ev.id, adminId: a.id })
      }
    })
    return c.json({ moderators: listModerators(ev.id) })
  })

  const eventFields = {
    name: (v) => str(v, 'nombre', { min: 2, max: 80 }),
    description: (v) => str(v, 'descripción', { max: 500 }),
    status: (v) => oneOf(v, 'estado', ['draft', 'open', 'closed']),
    startsAt: (v) => isoDate(v, 'inicio'),
    endsAt: (v) => isoDate(v, 'fin'),
    levels: (v) => {
      if (!Array.isArray(v) || !v.length) throw badRequest('Debe haber al menos un nivel.')
      const levels = normalizeLevels(v.map((l) => ({ name: str(l.name, 'nombre del nivel', { min: 1, max: 30 }), minXp: l.minXp })))
      if (levels[0].minXp !== 0) throw badRequest('El primer nivel debe empezar en 0 XP.')
      return levels
    },
    settings: (v) => {
      if (!v || typeof v !== 'object') throw badRequest('Ajustes inválidos.')
      const settings = {
        teamLabel: str(v.teamLabel ?? DEFAULT_SETTINGS.teamLabel, 'nombre de equipo', { min: 1, max: 20 }),
        accent: /^#[0-9a-f]{6}$/i.test(v.accent) ? v.accent : DEFAULT_SETTINGS.accent,
        likes: v.likes !== false,
      }
      // Solo si vienen: los demas formularios de ajustes no los mandan.
      if (v.teamScore) settings.teamScore = teamScoreFields(v.teamScore)
      if (v.pointTiers) settings.pointTiers = pointTierFields(v.pointTiers)
      return settings
    },
  }

  function pointTierFields(v) {
    if (!Array.isArray(v) || !v.length || v.length > 8) throw badRequest('Debe haber entre 1 y 8 valores de reto.')
    const ids = new Set()
    return v.map((t, i) => {
      // El id se conserva al editar: es lo que guarda cada reto.
      let id = typeof t.id === 'string' && /^[a-z0-9]{1,12}$/.test(t.id) && !ids.has(t.id) ? t.id : null
      for (let k = 1; !id; k++) if (!ids.has(`v${k}`)) id = `v${k}`
      ids.add(id)
      return {
        id,
        name: str(t.name, `nombre del valor ${i + 1}`, { min: 1, max: 20 }),
        points: int(t.points, `puntos del valor ${i + 1}`, { min: 0, max: 10000 }),
      }
    })
  }

  /** Los puntos ya otorgados siguen al valor actual del reto (una encuesta fallada sigue en 0). */
  function syncAwardedPoints(challengeId, points) {
    db.run(
      `UPDATE submissions SET points_awarded = :points
        WHERE challenge_id = :challengeId AND status = 'approved'
          AND (answer IS NULL OR json_extract(answer, '$.passed'))`,
      { challengeId, points },
    )
  }

  function teamScoreFields(v) {
    if (typeof v !== 'object') throw badRequest('Puntaje de equipo inválido.')
    const top = Array.isArray(v.top) ? v.top.map(Number) : DEFAULT_TEAM_SCORE.top
    if (!top.length || top.length > 10 || top.some((w) => !(w >= 0 && w <= 1)) || !(top[0] > 0)) {
      throw badRequest('Los pesos de los mejores integrantes deben estar entre 0 y 100 %.')
    }
    return {
      performance: int(v.performance, 'puntos de desempeño', { min: 0, max: 10000 }),
      participation: int(v.participation, 'puntos de participación', { min: 0, max: 10000 }),
      collective: int(v.collective, 'puntos colectivos', { min: 0, max: 10000 }),
      top,
      participationRef: int(v.participationRef, 'tope de participación', { min: 1, max: 1000 }),
    }
  }

  r.post('/events', async (c) => {
    requireAdmin(c)
    const body = await jsonBody(c)
    const name = eventFields.name(body.name)
    const slug = slugify(str(body.slug || name, 'slug', { min: 2, max: 40 }))
    if (!slug) throw badRequest('El identificador (slug) no es válido.')
    if (db.get('SELECT 1 FROM events WHERE slug = :slug', { slug })) throw conflict('Ya existe un evento con ese identificador.')
    const id = db.tx(() => {
      const eventId = Number(
        db.run(
          `INSERT INTO events (slug, name, description, join_code, levels, settings, created_at)
           VALUES (:slug, :name, :description, :joinCode, :levels, :settings, :t)`,
          {
            slug,
            name,
            description: body.description ? eventFields.description(body.description) : '',
            joinCode: uniqueCode('events', 'join_code', 6),
            levels: json(DEFAULT_LEVELS),
            settings: json(DEFAULT_SETTINGS),
            t: now(),
          },
        ).lastInsertRowid,
      )
      DEFAULT_BADGES.forEach((b, i) => insertBadge(eventId, { ...b, sortOrder: i }))
      return eventId
    })
    return c.json({ event: eventSummary(getEvent(id)) }, 201)
  })

  r.get('/events/:eventId', (c) => c.json({ event: eventSummary(eventParam(c)) }))

  r.patch('/events/:eventId', async (c) => {
    requireAdmin(c)
    const ev = eventParam(c)
    const body = await jsonBody(c)
    const data = pick(body, eventFields)
    // Cada formulario manda solo su parte de los ajustes: el resto se conserva.
    if (data.settings) data.settings = { ...ev.settings, ...data.settings }
    if (body.regenerateJoinCode) data.joinCode = uniqueCode('events', 'join_code', 6)
    const startsAt = data.startsAt !== undefined ? data.startsAt : ev.startsAt
    const endsAt = data.endsAt !== undefined ? data.endsAt : ev.endsAt
    if (startsAt && endsAt && endsAt <= startsAt) throw badRequest('El fin debe ser posterior al inicio.')
    // Una fecha nueva en el futuro vuelve a armar su disparo (ver schedule.js);
    // una ya pasada no abre ni cierra nada.
    const t = now()
    if (data.startsAt !== undefined && data.startsAt !== ev.startsAt) data.startFiredAt = data.startsAt > t ? null : t
    if (data.endsAt !== undefined && data.endsAt !== ev.endsAt) data.endFiredAt = data.endsAt > t ? null : t
    update('events', ev.id, data, {
      name: ['name'],
      description: ['description'],
      status: ['status'],
      startsAt: ['starts_at'],
      endsAt: ['ends_at'],
      startFiredAt: ['start_fired_at'],
      endFiredAt: ['end_fired_at'],
      levels: ['levels', json],
      settings: ['settings', json],
      joinCode: ['join_code'],
    })
    // Si cambio lo que vale un valor, sus retos (y los puntos ya dados) lo siguen.
    if (body.settings?.pointTiers) {
      const tiers = new Map(data.settings.pointTiers.map((t) => [t.id, t.points]))
      db.tx(() => {
        for (const ch of db.all('SELECT id, tier, points FROM challenges WHERE event_id = :id AND tier IS NOT NULL', { id: ev.id })) {
          if (!tiers.has(ch.tier)) {
            db.run('UPDATE challenges SET tier = NULL WHERE id = :id', { id: ch.id })
          } else if (tiers.get(ch.tier) !== ch.points) {
            db.run('UPDATE challenges SET points = :points WHERE id = :id', { id: ch.id, points: tiers.get(ch.tier) })
            syncAwardedPoints(ch.id, tiers.get(ch.tier))
          }
        }
      })
    }
    return c.json({ event: eventSummary(getEvent(ev.id)) })
  })

  r.delete('/events/:eventId', async (c) => {
    requireAdmin(c)
    const ev = eventParam(c)
    const body = await jsonBody(c)
    if (body.confirm !== ev.slug) throw badRequest(`Escribe «${ev.slug}» para confirmar.`)
    db.run('DELETE FROM events WHERE id = :id', { id: ev.id })
    await storage.removePrefix(`events/${ev.id}`)
    return c.json({ ok: true })
  })

  // Duplicar un evento (para reutilizarlo en el siguiente): copia
  // equipos, retos, badges, niveles y ajustes. No copia participantes ni fotos.
  r.post('/events/:eventId/duplicate', async (c) => {
    requireAdmin(c)
    const src = eventParam(c)
    const body = await jsonBody(c)
    const name = eventFields.name(body.name)
    const slug = slugify(str(body.slug || name, 'slug', { min: 2, max: 40 }))
    if (db.get('SELECT 1 FROM events WHERE slug = :slug', { slug })) throw conflict('Ya existe un evento con ese identificador.')

    const images = []
    const id = db.tx(() => {
      const t = now()
      const eventId = Number(
        db.run(
          `INSERT INTO events (slug, name, description, join_code, levels, settings, created_at)
           VALUES (:slug, :name, :description, :joinCode, :levels, :settings, :t)`,
          {
            slug,
            name,
            description: src.description,
            joinCode: uniqueCode('events', 'join_code', 6),
            levels: json(src.levels),
            settings: json(src.settings),
            t,
          },
        ).lastInsertRowid,
      )
      for (const team of db.all('SELECT * FROM teams WHERE event_id = :id', { id: src.id })) {
        db.run('INSERT INTO teams (event_id, name, short_name) VALUES (:eventId, :name, :shortName)', {
          eventId,
          name: team.name,
          shortName: team.short_name,
        })
      }
      const idMap = new Map()
      const copies = []
      for (const row of db.all('SELECT * FROM challenges WHERE event_id = :id ORDER BY id', { id: src.id })) {
        const imageKey = row.image_key ? `events/${eventId}/challenges/${randomToken(9)}.jpg` : null
        if (imageKey) images.push([row.image_key, imageKey])
        const newId = Number(
          db.run(
            `INSERT INTO challenges (event_id, type, title, description, icon, image_key, points, category, tier,
                status, visibility, unlock_rule, available_from, available_until, max_completions,
                requires_approval, requires_photo, config, qr_code, sort_order, created_at, updated_at)
             SELECT :eventId, type, title, description, icon, :imageKey, points, category, tier,
                'draft', visibility, unlock_rule, NULL, NULL, max_completions,
                requires_approval, requires_photo, config, :qrCode, sort_order, :t, :t
               FROM challenges WHERE id = :srcId`,
            {
              eventId,
              imageKey,
              qrCode: row.qr_code ? uniqueCode('challenges', 'qr_code', 6) : null,
              t,
              srcId: row.id,
            },
          ).lastInsertRowid,
        )
        idMap.set(row.id, newId)
        copies.push({ newId, rule: parseJson(row.unlock_rule, null) })
      }
      // Las reglas de desbloqueo apuntan a ids del evento original.
      for (const { newId, rule } of copies) {
        if (!rule?.afterChallenges?.length) continue
        rule.afterChallenges = rule.afterChallenges.map((x) => idMap.get(x)).filter(Boolean)
        db.run('UPDATE challenges SET unlock_rule = :rule WHERE id = :id', { rule: json(rule), id: newId })
      }
      for (const b of db.all('SELECT * FROM badges WHERE event_id = :id', { id: src.id }).map(toBadge)) {
        const rule = { ...b.rule }
        if (rule.type === 'challenge') rule.challengeId = idMap.get(Number(rule.challengeId)) ?? null
        insertBadge(eventId, { ...b, rule })
      }
      for (const g of db.all('SELECT * FROM team_goals WHERE event_id = :id', { id: src.id }).map(toTeamGoal)) {
        insertTeamGoal(eventId, { ...g, challengeId: idMap.get(g.challengeId) })
      }
      return eventId
    })
    await Promise.all(images.map(([from, to]) => storage.copy(from, to).catch(() => {})))
    return c.json({ event: eventSummary(getEvent(id)) }, 201)
  })

  // --- equipos (Ramas) ---

  const listTeams = (eventId) =>
    db
      .all(
        `SELECT t.*, (SELECT COUNT(*) FROM participants p WHERE p.team_id = t.id) members
           FROM teams t WHERE t.event_id = :eventId ORDER BY t.name COLLATE NOCASE`,
        { eventId },
      )
      .map((t) => ({ id: t.id, name: t.name, shortName: t.short_name, members: t.members }))

  r.get('/events/:eventId/teams', (c) => c.json({ teams: listTeams(eventParam(c).id) }))

  // Acepta varios nombres a la vez (uno por linea en el panel).
  r.post('/events/:eventId/teams', async (c) => {
    requireAdmin(c)
    const ev = eventParam(c)
    const body = await jsonBody(c)
    const names = (Array.isArray(body.names) ? body.names : [body.name])
      .map((n) => (typeof n === 'string' ? n.trim() : ''))
      .filter(Boolean)
    if (!names.length) throw badRequest('Escribe al menos un nombre.')
    db.tx(() => {
      for (const name of names) {
        db.run('INSERT OR IGNORE INTO teams (event_id, name) VALUES (:eventId, :name)', {
          eventId: ev.id,
          name: str(name, 'nombre', { min: 1, max: 80 }),
        })
      }
    })
    return c.json({ teams: listTeams(ev.id) }, 201)
  })

  function teamOf(c) {
    const team = db.get('SELECT * FROM teams WHERE id = :id', { id: int(c.req.param('teamId'), 'teamId') })
    if (!team) throw notFound('Equipo no encontrado.')
    return team
  }

  r.patch('/teams/:teamId', async (c) => {
    requireAdmin(c)
    const team = teamOf(c)
    const data = pick(await jsonBody(c), {
      name: (v) => str(v, 'nombre', { min: 1, max: 80 }),
      shortName: (v) => str(v, 'nombre corto', { max: 20 }),
    })
    try {
      update('teams', team.id, data, { name: ['name'], shortName: ['short_name'] })
    } catch {
      throw conflict('Ya existe un equipo con ese nombre.')
    }
    return c.json({ teams: listTeams(team.event_id) })
  })

  r.delete('/teams/:teamId', (c) => {
    requireAdmin(c)
    const team = teamOf(c)
    db.run('DELETE FROM teams WHERE id = :id', { id: team.id })
    return c.json({ teams: listTeams(team.event_id) })
  })

  // --- retos ---

  function normalizeUnlockRule(v) {
    if (!v || typeof v !== 'object') return null
    const rule = {}
    const after = Array.isArray(v.afterChallenges) ? v.afterChallenges.map(Number).filter(Number.isInteger) : []
    if (after.length) rule.afterChallenges = [...new Set(after)]
    const minXp = Number(v.minXp)
    if (Number.isInteger(minXp) && minXp > 0) rule.minXp = minXp
    return Object.keys(rule).length ? rule : null
  }

  /** Deja en la regla solo retos que existen en el evento (y no el propio). */
  function ownUnlockRule(rule, eventId, selfId) {
    if (!rule?.afterChallenges) return rule
    const ids = new Set(db.all('SELECT id FROM challenges WHERE event_id = :eventId', { eventId }).map((r) => r.id))
    return normalizeUnlockRule({ ...rule, afterChallenges: rule.afterChallenges.filter((id) => ids.has(id) && id !== selfId) })
  }

  const challengeFields = {
    type: (v) => oneOf(v, 'tipo', CHALLENGE_TYPES),
    title: (v) => str(v, 'título', { min: 2, max: 80 }),
    description: (v) => str(v, 'descripción', { max: 1000 }),
    icon: (v) => str(v, 'icono', { max: 16 }),
    points: (v) => int(v, 'puntos', { min: 0, max: 10000 }),
    category: (v) => str(v, 'categoría', { max: 40 }),
    tier: (v) => (v == null || v === '' ? null : str(v, 'valor', { max: 12 })),
    status: (v) => oneOf(v, 'estado', ['draft', 'active', 'inactive']),
    visibility: (v) => oneOf(v, 'visibilidad', ['visible', 'secret']),
    unlockRule: normalizeUnlockRule,
    availableFrom: (v) => isoDate(v, 'disponible desde'),
    availableUntil: (v) => isoDate(v, 'disponible hasta'),
    maxCompletions: (v) => int(v, 'límite de participantes', { min: 1, max: 100000, required: false }),
    requiresApproval: (v) => !!v,
    requiresPhoto: (v) => !!v,
    config: (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
    sortOrder: (v) => int(v, 'orden', { min: 0, max: 100000 }),
  }

  const challengeColumns = {
    type: ['type'],
    title: ['title'],
    description: ['description'],
    icon: ['icon'],
    points: ['points'],
    category: ['category'],
    tier: ['tier'],
    status: ['status'],
    visibility: ['visibility'],
    unlockRule: ['unlock_rule', json],
    availableFrom: ['available_from'],
    availableUntil: ['available_until'],
    maxCompletions: ['max_completions'],
    requiresApproval: ['requires_approval', Number],
    requiresPhoto: ['requires_photo', Number],
    config: ['config', json],
    qrCode: ['qr_code'],
    sortOrder: ['sort_order'],
    updatedAt: ['updated_at'],
  }

  /**
   * Reglas por tipo. PHOTO/AR llevan foto y siempre pasan por un moderador
   * (es lo que impide sumar puntos con cualquier imagen). Un QR no lleva
   * foto y se aprueba solo: escanearlo ya es la prueba.
   */
  function applyTypeRules(data, type) {
    if (type === 'PHOTO' || type === 'AR') {
      data.requiresPhoto = true
      data.requiresApproval = true
    }
    // Checkpoints y encuestas no llevan foto y se aprueban solos.
    if (type === 'QR' || type === 'TRIVIA') {
      data.requiresPhoto = false
      data.requiresApproval = false
    }
    if (data.availableFrom && data.availableUntil && data.availableFrom > data.availableUntil) {
      throw badRequest('«Disponible hasta» debe ser posterior a «disponible desde».')
    }
  }

  /** Con un valor elegido, los puntos del reto son los de ese valor. */
  function applyTier(data, ev) {
    if (!data.tier) return
    const tier = ev.settings.pointTiers.find((t) => t.id === data.tier)
    if (!tier) throw badRequest('Ese valor de reto no existe en este evento.')
    data.points = tier.points
  }

  // Los checkpoints y las encuestas tienen un QR propio.
  const hasQr = (type) => type === 'QR' || type === 'TRIVIA'

  /**
   * Preguntas de una encuesta. Con respuestas ya recibidas no se pueden
   * cambiar: las respuestas guardadas dejarian de corresponder.
   */
  function applySurvey(data, body, type, ch) {
    if (type !== 'TRIVIA') return
    if (body.config === undefined && ch?.config.survey) return
    const survey = normalizeSurvey(body.config?.survey)
    // Si ya hay respuestas solo se puede cambiar si exige el QR.
    const same = (s) => JSON.stringify({ ...s, qrOnly: false })
    if (ch?.config.survey && same(survey) !== same(ch.config.survey)) {
      const answered = db.get('SELECT COUNT(*) n FROM submissions WHERE challenge_id = :id', { id: ch.id }).n
      if (answered) {
        throw conflict('Esta encuesta ya tiene respuestas: no se pueden cambiar sus preguntas. Crea otra encuesta.', 'survey_locked')
      }
    }
    data.config = { survey }
  }

  r.get('/events/:eventId/challenges', (c) => {
    const ev = eventParam(c)
    const list = db
      .all('SELECT * FROM challenges WHERE event_id = :id ORDER BY sort_order, id', { id: ev.id })
      .map(toChallenge)
      .map(adminChallenge)
    return c.json({ challenges: list })
  })

  r.post('/events/:eventId/challenges', async (c) => {
    const ev = eventParam(c)
    const body = await jsonBody(c)
    const data = pick(body, challengeFields)
    if (!data.type) throw badRequest('Falta «tipo»')
    if (!data.title) throw badRequest('Falta «título»')
    applyTypeRules(data, data.type)
    applyTier(data, ev)
    applySurvey(data, body, data.type, null)
    if (data.unlockRule) data.unlockRule = ownUnlockRule(data.unlockRule, ev.id, null)
    const t = now()
    const id = Number(
      db.run(
        `INSERT INTO challenges (event_id, type, title, qr_code, sort_order, created_at, updated_at)
         VALUES (:eventId, :type, :title, :qrCode,
                 (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM challenges WHERE event_id = :eventId), :t, :t)`,
        {
          eventId: ev.id,
          type: data.type,
          title: data.title,
          qrCode: hasQr(data.type) ? uniqueCode('challenges', 'qr_code', 6) : null,
          t,
        },
      ).lastInsertRowid,
    )
    update('challenges', id, data, challengeColumns)
    return c.json({ challenge: adminChallenge(getChallenge(id)) }, 201)
  })

  r.get('/challenges/:id', (c) => c.json({ challenge: adminChallenge(getChallenge(int(c.req.param('id'), 'id'))) }))

  r.patch('/challenges/:id', async (c) => {
    const ch = getChallenge(int(c.req.param('id'), 'id'))
    const body = await jsonBody(c)
    const data = pick(body, challengeFields)
    const type = data.type ?? ch.type
    applyTypeRules(data, type)
    applyTier(data, getEvent(ch.eventId))
    applySurvey(data, body, type, ch)
    if (data.unlockRule) data.unlockRule = ownUnlockRule(data.unlockRule, ch.eventId, ch.id)
    if (hasQr(type) && !ch.qrCode) data.qrCode = uniqueCode('challenges', 'qr_code', 6)
    data.updatedAt = now()
    update('challenges', ch.id, data, challengeColumns)
    if (data.points !== undefined && data.points !== ch.points) syncAwardedPoints(ch.id, data.points)
    return c.json({ challenge: adminChallenge(getChallenge(ch.id)) })
  })

  // Un QR fotografiado y compartido se invalida generando otro.
  r.post('/challenges/:id/regenerate-qr', (c) => {
    const ch = getChallenge(int(c.req.param('id'), 'id'))
    if (!hasQr(ch.type)) throw badRequest('Este reto no tiene código QR.')
    update('challenges', ch.id, { qrCode: uniqueCode('challenges', 'qr_code', 6), updatedAt: now() }, challengeColumns)
    return c.json({ challenge: adminChallenge(getChallenge(ch.id)) })
  })

  // Resultados de una encuesta: totales por pregunta y lo que respondio cada persona.
  r.get('/challenges/:id/survey-results', (c) => {
    const ch = getChallenge(int(c.req.param('id'), 'id'))
    const survey = ch.type === 'TRIVIA' && ch.config.survey
    if (!survey) throw badRequest('Este reto no es una encuesta.')
    const responses = db
      .all(
        `SELECT s.id, s.answer, s.points_awarded, s.created_at, p.alias, t.name AS team
           FROM submissions s
           JOIN participants p ON p.id = s.participant_id
           LEFT JOIN teams t ON t.id = p.team_id
          WHERE s.challenge_id = :id AND s.status = 'approved'
          ORDER BY s.id`,
        { id: ch.id },
      )
      .map((s) => {
        const saved = parseJson(s.answer, { answers: {}, correct: 0 })
        return {
          id: s.id,
          alias: s.alias,
          team: s.team,
          createdAt: s.created_at,
          pointsAwarded: s.points_awarded,
          correct: saved.correct,
          answers: saved.answers,
        }
      })
    return c.json({
      challenge: { id: ch.id, title: ch.title, icon: ch.icon, points: ch.points },
      survey,
      summary: summarize(survey, responses),
      responses,
    })
  })

  r.post('/events/:eventId/challenges/reorder', async (c) => {
    const ev = eventParam(c)
    const { ids } = await jsonBody(c)
    if (!Array.isArray(ids)) throw badRequest('Falta el orden.')
    db.tx(() =>
      ids.forEach((id, i) =>
        db.run('UPDATE challenges SET sort_order = :i WHERE id = :id AND event_id = :eventId', {
          i: i + 1,
          id: Number(id),
          eventId: ev.id,
        }),
      ),
    )
    return c.json({ ok: true })
  })

  r.delete('/challenges/:id', async (c) => {
    requireAdmin(c)
    const ch = getChallenge(int(c.req.param('id'), 'id'))
    const files = db.all(
      `SELECT ph.key, ph.thumb_key FROM photos ph JOIN submissions s ON s.id = ph.submission_id
        WHERE s.challenge_id = :id`,
      { id: ch.id },
    )
    db.tx(() => {
      db.run('DELETE FROM challenges WHERE id = :id', { id: ch.id })
      // Ningun otro reto debe seguir pidiendo el que se borro.
      for (const row of db.all('SELECT id, unlock_rule FROM challenges WHERE event_id = :eventId AND unlock_rule IS NOT NULL', {
        eventId: ch.eventId,
      })) {
        const rule = parseJson(row.unlock_rule, null)
        if (!rule?.afterChallenges?.includes(ch.id)) continue
        db.run('UPDATE challenges SET unlock_rule = :rule WHERE id = :id', {
          rule: json(ownUnlockRule(rule, ch.eventId, row.id)),
          id: row.id,
        })
      }
    })
    await storage.remove(ch.imageKey, ...files.flatMap((f) => [f.key, f.thumb_key]))
    return c.json({ ok: true })
  })

  r.post('/challenges/:id/image', bodyLimit({ maxSize: 3 * 1024 * 1024 }), async (c) => {
    const ch = getChallenge(int(c.req.param('id'), 'id'))
    const body = await c.req.parseBody()
    const buf = await readJpeg(body.image, 'image', 2 * 1024 * 1024)
    const key = `events/${ch.eventId}/challenges/${randomToken(9)}.jpg`
    await storage.put(key, buf)
    update('challenges', ch.id, { imageKey: key, updatedAt: now() }, { ...challengeColumns, imageKey: ['image_key'] })
    await storage.remove(ch.imageKey)
    return c.json({ challenge: adminChallenge(getChallenge(ch.id)) })
  })

  r.delete('/challenges/:id/image', async (c) => {
    const ch = getChallenge(int(c.req.param('id'), 'id'))
    db.run('UPDATE challenges SET image_key = NULL WHERE id = :id', { id: ch.id })
    await storage.remove(ch.imageKey)
    return c.json({ challenge: adminChallenge(getChallenge(ch.id)) })
  })

  // --- badges ---

  const badgeFields = {
    name: (v) => str(v, 'nombre', { min: 2, max: 40 }),
    icon: (v) => str(v, 'icono', { min: 1, max: 16 }),
    description: (v) => str(v, 'descripción', { max: 200 }),
    rule: (v) => {
      if (!v || typeof v !== 'object') throw badRequest('Falta la regla del badge.')
      const type = oneOf(v.type, 'regla', BADGE_RULES)
      const rule = { type }
      if (['count', 'xp', 'category', 'challengeType'].includes(type)) rule.n = int(v.n, 'cantidad', { min: 1, max: 100000 })
      if (type === 'category') rule.category = str(v.category, 'categoría', { min: 1, max: 40 })
      if (type === 'challengeType' || type === 'allOfType') rule.challengeType = oneOf(v.challengeType, 'tipo', CHALLENGE_TYPES)
      if (type === 'challenge') rule.challengeId = int(v.challengeId, 'reto', { min: 1 })
      return rule
    },
    sortOrder: (v) => int(v, 'orden', { min: 0, max: 100000 }),
  }

  function insertBadge(eventId, b) {
    db.run(
      `INSERT INTO badges (event_id, name, icon, description, rule, sort_order)
       VALUES (:eventId, :name, :icon, :description, :rule, :sortOrder)`,
      { eventId, name: b.name, icon: b.icon, description: b.description ?? '', rule: json(b.rule), sortOrder: b.sortOrder ?? 0 },
    )
  }

  const listBadges = (eventId) =>
    db.all('SELECT * FROM badges WHERE event_id = :eventId ORDER BY sort_order, id', { eventId }).map(toBadge)

  r.get('/events/:eventId/badges', (c) => c.json({ badges: listBadges(eventParam(c).id) }))

  r.post('/events/:eventId/badges', async (c) => {
    requireAdmin(c)
    const ev = eventParam(c)
    const data = pick(await jsonBody(c), badgeFields)
    if (!data.name || !data.rule) throw badRequest('Faltan el nombre o la regla.')
    insertBadge(ev.id, { icon: '🏅', ...data })
    return c.json({ badges: listBadges(ev.id) }, 201)
  })

  function badgeOf(c) {
    const b = db.get('SELECT * FROM badges WHERE id = :id', { id: int(c.req.param('id'), 'id') })
    if (!b) throw notFound('Badge no encontrado.')
    return b
  }

  r.patch('/badges/:id', async (c) => {
    requireAdmin(c)
    const b = badgeOf(c)
    const data = pick(await jsonBody(c), badgeFields)
    update('badges', b.id, data, {
      name: ['name'],
      icon: ['icon'],
      description: ['description'],
      rule: ['rule', json],
      sortOrder: ['sort_order'],
    })
    return c.json({ badges: listBadges(b.event_id) })
  })

  r.delete('/badges/:id', (c) => {
    requireAdmin(c)
    const b = badgeOf(c)
    db.run('DELETE FROM badges WHERE id = :id', { id: b.id })
    return c.json({ badges: listBadges(b.event_id) })
  })

  // --- avisos a los participantes ---
  // Les llegan con el sondeo de retos, como el aviso de "nuevo reto".

  const listAnnouncements = (eventId) =>
    db
      .all(
        `SELECT n.id, n.text, n.created_at, a.name AS author
           FROM announcements n LEFT JOIN admins a ON a.id = n.created_by
          WHERE n.event_id = :eventId ORDER BY n.id DESC LIMIT 20`,
        { eventId },
      )
      .map((n) => ({ id: n.id, text: n.text, createdAt: n.created_at, author: n.author }))

  r.get('/events/:eventId/announcements', (c) => c.json({ announcements: listAnnouncements(eventParam(c).id) }))

  r.post('/events/:eventId/announcements', async (c) => {
    const ev = eventParam(c)
    const body = await jsonBody(c)
    db.run('INSERT INTO announcements (event_id, text, created_by, created_at) VALUES (:eventId, :text, :by, :t)', {
      eventId: ev.id,
      text: str(body.text, 'aviso', { min: 2, max: 200 }),
      by: c.get('admin').id,
      t: now(),
    })
    return c.json({ announcements: listAnnouncements(ev.id) }, 201)
  })

  r.delete('/announcements/:id', (c) => {
    const n = db.get('SELECT * FROM announcements WHERE id = :id', { id: int(c.req.param('id'), 'id') })
    if (!n) throw notFound('Aviso no encontrado.')
    db.run('DELETE FROM announcements WHERE id = :id', { id: n.id })
    return c.json({ announcements: listAnnouncements(n.event_id) })
  })

  // --- retos de Rama (puntos colectivos) ---

  /** El reto tiene que ser de este evento. */
  function goalChallenge(eventId, v) {
    const id = int(v, 'reto', { min: 1 })
    if (!db.get('SELECT 1 FROM challenges WHERE id = :id AND event_id = :eventId', { id, eventId })) {
      throw badRequest('Ese reto no es de este evento.')
    }
    return id
  }

  const teamGoalFields = {
    name: (v) => str(v, 'nombre', { min: 2, max: 60 }),
    icon: (v) => str(v, 'icono', { min: 1, max: 16 }),
    description: (v) => str(v, 'descripción', { max: 200 }),
    points: (v) => int(v, 'valor', { min: 1, max: 1000 }),
    members: (v) => int(v, 'integrantes', { min: 1, max: TEAM_GOAL_MAX_MEMBERS }),
    sortOrder: (v) => int(v, 'orden', { min: 0, max: 100000 }),
  }

  function insertTeamGoal(eventId, g) {
    db.run(
      `INSERT INTO team_goals (event_id, name, icon, description, points, challenge_id, members, sort_order)
       VALUES (:eventId, :name, :icon, :description, :points, :challengeId, :members, :sortOrder)`,
      {
        eventId,
        name: g.name,
        icon: g.icon ?? '🤝',
        description: g.description ?? '',
        points: g.points ?? 10,
        challengeId: g.challengeId,
        members: g.members ?? 3,
        sortOrder: g.sortOrder ?? 0,
      },
    )
  }

  const listTeamGoals = (eventId) =>
    db.all('SELECT * FROM team_goals WHERE event_id = :eventId ORDER BY sort_order, id', { eventId }).map(toTeamGoal)

  r.get('/events/:eventId/team-goals', (c) => c.json({ goals: listTeamGoals(eventParam(c).id) }))

  r.post('/events/:eventId/team-goals', async (c) => {
    requireAdmin(c)
    const ev = eventParam(c)
    const body = await jsonBody(c)
    const data = pick(body, teamGoalFields)
    if (!data.name) throw badRequest('Falta el nombre.')
    insertTeamGoal(ev.id, { ...data, challengeId: goalChallenge(ev.id, body.challengeId) })
    return c.json({ goals: listTeamGoals(ev.id) }, 201)
  })

  function teamGoalOf(c) {
    const g = db.get('SELECT * FROM team_goals WHERE id = :id', { id: int(c.req.param('id'), 'id') })
    if (!g) throw notFound('Reto de equipo no encontrado.')
    return g
  }

  r.patch('/team-goals/:id', async (c) => {
    requireAdmin(c)
    const g = teamGoalOf(c)
    const body = await jsonBody(c)
    const data = pick(body, teamGoalFields)
    if (body.challengeId !== undefined) data.challengeId = goalChallenge(g.event_id, body.challengeId)
    update('team_goals', g.id, data, {
      name: ['name'],
      icon: ['icon'],
      description: ['description'],
      points: ['points'],
      members: ['members'],
      challengeId: ['challenge_id'],
      sortOrder: ['sort_order'],
    })
    return c.json({ goals: listTeamGoals(g.event_id) })
  })

  r.delete('/team-goals/:id', (c) => {
    requireAdmin(c)
    const g = teamGoalOf(c)
    db.run('DELETE FROM team_goals WHERE id = :id', { id: g.id })
    return c.json({ goals: listTeamGoals(g.event_id) })
  })

  // --- envios y moderacion ---

  const SUBMISSION_SELECT = `
    SELECT s.*, c.title AS challenge_title, c.icon AS challenge_icon, c.type AS challenge_type,
           c.points AS challenge_points, pa.alias, pa.team_id, t.name AS team_name,
           ph.id AS photo_id, ph.key, ph.thumb_key, ph.width, ph.height, ph.captured_with,
           a.name AS reviewer_name,
           (SELECT COUNT(*) FROM likes l WHERE l.photo_id = ph.id) AS likes
      FROM submissions s
      JOIN challenges c ON c.id = s.challenge_id
      JOIN participants pa ON pa.id = s.participant_id
      LEFT JOIN teams t ON t.id = pa.team_id
      LEFT JOIN photos ph ON ph.submission_id = s.id
      LEFT JOIN admins a ON a.id = s.reviewed_by`

  function submissionItem(s) {
    return {
      id: s.id,
      status: s.status,
      pointsAwarded: s.points_awarded,
      rejectReason: s.reject_reason,
      createdAt: s.created_at,
      reviewedAt: s.reviewed_at,
      reviewer: s.reviewer_name,
      challenge: { id: s.challenge_id, title: s.challenge_title, icon: s.challenge_icon, type: s.challenge_type, points: s.challenge_points },
      participant: { id: s.participant_id, alias: s.alias, team: s.team_name },
      photo: s.key
        ? {
            id: s.photo_id,
            url: mediaUrl(s.key),
            thumbUrl: mediaUrl(s.thumb_key),
            downloadUrl: mediaUrl(s.key, { download: true }),
            width: s.width,
            height: s.height,
            capturedWith: s.captured_with,
            likes: s.likes,
          }
        : null,
    }
  }

  const getSubmission = (id) => {
    const s = db.get(`${SUBMISSION_SELECT} WHERE s.id = :id`, { id })
    if (!s) throw notFound('Envío no encontrado.')
    return s
  }

  const pendingCount = (eventId) =>
    db.get(`SELECT COUNT(*) n FROM submissions WHERE event_id = :eventId AND status = 'pending'`, { eventId }).n

  // Lista filtrable. Pendientes: las mas antiguas primero (cola de moderacion).
  r.get('/events/:eventId/submissions', (c) => {
    const ev = eventParam(c)
    const q = c.req.query()
    const params = {
      eventId: ev.id,
      status: q.status ? oneOf(q.status, 'estado', ['pending', 'approved', 'rejected']) : null,
      challengeId: int(q.challengeId, 'challengeId', { min: 1, required: false }),
      teamId: int(q.teamId, 'teamId', { min: 1, required: false }),
      participantId: int(q.participantId, 'participantId', { min: 1, required: false }),
      cursor: int(q.cursor, 'cursor', { min: 1, required: false }),
      limit: int(q.limit, 'limit', { min: 1, max: 100, required: false }) ?? 40,
      onlyPhotos: q.photos === '1',
    }
    const oldestFirst = params.status === 'pending'
    const where = ['s.event_id = :eventId']
    if (params.status) where.push('s.status = :status')
    if (params.challengeId) where.push('s.challenge_id = :challengeId')
    if (params.teamId) where.push('pa.team_id = :teamId')
    if (params.participantId) where.push('s.participant_id = :participantId')
    if (params.onlyPhotos) where.push('ph.id IS NOT NULL')
    if (params.cursor) where.push(oldestFirst ? 's.id > :cursor' : 's.id < :cursor')
    const rows = db.all(
      `${SUBMISSION_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.id ${oldestFirst ? 'ASC' : 'DESC'} LIMIT :limit`,
      params,
    )
    return c.json({
      items: rows.map(submissionItem),
      nextCursor: rows.length === params.limit ? rows.at(-1).id : null,
      pending: pendingCount(ev.id),
    })
  })

  // Aprobar o rechazar. Se puede cambiar una decision anterior: el XP se
  // recalcula solo porque se deriva de las submissions aprobadas.
  r.post('/submissions/:id/review', async (c) => {
    const s = getSubmission(int(c.req.param('id'), 'id'))
    const body = await jsonBody(c)
    const decision = oneOf(body.decision, 'decisión', ['approve', 'reject'])
    const approve = decision === 'approve'
    // Los puntos son siempre los del reto: al moderar no se cambian.
    const points = approve ? s.challenge_points : 0
    db.run(
      `UPDATE submissions
          SET status = :status, points_awarded = :points, reject_reason = :reason,
              reviewed_by = :adminId, reviewed_at = :t
        WHERE id = :id`,
      {
        id: s.id,
        status: approve ? 'approved' : 'rejected',
        points,
        reason: approve ? null : str(body.reason, 'motivo', { max: 200, required: false }),
        adminId: c.get('admin').id,
        t: now(),
      },
    )
    return c.json({ submission: submissionItem(getSubmission(s.id)), pending: pendingCount(s.event_id) })
  })

  r.delete('/submissions/:id', async (c) => {
    const s = getSubmission(int(c.req.param('id'), 'id'))
    db.run('DELETE FROM submissions WHERE id = :id', { id: s.id })
    await storage.remove(s.key, s.thumb_key)
    return c.json({ ok: true, pending: pendingCount(s.event_id) })
  })

  // --- participantes ---

  r.get('/events/:eventId/participants', (c) => {
    const ev = eventParam(c)
    const rows = db.all(
      `SELECT p.*, t.name AS team_name,
              COALESCE(SUM(CASE WHEN s.status = 'approved' THEN s.points_awarded END), 0) AS xp,
              COALESCE(SUM(s.status = 'approved'), 0) AS completed,
              COALESCE(SUM(s.status = 'pending'), 0) AS pending,
              COALESCE(SUM(s.status = 'rejected'), 0) AS rejected
         FROM participants p
         LEFT JOIN teams t ON t.id = p.team_id
         LEFT JOIN submissions s ON s.participant_id = p.id
        WHERE p.event_id = :eventId
        GROUP BY p.id
        ORDER BY xp DESC, p.alias COLLATE NOCASE`,
      { eventId: ev.id },
    )
    return c.json({
      participants: rows.map((p) => ({
        id: p.id,
        alias: p.alias,
        team: p.team_id ? { id: p.team_id, name: p.team_name } : null,
        xp: p.xp,
        completed: p.completed,
        pending: p.pending,
        rejected: p.rejected,
        banned: !!p.banned,
        recoveryCode: formatRecovery(p.recovery_code),
        createdAt: p.created_at,
      })),
    })
  })

  r.patch('/participants/:id', async (c) => {
    const p = db.get('SELECT * FROM participants WHERE id = :id', { id: int(c.req.param('id'), 'id') })
    if (!p) throw notFound('Participante no encontrado.')
    const body = await jsonBody(c)
    const data = pick(body, {
      alias: (v) => str(v, 'nombre', { min: 2, max: 24 }).replace(/\s+/g, ' '),
      teamId: (v) => {
        const id = int(v, 'equipo', { required: false })
        if (id && !db.get('SELECT 1 FROM teams WHERE id = :id AND event_id = :eventId', { id, eventId: p.event_id })) {
          throw badRequest('Equipo inválido.')
        }
        return id
      },
      banned: (v) => !!v,
    })
    if (data.alias) {
      data.aliasKey = data.alias.toLowerCase()
      const taken = db.get(
        'SELECT 1 FROM participants WHERE event_id = :eventId AND alias_key = :aliasKey AND id != :id',
        { eventId: p.event_id, aliasKey: data.aliasKey, id: p.id },
      )
      if (taken) throw conflict('Ese nombre ya está en uso.')
    }
    update('participants', p.id, data, {
      alias: ['alias'],
      aliasKey: ['alias_key'],
      teamId: ['team_id'],
      banned: ['banned', Number],
    })
    return c.json({ ok: true })
  })

  // Codigo de recuperacion nuevo (el anterior deja de servir). La sesion que
  // la persona ya tiene abierta en su telefono sigue funcionando.
  r.post('/participants/:id/recovery-code', (c) => {
    const p = db.get('SELECT * FROM participants WHERE id = :id', { id: int(c.req.param('id'), 'id') })
    if (!p) throw notFound('Participante no encontrado.')
    let code
    do {
      code = recoveryCode()
    } while (db.get('SELECT 1 FROM participants WHERE event_id = :eventId AND recovery_code = :code', { eventId: p.event_id, code }))
    db.run('UPDATE participants SET recovery_code = :code WHERE id = :id', { code, id: p.id })
    return c.json({ recoveryCode: formatRecovery(code) })
  })

  // --- ranking y estadisticas ---

  r.get('/events/:eventId/ranking', (c) => {
    const ev = eventParam(c)
    return c.json({ participants: participantRanking(db, ev.id), teams: teamRanking(db, ev) })
  })

  r.get('/events/:eventId/stats', (c) => {
    const ev = eventParam(c)
    const p = { eventId: ev.id }
    const totals = db.get(
      `SELECT
         (SELECT COUNT(*) FROM participants WHERE event_id = :eventId) participants,
         (SELECT COUNT(DISTINCT participant_id) FROM submissions WHERE event_id = :eventId) active,
         (SELECT COUNT(*) FROM submissions WHERE event_id = :eventId AND status = 'pending') pending,
         (SELECT COUNT(*) FROM submissions WHERE event_id = :eventId AND status = 'approved') approved,
         (SELECT COUNT(*) FROM submissions WHERE event_id = :eventId AND status = 'rejected') rejected,
         (SELECT COUNT(*) FROM photos WHERE event_id = :eventId) photos,
         (SELECT COALESCE(SUM(bytes), 0) FROM photos WHERE event_id = :eventId) bytes,
         (SELECT COUNT(*) FROM likes l JOIN photos ph ON ph.id = l.photo_id WHERE ph.event_id = :eventId) likes`,
      p,
    )
    const byChallenge = db.all(
      `SELECT c.id, c.title, c.icon, c.type, c.status,
              COALESCE(SUM(s.status = 'approved'), 0) approved,
              COALESCE(SUM(s.status = 'pending'), 0) pending,
              COALESCE(SUM(s.status = 'rejected'), 0) rejected
         FROM challenges c LEFT JOIN submissions s ON s.challenge_id = c.id
        WHERE c.event_id = :eventId GROUP BY c.id ORDER BY c.sort_order, c.id`,
      p,
    )
    // Envios por hora (hora UTC; el panel la muestra en hora local).
    const byHour = db.all(
      `SELECT substr(created_at, 1, 13) || ':00:00Z' AS hour, COUNT(*) n
         FROM submissions WHERE event_id = :eventId GROUP BY hour ORDER BY hour`,
      p,
    )
    return c.json({ totals, byChallenge, byTeam: teamRanking(db, ev), byHour })
  })

  // --- exportacion ---

  function exportPayload(eventId, status, challengeId, teamId, exp) {
    return `export:${eventId}:${status || 'approved'}:${challengeId || ''}:${teamId || ''}:${exp}`
  }

  function exportRows(eventId, q) {
    const params = {
      eventId,
      challengeId: Number(q.challengeId) || null,
      teamId: Number(q.teamId) || null,
    }
    const where = ['ph.event_id = :eventId']
    if ((q.status || 'approved') === 'approved') where.push(`s.status = 'approved'`)
    if (params.challengeId) where.push('s.challenge_id = :challengeId')
    if (params.teamId) where.push('pa.team_id = :teamId')
    return db.all(
      `SELECT ph.id, ph.key, ph.created_at, s.challenge_id, c.title AS challenge_title, pa.alias, t.name AS team_name
         FROM photos ph
         JOIN submissions s ON s.id = ph.submission_id
         JOIN challenges c ON c.id = s.challenge_id
         JOIN participants pa ON pa.id = s.participant_id
         LEFT JOIN teams t ON t.id = pa.team_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.sort_order, ph.id`,
      params,
    )
  }

  // Devuelve una URL firmada valida 15 minutos para descargar el ZIP.
  r.post('/events/:eventId/export', async (c) => {
    const ev = eventParam(c)
    const body = await jsonBody(c)
    const status = body.status === 'all' ? 'all' : 'approved'
    const challengeId = Number(body.challengeId) || ''
    const teamId = Number(body.teamId) || ''
    const count = exportRows(ev.id, { status, challengeId, teamId }).length
    const exp = Math.floor(Date.now() / 1000) + 15 * 60
    const sig = sign(config.secret, exportPayload(ev.id, status, challengeId, teamId, exp))
    const qs = new URLSearchParams({ status, challengeId, teamId, exp, sig })
    return c.json({ url: `admin/export/${ev.id}.zip?${qs}`, count })
  })

  // --- usuarios del panel ---

  function publicAdmin(a) {
    return { id: a.id, username: a.username, name: a.name, role: roleOf(a), active: !!a.active }
  }

  /** Como se guarda un rol: la columna `role` solo admite admin/moderator. */
  const roleColumns = (role) => ({ role: role === 'admin' ? 'admin' : 'moderator', staffRole: role === 'admin' || role === 'moderator' ? null : role })

  r.get('/users', (c) => {
    requireAdmin(c)
    return c.json({ users: db.all('SELECT * FROM admins ORDER BY name COLLATE NOCASE').map(publicAdmin) })
  })

  r.post('/users', async (c) => {
    requireAdmin(c)
    const body = await jsonBody(c)
    const username = str(body.username, 'usuario', { min: 3, max: 32 }).toLowerCase()
    if (!/^[a-z0-9._-]+$/.test(username)) throw badRequest('El usuario solo puede tener letras, números, punto y guion.')
    const password = str(body.password, 'contraseña', { min: 8, max: 200 })
    if (db.get('SELECT 1 FROM admins WHERE username = :username', { username })) throw conflict('Ese usuario ya existe.')
    const id = Number(
      db.run(
        `INSERT INTO admins (username, name, password_hash, role, staff_role, created_at)
         VALUES (:username, :name, :hash, :role, :staffRole, :t)`,
        {
          username,
          name: str(body.name, 'nombre', { min: 2, max: 60 }),
          hash: await hashPassword(password),
          ...roleColumns(oneOf(body.role ?? 'moderator', 'rol', ROLES)),
          t: now(),
        },
      ).lastInsertRowid,
    )
    return c.json({ user: publicAdmin(db.get('SELECT * FROM admins WHERE id = :id', { id })) }, 201)
  })

  r.patch('/users/:id', async (c) => {
    requireAdmin(c)
    const target = db.get('SELECT * FROM admins WHERE id = :id', { id: int(c.req.param('id'), 'id') })
    if (!target) throw notFound('Usuario no encontrado.')
    const body = await jsonBody(c)
    const data = pick(body, {
      name: (v) => str(v, 'nombre', { min: 2, max: 60 }),
      role: (v) => oneOf(v, 'rol', ROLES),
      active: (v) => !!v,
    })
    const selfDemotion = data.role && data.role !== 'admin'
    if (data.role) Object.assign(data, roleColumns(data.role))
    if (body.password) data.passwordHash = await hashPassword(str(body.password, 'contraseña', { min: 8, max: 200 }))
    if (target.id === c.get('admin').id && (selfDemotion || data.active === false)) {
      throw badRequest('No puedes quitarte a ti mismo el rol de administrador.')
    }
    update('admins', target.id, data, {
      name: ['name'],
      role: ['role'],
      staffRole: ['staff_role'],
      active: ['active', Number],
      passwordHash: ['password_hash'],
    })
    if (data.passwordHash || data.active === false) {
      db.run('DELETE FROM admin_sessions WHERE admin_id = :id', { id: target.id })
    }
    return c.json({ user: publicAdmin(db.get('SELECT * FROM admins WHERE id = :id', { id: target.id })) })
  })

  return r
}

