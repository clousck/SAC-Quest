import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { normalizeCode, randomToken, recoveryCode, sha256 } from '../auth.js'
import { now } from '../db.js'
import {
  PHOTO_TYPES,
  badgesFor,
  canSubmit,
  challengeState,
  levelFor,
  participantRanking,
  participantStats,
  teamRanking,
  toChallenge,
  toEvent,
  usedSlots,
} from '../rules.js'
import { gradableCount, gradeSurvey, publicQuestions } from '../survey.js'
import {
  HttpError,
  badRequest,
  bearer,
  clientIp,
  conflict,
  forbidden,
  int,
  jsonBody,
  notFound,
  str,
} from '../util.js'

const STATE_ERRORS = {
  approved: ['Ya completaste este reto.', 'already_done'],
  pending: ['Tu foto de este reto está en revisión.', 'already_pending'],
  locked: ['Este reto aún está bloqueado.', 'locked'],
  upcoming: ['Este reto todavía no está disponible.', 'upcoming'],
  expired: ['Este reto ya cerró.', 'expired'],
  full: ['Este reto ya alcanzó su límite de participantes.', 'full'],
  closed: ['El evento terminó.', 'event_closed'],
}

export const formatRecovery = (code) => `${code.slice(0, 4)}-${code.slice(4)}`

/** Rutas de participantes: /api/join-codes, /api/events/:slug/... */
export function participantRoutes(svc) {
  const { db, storage, config, limit, mediaUrl, readJpeg } = svc
  const r = new Hono()

  // --- helpers ---

  function eventBySlug(slug) {
    const ev = toEvent(db.get('SELECT * FROM events WHERE slug = :slug', { slug }))
    if (!ev || ev.status === 'draft') throw notFound('Este evento no existe o aún no abre.')
    return ev
  }

  function authenticate(c, ev) {
    const token = bearer(c)
    const row =
      token &&
      db.get('SELECT * FROM participants WHERE token_hash = :hash AND event_id = :eventId', {
        hash: sha256(token),
        eventId: ev.id,
      })
    if (!row) throw new HttpError(401, 'unauthenticated', 'Entra al evento para continuar.')
    if (row.banned) throw forbidden('Tu cuenta fue suspendida por los organizadores.', 'banned')
    return row
  }

  const requireOpen = (ev) => {
    if (ev.status !== 'open') throw forbidden('El evento terminó: ya no se reciben retos.', 'event_closed')
  }

  const publicEvent = (ev) => ({
    slug: ev.slug,
    name: ev.name,
    description: ev.description,
    status: ev.status,
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    levels: ev.levels,
    settings: ev.settings,
  })

  const teamsOf = (ev) =>
    db
      .all('SELECT id, name, short_name FROM teams WHERE event_id = :eventId ORDER BY name COLLATE NOCASE', {
        eventId: ev.id,
      })
      .map((t) => ({ id: t.id, name: t.name, shortName: t.short_name }))

  function me(ev, row) {
    const stats = participantStats(db, row.id)
    const ranking = participantRanking(db, ev.id)
    const team = row.team_id && db.get('SELECT id, name, short_name FROM teams WHERE id = :id', { id: row.team_id })
    return {
      id: row.id,
      alias: row.alias,
      team: team ? { id: team.id, name: team.name, shortName: team.short_name } : null,
      recoveryCode: formatRecovery(row.recovery_code),
      xp: stats.xp,
      completed: stats.completed,
      pending: stats.pending,
      rank: ranking.find((x) => x.id === row.id)?.rank ?? null,
      totalParticipants: ranking.length,
      level: levelFor(ev.levels, stats.xp),
      badges: badgesFor(db, ev.id, stats),
    }
  }

  function publicChallenge(ch, st, { used, event }) {
    // De una encuesta solo va el resumen: las preguntas se piden aparte (y con el QR si hace falta).
    const survey = ch.type === 'TRIVIA' && ch.config.survey
    return {
      ...(survey && {
        survey: {
          questions: survey.questions.length,
          gradable: gradableCount(survey),
          minCorrect: survey.minCorrect,
          qrOnly: survey.qrOnly,
        },
      }),
      id: ch.id,
      type: ch.type,
      title: ch.title,
      description: ch.description,
      icon: ch.icon,
      imageUrl: mediaUrl(ch.imageKey),
      points: ch.points,
      category: ch.category,
      tierName: event.settings.pointTiers.find((t) => t.id === ch.tier)?.name ?? null,
      secret: ch.visibility === 'secret',
      requiresApproval: ch.requiresApproval,
      requiresPhoto: ch.requiresPhoto,
      availableFrom: ch.availableFrom,
      availableUntil: ch.availableUntil,
      slotsLeft: ch.maxCompletions ? Math.max(0, ch.maxCompletions - (used.get(ch.id) ?? 0)) : null,
      ...st,
    }
  }

  /** Contexto para calcular el estado de los retos de una persona. */
  function stateContext(ev, row) {
    const challenges = db
      .all(`SELECT * FROM challenges WHERE event_id = :eventId AND status = 'active' ORDER BY sort_order, id`, {
        eventId: ev.id,
      })
      .map(toChallenge)
    // Los titulos de retos secretos no se revelan en las pistas.
    const titles = new Map(challenges.filter((c) => c.visibility === 'visible').map((c) => [c.id, c.title]))
    return {
      challenges,
      ctx: {
        stats: participantStats(db, row.id),
        used: usedSlots(db, ev.id),
        event: ev,
        titles,
        active: new Set(challenges.map((c) => c.id)),
      },
    }
  }

  function activeChallenge(ev, id) {
    const ch = toChallenge(
      db.get(`SELECT * FROM challenges WHERE id = :id AND event_id = :eventId AND status = 'active'`, {
        id,
        eventId: ev.id,
      }),
    )
    if (!ch) throw notFound('Este reto no existe.')
    return ch
  }

  /** Lanza un error si la persona no puede enviar este reto ahora. */
  function assertCanSubmit(ev, row, ch, { reveal = false } = {}) {
    const { ctx } = stateContext(ev, row)
    const st = challengeState(reveal ? { ...ch, visibility: 'visible' } : ch, ctx)
    if (!st) throw notFound('Este reto no existe.')
    if (!canSubmit(st.state)) {
      const [message, code] = STATE_ERRORS[st.state]
      throw conflict(message, code)
    }
    return st
  }

  function insertSubmission({ ev, row, ch, clientId }) {
    const auto = !ch.requiresApproval
    const t = now()
    const { lastInsertRowid } = db.run(
      `INSERT INTO submissions
         (event_id, challenge_id, participant_id, status, points_awarded, reviewed_at, client_id, created_at)
       VALUES (:eventId, :challengeId, :participantId, :status, :points, :reviewedAt, :clientId, :t)`,
      {
        eventId: ev.id,
        challengeId: ch.id,
        participantId: row.id,
        status: auto ? 'approved' : 'pending',
        points: auto ? ch.points : 0,
        reviewedAt: auto ? t : null,
        clientId,
        t,
      },
    )
    return Number(lastInsertRowid)
  }

  function submissionResult(ev, row, id) {
    const s = db.get('SELECT id, challenge_id, status, points_awarded FROM submissions WHERE id = :id', { id })
    return {
      submission: { id: s.id, challengeId: s.challenge_id, status: s.status, pointsAwarded: s.points_awarded },
      me: me(ev, row),
    }
  }

  function photoItem(row, participantId) {
    return {
      id: row.id,
      url: mediaUrl(row.key),
      thumbUrl: mediaUrl(row.thumb_key),
      width: row.width,
      height: row.height,
      alias: row.alias,
      team: row.team_name,
      challenge: { id: row.challenge_id, title: row.challenge_title, icon: row.challenge_icon },
      likes: row.likes,
      liked: !!row.liked,
      mine: row.participant_id === participantId,
      createdAt: row.created_at,
    }
  }

  // --- rutas ---

  // El codigo impreso del evento (o el ?c= del QR) lleva a su slug.
  r.get('/join-codes/:code', (c) => {
    limit(`code:${clientIp(c)}`, 60, 60_000)
    const row = db.get(`SELECT slug FROM events WHERE join_code = :code AND status != 'draft'`, {
      code: normalizeCode(c.req.param('code')),
    })
    if (!row) throw notFound('No encontramos un evento con ese código.')
    return c.json({ slug: row.slug })
  })

  r.get('/events/:slug', (c) => {
    const ev = eventBySlug(c.req.param('slug'))
    return c.json({ event: publicEvent(ev), teams: teamsOf(ev) })
  })

  r.post('/events/:slug/join', async (c) => {
    // Todo el wifi del evento suele salir por una sola IP publica: el limite
    // por IP tiene que admitir que entre medio auditorio a la vez.
    limit(`join:${clientIp(c)}`, 300, 60_000)
    const ev = eventBySlug(c.req.param('slug'))
    requireOpen(ev)
    const body = await jsonBody(c)
    if (normalizeCode(body.code) !== ev.joinCode) {
      throw forbidden('El código del evento no es correcto.', 'bad_code')
    }
    const alias = str(body.alias, 'nombre', { min: 2, max: 24 }).replace(/\s+/g, ' ')
    if (body.consent !== true) throw badRequest('Debes aceptar las condiciones para participar.', 'consent_required')
    const teams = teamsOf(ev)
    let teamId = null
    if (teams.length) {
      teamId = Number(body.teamId)
      if (!teams.some((t) => t.id === teamId)) throw badRequest(`Elige tu ${ev.settings.teamLabel}.`, 'team_required')
    }

    const token = randomToken()
    const id = db.tx(() => {
      const aliasKey = alias.toLowerCase()
      if (db.get('SELECT 1 FROM participants WHERE event_id = :eventId AND alias_key = :aliasKey', { eventId: ev.id, aliasKey })) {
        throw conflict('Ese nombre ya está en uso en este evento. Prueba con otro.', 'alias_taken')
      }
      let code
      do {
        code = recoveryCode()
      } while (db.get('SELECT 1 FROM participants WHERE event_id = :eventId AND recovery_code = :code', { eventId: ev.id, code }))
      const t = now()
      return Number(
        db.run(
          `INSERT INTO participants (event_id, team_id, alias, alias_key, token_hash, recovery_code, consent_at, created_at)
           VALUES (:eventId, :teamId, :alias, :aliasKey, :hash, :code, :t, :t)`,
          { eventId: ev.id, teamId, alias, aliasKey, hash: sha256(token), code, t },
        ).lastInsertRowid,
      )
    })
    const row = db.get('SELECT * FROM participants WHERE id = :id', { id })
    return c.json({ token, me: me(ev, row) }, 201)
  })

  // Recuperar la cuenta en otro telefono con el codigo del perfil.
  // Emite un token nuevo: el telefono anterior queda desconectado.
  r.post('/events/:slug/recover', async (c) => {
    limit(`recover:${clientIp(c)}`, 30, 60_000)
    const ev = eventBySlug(c.req.param('slug'))
    const body = await jsonBody(c)
    const row = db.get('SELECT * FROM participants WHERE event_id = :eventId AND recovery_code = :code', {
      eventId: ev.id,
      code: normalizeCode(body.code),
    })
    if (!row) throw notFound('Ese código de recuperación no existe en este evento.')
    if (row.banned) throw forbidden('Tu cuenta fue suspendida por los organizadores.', 'banned')
    const token = randomToken()
    db.run('UPDATE participants SET token_hash = :hash WHERE id = :id', { hash: sha256(token), id: row.id })
    return c.json({ token, me: me(ev, row) })
  })

  r.get('/events/:slug/me', (c) => {
    const ev = eventBySlug(c.req.param('slug'))
    return c.json({ me: me(ev, authenticate(c, ev)) })
  })

  // Pantalla principal: retos + resumen de la persona (una sola peticion,
  // tambien se usa para el sondeo de retos desbloqueados).
  r.get('/events/:slug/challenges', (c) => {
    const ev = eventBySlug(c.req.param('slug'))
    const row = authenticate(c, ev)
    const { challenges, ctx } = stateContext(ev, row)
    const list = challenges
      .map((ch) => {
        const st = challengeState(ch, ctx)
        return st && publicChallenge(ch, st, ctx)
      })
      .filter(Boolean)
    // Avisos de las ultimas 2 horas: el telefono muestra los que aun no vio.
    const announcements = db
      .all(
        `SELECT id, text, created_at FROM announcements
          WHERE event_id = :eventId AND created_at > :since ORDER BY id DESC LIMIT 5`,
        { eventId: ev.id, since: new Date(Date.now() - 2 * 3600_000).toISOString() },
      )
      .map((n) => ({ id: n.id, text: n.text, createdAt: n.created_at }))
    return c.json({ challenges: list, me: me(ev, row), event: publicEvent(ev), announcements })
  })

  r.get('/events/:slug/challenges/:id', (c) => {
    const ev = eventBySlug(c.req.param('slug'))
    const row = authenticate(c, ev)
    const ch = activeChallenge(ev, int(c.req.param('id'), 'id'))
    const { ctx } = stateContext(ev, row)
    const st = challengeState(ch, ctx)
    if (!st) throw notFound('Este reto no existe.')
    return c.json({ challenge: publicChallenge(ch, st, ctx) })
  })

  // Evidencia con foto (retos PHOTO y AR). multipart: photo, thumb, clientId,
  // width, height, capturedWith. clientId hace la subida idempotente: si la
  // red se corta y el telefono reintenta, no se duplica.
  r.post(
    '/events/:slug/challenges/:id/submissions',
    bodyLimit({
      maxSize: config.maxPhotoBytes + 2 * 1024 * 1024,
      onError: (c) =>
        c.json({ error: { code: 'photo_too_large', message: 'La foto es demasiado grande.' } }, 413),
    }),
    async (c) => {
      const ev = eventBySlug(c.req.param('slug'))
      const row = authenticate(c, ev)
      requireOpen(ev)
      limit(`submit:${row.id}`, 20, 60_000)
      const ch = activeChallenge(ev, int(c.req.param('id'), 'id'))
      if (!PHOTO_TYPES.includes(ch.type)) throw badRequest('Este reto no se completa con una foto.')

      const body = await c.req.parseBody()
      const clientId = str(body.clientId, 'clientId', { min: 8, max: 64 })
      const findExisting = () =>
        db.get('SELECT id FROM submissions WHERE participant_id = :participantId AND client_id = :clientId', {
          participantId: row.id,
          clientId,
        })
      const existing = findExisting()
      if (existing) return c.json(submissionResult(ev, row, existing.id))

      assertCanSubmit(ev, row, ch)
      const photo = await readJpeg(body.photo, 'photo')
      const thumb = await readJpeg(body.thumb, 'thumb', 1024 * 1024)
      const capturedWith = ['camera', 'ar', 'upload'].includes(body.capturedWith) ? body.capturedWith : 'camera'
      const dim = (v) => Math.max(0, Math.min(20000, Math.round(Number(v)) || 0))

      const base = `events/${ev.id}/photos/${randomToken(12)}`
      const key = `${base}.jpg`
      const thumbKey = `${base}_t.jpg`
      await storage.put(key, photo)
      await storage.put(thumbKey, thumb)

      let result
      try {
        result = db.tx(() => {
          // Se vuelve a verificar: entre la validacion y ahora pudo llegar otra peticion.
          const again = findExisting()
          if (again) return { id: again.id, duplicate: true }
          assertCanSubmit(ev, row, ch)
          const id = insertSubmission({ ev, row, ch, clientId })
          db.run(
            `INSERT INTO photos (submission_id, event_id, key, thumb_key, width, height, bytes, captured_with, created_at)
             VALUES (:id, :eventId, :key, :thumbKey, :width, :height, :bytes, :capturedWith, :t)`,
            {
              id,
              eventId: ev.id,
              key,
              thumbKey,
              width: dim(body.width),
              height: dim(body.height),
              bytes: photo.length,
              capturedWith,
              t: now(),
            },
          )
          return { id, duplicate: false }
        })
      } catch (e) {
        await storage.remove(key, thumbKey)
        throw e
      }
      if (result.duplicate) await storage.remove(key, thumbKey)
      return c.json(submissionResult(ev, row, result.id), result.duplicate ? 200 : 201)
    },
  )

  // Checkpoint QR: el QR impreso abre /e/:slug/q/:code en el frontend, que
  // llama aca. Escanear un reto secreto lo revela.
  r.post('/events/:slug/qr/:code', (c) => {
    const ev = eventBySlug(c.req.param('slug'))
    const row = authenticate(c, ev)
    requireOpen(ev)
    limit(`qr:${row.id}`, 30, 60_000)
    const ch = toChallenge(
      db.get(
        `SELECT * FROM challenges
          WHERE event_id = :eventId AND qr_code = :code AND type IN ('QR', 'TRIVIA') AND status = 'active'`,
        { eventId: ev.id, code: normalizeCode(c.req.param('code')) },
      ),
    )
    if (!ch) throw notFound('Este código no corresponde a ningún checkpoint activo.')
    // El QR de una encuesta no la completa: lleva a responderla.
    if (ch.type === 'TRIVIA') return c.json({ survey: { id: ch.id, title: ch.title } })

    const outcome = db.tx(() => {
      const prev = db.get(
        `SELECT id FROM submissions
          WHERE participant_id = :participantId AND challenge_id = :challengeId AND status IN ('pending', 'approved')`,
        { participantId: row.id, challengeId: ch.id },
      )
      if (prev) return { id: prev.id, already: true }
      assertCanSubmit(ev, row, ch, { reveal: true })
      return { id: insertSubmission({ ev, row, ch, clientId: null }), already: false }
    })
    const { ctx } = stateContext(ev, row)
    const st = challengeState({ ...ch, visibility: 'visible' }, ctx)
    return c.json({
      already: outcome.already,
      challenge: publicChallenge(ch, st, ctx),
      ...submissionResult(ev, row, outcome.id),
    })
  })

  // --- encuestas (retos TRIVIA) ---

  function surveyChallenge(ev, c) {
    const ch = activeChallenge(ev, int(c.req.param('id'), 'id'))
    if (ch.type !== 'TRIVIA' || !ch.config.survey) throw notFound('Este reto no es una encuesta.')
    return ch
  }

  /** Una encuesta "solo con QR" exige el codigo de su QR (el que se proyecta en la charla). */
  function assertSurveyCode(ch, code) {
    if (ch.config.survey.qrOnly && normalizeCode(code ?? '') !== ch.qrCode) {
      throw forbidden('Escanea el código QR de la encuesta para responderla.', 'qr_required')
    }
  }

  const mySurveyAnswer = (row, ch) =>
    db.get(
      `SELECT id, answer, points_awarded FROM submissions
        WHERE participant_id = :participantId AND challenge_id = :challengeId AND status = 'approved'`,
      { participantId: row.id, challengeId: ch.id },
    )

  /** Cerrada = ya no se puede responder: recien ahi se muestran las correctas. */
  const surveyClosed = (ev, ch) => ev.status === 'closed' || (!!ch.availableUntil && now() > ch.availableUntil)

  function surveyHeader(ev, row, ch) {
    const { ctx } = stateContext(ev, row)
    return publicChallenge(ch, challengeState({ ...ch, visibility: 'visible' }, ctx), ctx)
  }

  // Preguntas para responder o, si ya respondio, sus respuestas y el resultado.
  r.get('/events/:slug/challenges/:id/survey', (c) => {
    const ev = eventBySlug(c.req.param('slug'))
    const row = authenticate(c, ev)
    const ch = surveyChallenge(ev, c)
    const survey = ch.config.survey
    const mine = mySurveyAnswer(row, ch)
    if (mine) {
      const saved = JSON.parse(mine.answer)
      const closed = surveyClosed(ev, ch)
      return c.json({
        challenge: surveyHeader(ev, row, ch),
        answered: true,
        closed,
        questions: publicQuestions(survey, { reveal: closed }),
        answers: saved.answers,
        result: { correct: saved.correct, total: saved.total, passed: saved.passed, pointsAwarded: mine.points_awarded },
      })
    }
    assertSurveyCode(ch, c.req.query('code'))
    assertCanSubmit(ev, row, ch, { reveal: true })
    return c.json({ challenge: surveyHeader(ev, row, ch), answered: false, questions: publicQuestions(survey) })
  })

  // Un solo intento: se corrige aca y se aprueba sola. Sin el minimo de
  // aciertos queda completada con 0 puntos.
  r.post('/events/:slug/challenges/:id/answers', async (c) => {
    const ev = eventBySlug(c.req.param('slug'))
    const row = authenticate(c, ev)
    requireOpen(ev)
    limit(`submit:${row.id}`, 20, 60_000)
    const ch = surveyChallenge(ev, c)
    const body = await jsonBody(c)
    assertSurveyCode(ch, body.code)
    const graded = gradeSurvey(ch.config.survey, body.answers)
    const id = db.tx(() => {
      if (mySurveyAnswer(row, ch)) throw conflict('Ya respondiste esta encuesta.', 'already_done')
      assertCanSubmit(ev, row, ch, { reveal: true })
      const t = now()
      return Number(
        db.run(
          `INSERT INTO submissions
             (event_id, challenge_id, participant_id, status, points_awarded, answer, reviewed_at, created_at)
           VALUES (:eventId, :challengeId, :participantId, 'approved', :points, :answer, :t, :t)`,
          {
            eventId: ev.id,
            challengeId: ch.id,
            participantId: row.id,
            points: graded.passed ? ch.points : 0,
            answer: JSON.stringify(graded),
            t,
          },
        ).lastInsertRowid,
      )
    })
    return c.json(
      { result: { correct: graded.correct, total: graded.total, passed: graded.passed }, ...submissionResult(ev, row, id) },
      201,
    )
  })

  r.get('/events/:slug/ranking', (c) => {
    const ev = eventBySlug(c.req.param('slug'))
    const row = authenticate(c, ev)
    const people = participantRanking(db, ev.id)
    return c.json({
      participants: people.slice(0, 50),
      me: people.find((p) => p.id === row.id) ?? null,
      teams: teamRanking(db, ev).filter((t) => t.members > 0),
    })
  })

  // Galeria colectiva: solo fotos aprobadas, mas recientes primero.
  r.get('/events/:slug/gallery', (c) => {
    const ev = eventBySlug(c.req.param('slug'))
    const row = authenticate(c, ev)
    const q = c.req.query()
    const params = {
      eventId: ev.id,
      me: row.id,
      limit: int(q.limit, 'limit', { min: 1, max: 60, required: false }) ?? 30,
      before: int(q.before, 'before', { min: 1, required: false }),
      challengeId: int(q.challengeId, 'challengeId', { min: 1, required: false }),
      teamId: int(q.teamId, 'teamId', { min: 1, required: false }),
    }
    const where = [`ph.event_id = :eventId`, `s.status = 'approved'`, `pa.banned = 0`]
    if (params.before) where.push('ph.id < :before')
    if (params.challengeId) where.push('s.challenge_id = :challengeId')
    if (params.teamId) where.push('pa.team_id = :teamId')
    const rows = db.all(
      `SELECT ph.*, s.challenge_id, s.participant_id, c.title AS challenge_title, c.icon AS challenge_icon,
              pa.alias, t.name AS team_name,
              (SELECT COUNT(*) FROM likes l WHERE l.photo_id = ph.id) AS likes,
              EXISTS (SELECT 1 FROM likes l WHERE l.photo_id = ph.id AND l.participant_id = :me) AS liked
         FROM photos ph
         JOIN submissions s ON s.id = ph.submission_id
         JOIN challenges c ON c.id = s.challenge_id
         JOIN participants pa ON pa.id = s.participant_id
         LEFT JOIN teams t ON t.id = pa.team_id
        WHERE ${where.join(' AND ')}
        ORDER BY ph.id DESC
        LIMIT :limit`,
      params,
    )
    const out = {
      items: rows.map((r) => photoItem(r, row.id)),
      nextCursor: rows.length === params.limit ? rows.at(-1).id : null,
    }
    // Opciones de filtro: solo en la primera pagina.
    if (!params.before) {
      out.filters = {
        challenges: db.all(
          `SELECT DISTINCT c.id, c.title, c.icon FROM challenges c
             JOIN submissions s ON s.challenge_id = c.id AND s.status = 'approved'
             JOIN photos ph ON ph.submission_id = s.id
            WHERE c.event_id = :eventId ORDER BY c.sort_order, c.id`,
          { eventId: ev.id },
        ),
        teams: teamsOf(ev),
      }
    }
    return c.json(out)
  })

  function likeTarget(c) {
    const ev = eventBySlug(c.req.param('slug'))
    const row = authenticate(c, ev)
    if (!ev.settings.likes) throw forbidden('Los likes están desactivados en este evento.')
    const photoId = int(c.req.param('id'), 'id')
    const ok = db.get(
      `SELECT 1 FROM photos ph JOIN submissions s ON s.id = ph.submission_id
        WHERE ph.id = :photoId AND ph.event_id = :eventId AND s.status = 'approved'`,
      { photoId, eventId: ev.id },
    )
    if (!ok) throw notFound('Esta foto no existe.')
    return { row, photoId }
  }

  const likeCount = (photoId) => db.get('SELECT COUNT(*) n FROM likes WHERE photo_id = :photoId', { photoId }).n

  r.post('/events/:slug/photos/:id/like', (c) => {
    const { row, photoId } = likeTarget(c)
    db.run('INSERT OR IGNORE INTO likes (photo_id, participant_id, created_at) VALUES (:photoId, :participantId, :t)', {
      photoId,
      participantId: row.id,
      t: now(),
    })
    return c.json({ liked: true, likes: likeCount(photoId) })
  })

  r.delete('/events/:slug/photos/:id/like', (c) => {
    const { row, photoId } = likeTarget(c)
    db.run('DELETE FROM likes WHERE photo_id = :photoId AND participant_id = :participantId', {
      photoId,
      participantId: row.id,
    })
    return c.json({ liked: false, likes: likeCount(photoId) })
  })

  // Mis envios, en cualquier estado (pendientes y rechazados solo los ve su autor).
  r.get('/events/:slug/me/submissions', (c) => {
    const ev = eventBySlug(c.req.param('slug'))
    const row = authenticate(c, ev)
    const rows = db.all(
      `SELECT s.*, c.title, c.icon, c.type, ph.key, ph.thumb_key, ph.width, ph.height
         FROM submissions s
         JOIN challenges c ON c.id = s.challenge_id
         LEFT JOIN photos ph ON ph.submission_id = s.id
        WHERE s.participant_id = :participantId
        ORDER BY s.id DESC`,
      { participantId: row.id },
    )
    return c.json({
      items: rows.map((s) => ({
        id: s.id,
        status: s.status,
        pointsAwarded: s.points_awarded,
        rejectReason: s.reject_reason,
        createdAt: s.created_at,
        challenge: { id: s.challenge_id, title: s.title, icon: s.icon, type: s.type },
        photo: s.key
          ? { url: mediaUrl(s.key), thumbUrl: mediaUrl(s.thumb_key), width: s.width, height: s.height }
          : null,
      })),
    })
  })

  // La persona puede borrar su propia foto (y pierde los puntos de ese reto).
  r.delete('/events/:slug/me/submissions/:id', async (c) => {
    const ev = eventBySlug(c.req.param('slug'))
    const row = authenticate(c, ev)
    const id = int(c.req.param('id'), 'id')
    const photo = db.get(
      `SELECT s.id, ph.key, ph.thumb_key FROM submissions s LEFT JOIN photos ph ON ph.submission_id = s.id
        WHERE s.id = :id AND s.participant_id = :participantId`,
      { id, participantId: row.id },
    )
    if (!photo) throw notFound('Este envío no existe.')
    // Solo fotos: borrar una encuesta respondida permitiria volver a intentarla.
    if (!photo.key) throw forbidden('Solo se pueden borrar las fotos.', 'not_deletable')
    db.run('DELETE FROM submissions WHERE id = :id', { id })
    await storage.remove(photo.key, photo.thumb_key)
    return c.json({ me: me(ev, row) })
  })

  return r
}
