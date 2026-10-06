import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { hashPassword } from '../src/auth.js'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { now, openDb } from '../src/db.js'
import { LocalStorage } from '../src/storage.js'

// JPG minimo valido para las subidas (solo importa la cabecera FFD8FF).
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9])

let dir, db, app

async function call(method, path, { token, body, form } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await app.request(`/api${path}`, { method, headers, body: payload })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, data: type.includes('json') ? await res.json() : await res.arrayBuffer(), res }
}

function photoForm(clientId, extra = {}) {
  const form = new FormData()
  form.set('photo', new Blob([JPEG], { type: 'image/jpeg' }), 'p.jpg')
  form.set('thumb', new Blob([JPEG], { type: 'image/jpeg' }), 't.jpg')
  form.set('clientId', clientId)
  form.set('width', '2048')
  form.set('height', '1536')
  for (const [k, v] of Object.entries(extra)) form.set(k, v)
  return form
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'quest-test-'))
  db = openDb(':memory:')
  const config = loadConfig({ DATA_DIR: dir })
  app = createApp({ db, storage: new LocalStorage(join(dir, 'files')), config })
  db.run(
    `INSERT INTO admins (username, name, password_hash, role, created_at) VALUES ('root', 'Root', :hash, 'admin', :t)`,
    { hash: await hashPassword('password123'), t: now() },
  )
  db.run(
    `INSERT INTO admins (username, name, password_hash, role, created_at) VALUES ('mod', 'Mod', :hash, 'moderator', :t)`,
    { hash: await hashPassword('password123'), t: now() },
  )
})

after(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('flujo completo', () => {
  let admin, mod, eventId, joinCode, teamA, teamB
  let photoCh, arCh, qrCh, secretQr, lockedCh, limitedCh
  let ana, beto

  test('login de administradores', async () => {
    const bad = await call('POST', '/admin/login', { body: { username: 'root', password: 'nope' } })
    assert.equal(bad.status, 401)
    admin = (await call('POST', '/admin/login', { body: { username: 'root', password: 'password123' } })).data.token
    mod = (await call('POST', '/admin/login', { body: { username: 'mod', password: 'password123' } })).data.token
    assert.ok(admin && mod)
    assert.equal((await call('GET', '/admin/events')).status, 401)
  })

  test('crear evento con equipos y retos', async () => {
    const forbidden = await call('POST', '/admin/events', { token: mod, body: { name: 'X' } })
    assert.equal(forbidden.status, 403, 'un moderador no crea eventos')

    const { status, data } = await call('POST', '/admin/events', { token: admin, body: { name: 'SAC Quest 2027' } })
    assert.equal(status, 201)
    assert.equal(data.event.slug, 'sac-quest-2027')
    assert.equal(data.event.status, 'draft')
    assert.match(data.event.joinCode, /^[A-Z2-9]{6}$/)
    eventId = data.event.id
    joinCode = data.event.joinCode
    // Un evento nuevo no tiene moderadores: se asigna el de las pruebas.
    const mods = (await call('GET', `/admin/events/${eventId}/moderators`, { token: admin })).data.moderators
    await call('POST', `/admin/events/${eventId}/moderators`, { token: admin, body: { adminIds: mods.map((m) => m.id) } })

    const badges = await call('GET', `/admin/events/${eventId}/badges`, { token: admin })
    assert.equal(badges.data.badges.length, 4, 'se crean los badges por defecto')

    const teams = await call('POST', `/admin/events/${eventId}/teams`, { token: admin, body: { names: ['Rama A', 'Rama B', 'Rama A'] } })
    assert.equal(teams.data.teams.length, 2)
    ;[teamA, teamB] = teams.data.teams.map((t) => t.id)

    const mk = async (body) => (await call('POST', `/admin/events/${eventId}/challenges`, { token: admin, body: { status: 'active', ...body } })).data.challenge
    photoCh = await mk({ type: 'PHOTO', title: 'Conoce una nueva Rama', points: 20, category: 'Networking', requiresApproval: true })
    // Aunque no se pida revision, una foto o un AR siempre pasan por un moderador
    arCh = await mk({ type: 'AR', title: 'Encuentra a Watt', points: 15, requiresApproval: false })
    qrCh = await mk({ type: 'QR', title: 'Checkpoint', points: 10 })
    // Aunque se pida revision, un QR se aprueba solo
    secretQr = await mk({ type: 'QR', title: 'Secreto', points: 40, visibility: 'secret', requiresApproval: true })
    lockedCh = await mk({ type: 'PHOTO', title: 'Nivel 2', points: 5, unlockRule: { afterChallenges: [photoCh.id] } })
    limitedCh = await mk({ type: 'PHOTO', title: 'Solo uno', points: 5, maxCompletions: 1, requiresApproval: false })
    assert.equal(photoCh.requiresPhoto, true)
    assert.equal(qrCh.requiresPhoto, false)
    assert.equal(arCh.requiresApproval, true)
    assert.equal(limitedCh.requiresApproval, true)
    assert.equal(qrCh.requiresApproval, false)
    assert.equal(secretQr.requiresApproval, false)
    assert.match(qrCh.qrCode, /^[A-Z2-9]{6}$/)
  })

  test('un evento en borrador no es visible; abierto sí', async () => {
    assert.equal((await call('GET', '/events/sac-quest-2027')).status, 404)
    await call('PATCH', `/admin/events/${eventId}`, { token: admin, body: { status: 'open' } })
    const { data } = await call('GET', '/events/sac-quest-2027')
    assert.equal(data.event.name, 'SAC Quest 2027')
    assert.equal(data.event.joinCode, undefined, 'no se filtra el código')
    assert.equal(data.teams.length, 2)
    const code = await call('GET', `/join-codes/${joinCode.toLowerCase()}`)
    assert.equal(code.data.slug, 'sac-quest-2027')
  })

  test('unirse al evento', async () => {
    const slug = '/events/sac-quest-2027'
    const noCode = await call('POST', `${slug}/join`, { body: { alias: 'Ana', teamId: teamA, consent: true, code: 'XXXXXX' } })
    assert.equal(noCode.status, 403)
    const noConsent = await call('POST', `${slug}/join`, { body: { alias: 'Ana', teamId: teamA, code: joinCode } })
    assert.equal(noConsent.status, 400)
    const noTeam = await call('POST', `${slug}/join`, { body: { alias: 'Ana', consent: true, code: joinCode } })
    assert.equal(noTeam.status, 400)

    const ok = await call('POST', `${slug}/join`, { body: { alias: '  Ana  ', teamId: teamA, consent: true, code: joinCode } })
    assert.equal(ok.status, 201)
    ana = ok.data.token
    assert.equal(ok.data.me.alias, 'Ana')
    assert.equal(ok.data.me.level.name, 'Chispa')
    assert.match(ok.data.me.recoveryCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/)

    const dup = await call('POST', `${slug}/join`, { body: { alias: 'ANA', teamId: teamB, consent: true, code: joinCode } })
    assert.equal(dup.status, 409)
    beto = (await call('POST', `${slug}/join`, { body: { alias: 'Beto', teamId: teamB, consent: true, code: joinCode } })).data.token
  })

  test('lista de retos: secreto oculto, bloqueado con pista', async () => {
    const { data } = await call('GET', '/events/sac-quest-2027/challenges', { token: ana })
    const byId = new Map(data.challenges.map((c) => [c.id, c]))
    assert.ok(!byId.has(secretQr.id), 'el secreto no aparece')
    assert.equal(byId.get(photoCh.id).state, 'available')
    assert.equal(byId.get(lockedCh.id).state, 'locked')
    assert.match(byId.get(lockedCh.id).lockedHint, /Conoce una nueva Rama/)
    assert.equal(byId.get(qrCh.id).qrCode, undefined, 'no se filtra el código del QR')
    assert.equal((await call('GET', '/events/sac-quest-2027/challenges')).status, 401)
  })

  test('foto con aprobación queda pendiente; reintento idempotente', async () => {
    const path = `/events/sac-quest-2027/challenges/${photoCh.id}/submissions`
    const first = await call('POST', path, { token: ana, form: photoForm('client-000001') })
    assert.equal(first.status, 201)
    assert.equal(first.data.submission.status, 'pending')
    assert.equal(first.data.me.xp, 0)
    assert.equal(first.data.me.pending, 1)

    const retry = await call('POST', path, { token: ana, form: photoForm('client-000001') })
    assert.equal(retry.status, 200)
    assert.equal(retry.data.submission.id, first.data.submission.id)

    const again = await call('POST', path, { token: ana, form: photoForm('client-000002') })
    assert.equal(again.status, 409)
    assert.equal(again.data.error.code, 'already_pending')

    const notJpeg = new FormData()
    notJpeg.set('photo', new Blob(['hola']), 'p.jpg')
    notJpeg.set('thumb', new Blob([JPEG]), 't.jpg')
    notJpeg.set('clientId', 'client-000003')
    const bad = await call('POST', `/events/sac-quest-2027/challenges/${arCh.id}/submissions`, { token: ana, form: notJpeg })
    assert.equal(bad.status, 400)
  })

  test('las fotos pendientes no aparecen en la galería', async () => {
    const { data } = await call('GET', '/events/sac-quest-2027/gallery', { token: beto })
    assert.equal(data.items.length, 0)
    const mine = await call('GET', '/events/sac-quest-2027/me/submissions', { token: ana })
    assert.equal(mine.data.items[0].status, 'pending')
    assert.match(mine.data.items[0].photo.url, /^media\/events\/\d+\/photos\/.+\.jpg\?exp=\d+&sig=/)
  })

  test('moderar: aprobar da XP y desbloquea retos', async () => {
    const queue = await call('GET', `/admin/events/${eventId}/submissions?status=pending`, { token: mod })
    assert.equal(queue.data.items.length, 1)
    assert.equal(queue.data.pending, 1)
    const sub = queue.data.items[0]
    assert.equal(sub.participant.alias, 'Ana')

    // Los puntos que mande el panel se ignoran: valen los del reto.
    const approved = await call('POST', `/admin/submissions/${sub.id}/review`, { token: mod, body: { decision: 'approve', points: 999 } })
    assert.equal(approved.data.submission.status, 'approved')
    assert.equal(approved.data.submission.reviewer, 'Mod')
    assert.equal(approved.data.pending, 0)

    const { data } = await call('GET', '/events/sac-quest-2027/challenges', { token: ana })
    assert.equal(data.me.xp, 20)
    assert.equal(data.challenges.find((c) => c.id === lockedCh.id).state, 'available')
    assert.equal(data.me.badges.find((b) => b.name === 'Primer paso').earned, true)
  })

  test('foto aprobada: visible en galería, likes y descarga firmada', async () => {
    const { data } = await call('GET', '/events/sac-quest-2027/gallery', { token: beto })
    assert.equal(data.items.length, 1)
    const photo = data.items[0]
    assert.equal(photo.alias, 'Ana')
    assert.equal(photo.mine, false)
    assert.equal(data.filters.challenges.length, 1)

    const like = await call('POST', `/events/sac-quest-2027/photos/${photo.id}/like`, { token: beto })
    assert.deepEqual(like.data, { liked: true, likes: 1 })
    await call('POST', `/events/sac-quest-2027/photos/${photo.id}/like`, { token: beto })
    const unlike = await call('DELETE', `/events/sac-quest-2027/photos/${photo.id}/like`, { token: beto })
    assert.deepEqual(unlike.data, { liked: false, likes: 0 })

    const img = await call('GET', `/${photo.url}`)
    assert.equal(img.status, 200)
    assert.equal(img.res.headers.get('content-type'), 'image/jpeg')
    const tampered = await call('GET', `/${photo.url.replace(/sig=./, 'sig=X')}`)
    assert.equal(tampered.status, 403)
  })

  test('AR: queda pendiente y suma XP al aprobarse', async () => {
    const res = await call('POST', `/events/sac-quest-2027/challenges/${arCh.id}/submissions`, {
      token: ana,
      form: photoForm('client-ar-0001', { capturedWith: 'ar' }),
    })
    assert.equal(res.status, 201)
    assert.equal(res.data.submission.status, 'pending')
    assert.equal(res.data.me.xp, 20)

    await call('POST', `/admin/submissions/${res.data.submission.id}/review`, { token: mod, body: { decision: 'approve' } })
    const { data } = await call('GET', '/events/sac-quest-2027/me', { token: ana })
    assert.equal(data.me.xp, 35)
    assert.equal(data.me.badges.find((b) => b.name === 'Amigo de Watt').earned, true)
  })

  test('QR: reclamar, repetir y revelar un secreto', async () => {
    const claim = await call('POST', `/events/sac-quest-2027/qr/${qrCh.qrCode.toLowerCase()}`, { token: ana })
    assert.equal(claim.status, 200)
    assert.equal(claim.data.already, false)
    assert.equal(claim.data.me.xp, 45)
    const again = await call('POST', `/events/sac-quest-2027/qr/${qrCh.qrCode}`, { token: ana })
    assert.equal(again.data.already, true)
    assert.equal(again.data.me.xp, 45)

    const secret = await call('POST', `/events/sac-quest-2027/qr/${secretQr.qrCode}`, { token: ana })
    assert.equal(secret.data.challenge.title, 'Secreto')
    const { data } = await call('GET', '/events/sac-quest-2027/challenges', { token: ana })
    assert.equal(data.challenges.find((c) => c.id === secretQr.id).state, 'approved', 'ya escaneado: ahora se ve')
    assert.equal(data.me.badges.find((b) => b.name === 'Explorador').earned, true)

    const wrong = await call('POST', '/events/sac-quest-2027/qr/ZZZZZZ', { token: ana })
    assert.equal(wrong.status, 404)
  })

  test('límite de participantes', async () => {
    const path = `/events/sac-quest-2027/challenges/${limitedCh.id}/submissions`
    assert.equal((await call('POST', path, { token: beto, form: photoForm('client-lim-01') })).status, 201)
    const full = await call('POST', path, { token: ana, form: photoForm('client-lim-02') })
    assert.equal(full.status, 409)
    assert.equal(full.data.error.code, 'full')
  })

  test('rechazar quita los puntos y permite reintentar', async () => {
    const list = await call('GET', `/admin/events/${eventId}/submissions?challengeId=${limitedCh.id}`, { token: admin })
    const sub = list.data.items[0]
    await call('POST', `/admin/submissions/${sub.id}/review`, { token: admin, body: { decision: 'reject', reason: 'Foto borrosa' } })
    const { data } = await call('GET', '/events/sac-quest-2027/challenges', { token: beto })
    const ch = data.challenges.find((c) => c.id === limitedCh.id)
    assert.equal(ch.state, 'rejected')
    assert.equal(ch.rejectReason, 'Foto borrosa')
    assert.equal(data.me.xp, 0)
    // El rechazo libera el cupo.
    const retry = await call('POST', `/events/sac-quest-2027/challenges/${limitedCh.id}/submissions`, {
      token: beto,
      form: photoForm('client-lim-03'),
    })
    assert.equal(retry.status, 201)
  })

  test('ranking individual y por equipo', async () => {
    const { data } = await call('GET', '/events/sac-quest-2027/ranking', { token: beto })
    assert.equal(data.participants[0].alias, 'Ana')
    assert.equal(data.participants[0].xp, 85)
    assert.equal(data.me.alias, 'Beto')
    assert.equal(data.me.rank, 2)
    assert.equal(data.teams[0].name, 'Rama A')
  })

  test('score de Rama: desempeño, participación y retos colectivos', async () => {
    const ranking = async () => (await call('GET', `/admin/events/${eventId}/ranking`, { token: mod })).data.teams
    // Todo en XP. XP posible por persona: 20 + 15 + 10 + 40 + 5 + 5 = 95 → desempeño máximo
    // 95 × 2.4 = 228; participación y colectivo valen hasta la mitad de eso (114) cada uno.
    // Rama A: solo Ana (85 XP) → desempeño 85; 1 activa → 114 × ln 2 / ln 11 = 33.
    let [a, b] = await ranking()
    assert.deepEqual(
      { name: a.name, members: a.members, active: a.active, performance: a.performance, participation: a.participation, collective: a.collective, score: a.score },
      { name: 'Rama A', members: 1, active: 1, performance: 85, participation: 33, collective: 0, score: 118 },
    )
    // Beto esta inscrito pero sin retos aprobados: no suma nada.
    assert.deepEqual({ members: b.members, active: b.active, score: b.score }, { members: 1, active: 0, score: 0 })

    const goal = { name: 'Presentes en el checkpoint', points: 10, challengeId: qrCh.id, members: 1 }
    assert.equal((await call('POST', `/admin/events/${eventId}/team-goals`, { token: mod, body: goal })).status, 403)
    const tooMany = await call('POST', `/admin/events/${eventId}/team-goals`, { token: admin, body: { ...goal, members: 6 } })
    assert.equal(tooMany.status, 400, 'un reto de Rama no pide más de 5 integrantes')
    const foreign = await call('POST', `/admin/events/${eventId}/team-goals`, { token: admin, body: { ...goal, challengeId: 9999 } })
    assert.equal(foreign.status, 400)
    const created = await call('POST', `/admin/events/${eventId}/team-goals`, { token: admin, body: goal })
    assert.equal(created.status, 201)
    const goalId = created.data.goals[0].id
    ;[a, b] = await ranking()
    assert.equal(a.collective, 114, 'el único reto de Rama cumplido vale todo el componente')
    assert.equal(a.score, 232)
    assert.deepEqual(a.goals.map((g) => [g.count, g.met]), [[1, true]])
    assert.equal(b.collective, 0)

    // Dos integrantes: una sola persona no puede cumplirlo.
    await call('PATCH', `/admin/team-goals/${goalId}`, { token: admin, body: { members: 2 } })
    ;[a] = await ranking()
    assert.equal(a.collective, 0)
    assert.deepEqual(a.goals.map((g) => [g.count, g.met]), [[1, false]])

    // El ranking del participante trae lo mismo, y el XP individual no cambio.
    const mine = await call('GET', '/events/sac-quest-2027/ranking', { token: beto })
    assert.equal(mine.data.teams[0].score, 118)
    assert.equal(mine.data.participants[0].xp, 85)

    // Los valores se ajustan por evento; guardar otros ajustes no los pisa.
    const teamScore = { performance: 100, participation: 50, collective: 50, top: [1, 0.5], participationRef: 5 }
    const settings = { teamLabel: 'Rama', accent: '#ffd23f', likes: true }
    const saved = await call('PATCH', `/admin/events/${eventId}`, { token: admin, body: { settings: { ...settings, teamScore } } })
    assert.deepEqual(saved.data.event.settings.teamScore, teamScore)
    const kept = await call('PATCH', `/admin/events/${eventId}`, { token: admin, body: { settings } })
    assert.deepEqual(kept.data.event.settings.teamScore, teamScore)
    ;[a] = await ranking()
    // Desempeño: sigue siendo el XP ponderado (85). Participación: máximo 95 × 1.5 / 2 = 71.25,
    // × ln 2 / ln 6 = 28.
    assert.deepEqual([a.performance, a.participation], [85, 28])
  })

  test('recuperar la cuenta en otro teléfono', async () => {
    const me = (await call('GET', '/events/sac-quest-2027/me', { token: beto })).data.me
    const rec = await call('POST', '/events/sac-quest-2027/recover', { body: { code: me.recoveryCode.toLowerCase() } })
    assert.equal(rec.status, 200)
    assert.equal(rec.data.me.alias, 'Beto')
    assert.equal((await call('GET', '/events/sac-quest-2027/me', { token: beto })).status, 401, 'el token viejo queda inválido')
    beto = rec.data.token

    // Codigo nuevo desde el panel: el anterior deja de servir y la sesion abierta sigue.
    const people = (await call('GET', `/admin/events/${eventId}/participants`, { token: mod })).data.participants
    const row = people.find((p) => p.alias === 'Beto')
    const fresh = await call('POST', `/admin/participants/${row.id}/recovery-code`, { token: mod })
    assert.match(fresh.data.recoveryCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    assert.notEqual(fresh.data.recoveryCode, me.recoveryCode)
    assert.equal((await call('POST', '/events/sac-quest-2027/recover', { body: { code: me.recoveryCode } })).status, 404)
    assert.equal((await call('GET', '/events/sac-quest-2027/me', { token: beto })).data.me.recoveryCode, fresh.data.recoveryCode)
  })

  test('borrar mi foto quita los puntos', async () => {
    const mine = await call('GET', '/events/sac-quest-2027/me/submissions', { token: ana })
    const ar = mine.data.items.find((s) => s.challenge.type === 'AR')
    const del = await call('DELETE', `/events/sac-quest-2027/me/submissions/${ar.id}`, { token: ana })
    assert.equal(del.data.me.xp, 70)
    const other = await call('DELETE', `/events/sac-quest-2027/me/submissions/${ar.id}`, { token: beto })
    assert.equal(other.status, 404)
  })

  test('suspender a un participante', async () => {
    const list = await call('GET', `/admin/events/${eventId}/participants`, { token: mod })
    const b = list.data.participants.find((p) => p.alias === 'Beto')
    await call('PATCH', `/admin/participants/${b.id}`, { token: mod, body: { banned: true } })
    const res = await call('GET', '/events/sac-quest-2027/me', { token: beto })
    assert.equal(res.status, 403)
    assert.equal(res.data.error.code, 'banned')
    await call('PATCH', `/admin/participants/${b.id}`, { token: mod, body: { banned: false } })
  })

  test('estadísticas y exportación ZIP', async () => {
    const stats = await call('GET', `/admin/events/${eventId}/stats`, { token: mod })
    assert.equal(stats.data.totals.participants, 2)
    assert.ok(stats.data.byChallenge.length >= 6)

    const exp = await call('POST', `/admin/events/${eventId}/export`, { token: mod, body: { status: 'approved' } })
    assert.equal(exp.data.count, 1, 'la de Ana (el reintento de Beto sigue pendiente)')
    const zip = await call('GET', `/${exp.data.url}`)
    assert.equal(zip.status, 200)
    assert.equal(zip.res.headers.get('content-type'), 'application/zip')
    assert.equal(Buffer.from(zip.data).subarray(0, 2).toString(), 'PK')
    const forged = await call('GET', `/${exp.data.url.replace('status=approved', 'status=all')}`)
    assert.equal(forged.status, 403)
  })

  test('duplicar el evento para el siguiente', async () => {
    const dup = await call('POST', `/admin/events/${eventId}/duplicate`, { token: admin, body: { name: 'SAC Quest 2028' } })
    assert.equal(dup.status, 201)
    const newId = dup.data.event.id
    assert.equal(dup.data.event.slug, 'sac-quest-2028')
    assert.notEqual(dup.data.event.joinCode, joinCode)
    const list = (await call('GET', `/admin/events/${newId}/challenges`, { token: admin })).data.challenges
    assert.equal(list.length, 6)
    assert.ok(list.every((c) => c.status === 'draft'), 'los retos copiados empiezan en borrador')
    const newPhoto = list.find((c) => c.title === 'Conoce una nueva Rama')
    const newLocked = list.find((c) => c.title === 'Nivel 2')
    assert.deepEqual(newLocked.unlockRule, { afterChallenges: [newPhoto.id] })
    const teams = (await call('GET', `/admin/events/${newId}/teams`, { token: admin })).data.teams
    assert.equal(teams.length, 2)
    const goals = (await call('GET', `/admin/events/${newId}/team-goals`, { token: admin })).data.goals
    assert.equal(goals.length, 1)
    assert.equal(goals[0].challengeId, list.find((c) => c.title === 'Checkpoint').id, 'apunta al reto copiado')
  })

  test('encuesta: QR propio, un intento, corrección y resultados', async () => {
    const slug = '/events/sac-quest-2027'
    const survey = {
      qrOnly: true,
      minCorrect: 2,
      questions: [
        { type: 'choice', text: '¿Qué significa SAC?', options: ['Uno', 'Dos', 'Tres'], correct: 1 },
        { type: 'choice', text: '¿Quién dio la charla?', options: ['Ana', 'Beto'], correct: 0 },
        { type: 'scale', text: '¿Qué tan útil fue?' },
        { type: 'text', text: '¿Qué tema quieres?' },
      ],
    }
    const body = { type: 'TRIVIA', title: 'Encuesta de la charla', points: 30, status: 'active', requiresApproval: true, config: { survey } }
    const empty = await call('POST', `/admin/events/${eventId}/challenges`, { token: admin, body: { ...body, config: { survey: { questions: [] } } } })
    assert.equal(empty.status, 400)
    const ch = (await call('POST', `/admin/events/${eventId}/challenges`, { token: admin, body })).data.challenge
    assert.equal(ch.requiresApproval, false, 'se aprueba sola')
    assert.match(ch.qrCode, /^[A-Z2-9]{6}$/)
    assert.deepEqual(ch.config.survey.questions.map((q) => q.id), ['q1', 'q2', 'q3', 'q4'])

    // En la lista va solo el resumen: ni preguntas ni respuestas correctas.
    const listed = (await call('GET', `${slug}/challenges`, { token: ana })).data.challenges.find((c) => c.id === ch.id)
    assert.deepEqual(listed.survey, { questions: 4, gradable: 2, minCorrect: 2, qrOnly: true })
    assert.equal(listed.state, 'available')

    const path = `${slug}/challenges/${ch.id}`
    const noCode = await call('GET', `${path}/survey`, { token: ana })
    assert.equal(noCode.status, 403)
    assert.equal(noCode.data.error.code, 'qr_required')
    // Escanear el QR lleva a la encuesta, no la completa.
    const scan = await call('POST', `${slug}/qr/${ch.qrCode.toLowerCase()}`, { token: ana })
    assert.deepEqual(scan.data, { survey: { id: ch.id, title: 'Encuesta de la charla' } })
    const form = await call('GET', `${path}/survey?code=${ch.qrCode}`, { token: ana })
    assert.equal(form.data.answered, false)
    assert.equal(form.data.questions.length, 4)
    assert.ok(!JSON.stringify(form.data).includes('"correct"'), 'no se filtran las correctas')

    const good = { q1: 1, q2: 0, q3: 5, q4: '  Robótica  ' }
    const wrongCode = await call('POST', `${path}/answers`, { token: ana, body: { answers: good, code: 'ZZZZZZ' } })
    assert.equal(wrongCode.status, 403)
    const incomplete = await call('POST', `${path}/answers`, { token: ana, body: { answers: { q1: 1 }, code: ch.qrCode } })
    assert.equal(incomplete.status, 400)

    const sent = await call('POST', `${path}/answers`, { token: ana, body: { answers: good, code: ch.qrCode } })
    assert.equal(sent.status, 201)
    assert.deepEqual(sent.data.result, { correct: 2, total: 2, passed: true })
    assert.equal(sent.data.submission.pointsAwarded, 30)
    assert.equal(sent.data.me.xp, 100)

    // Un solo intento: ni reenviando ni borrando el envio.
    const again = await call('POST', `${path}/answers`, { token: ana, body: { answers: good, code: ch.qrCode } })
    assert.equal(again.status, 409)
    assert.equal(again.data.error.code, 'already_done')
    const del = await call('DELETE', `${slug}/me/submissions/${sent.data.submission.id}`, { token: ana })
    assert.equal(del.status, 403)

    // Sin el minimo de aciertos: completada con 0 puntos.
    const bad = await call('POST', `${path}/answers`, { token: beto, body: { answers: { q1: 0, q2: 0, q3: 2 }, code: ch.qrCode } })
    assert.deepEqual(bad.data.result, { correct: 1, total: 2, passed: false })
    assert.equal(bad.data.submission.pointsAwarded, 0)
    const betoList = (await call('GET', `${slug}/challenges`, { token: beto })).data.challenges.find((c) => c.id === ch.id)
    assert.equal(betoList.state, 'approved')

    // Mientras sigue abierta se ven mis respuestas, no las correctas.
    const mine = await call('GET', `${path}/survey`, { token: ana })
    assert.equal(mine.data.answered, true)
    assert.equal(mine.data.closed, false)
    assert.deepEqual(mine.data.answers, { q1: 1, q2: 0, q3: 5, q4: 'Robótica' })
    assert.ok(!JSON.stringify(mine.data.questions).includes('"correct"'))

    // Con respuestas ya no se pueden cambiar las preguntas; lo demas si.
    const edited = { ...survey, questions: survey.questions.slice(0, 2) }
    const locked = await call('PATCH', `/admin/challenges/${ch.id}`, { token: admin, body: { config: { survey: edited } } })
    assert.equal(locked.status, 409)
    assert.equal(locked.data.error.code, 'survey_locked')

    // "Cerrar ahora" = poner el fin del horario: ya nadie responde y se ven las correctas.
    const closedAt = new Date(Date.now() - 1000).toISOString()
    const closed = await call('PATCH', `/admin/challenges/${ch.id}`, { token: admin, body: { availableUntil: closedAt } })
    assert.equal(closed.status, 200)
    const dani = (await call('POST', `${slug}/join`, { body: { alias: 'Dani', teamId: teamA, consent: true, code: joinCode } })).data.token
    const late = await call('POST', `${path}/answers`, { token: dani, body: { answers: good, code: ch.qrCode } })
    assert.equal(late.status, 409)
    assert.equal(late.data.error.code, 'expired')
    const after = await call('GET', `${path}/survey`, { token: beto })
    assert.equal(after.data.closed, true)
    assert.deepEqual(after.data.questions.map((q) => q.correct), [1, 0, undefined, undefined])

    const results = await call('GET', `/admin/challenges/${ch.id}/survey-results`, { token: mod })
    assert.equal(results.data.responses.length, 2)
    assert.deepEqual(results.data.summary[0].options.map((o) => o.count), [1, 1, 0])
    assert.equal(results.data.summary[2].average, 3.5)
    assert.deepEqual(
      results.data.responses.map((r) => [r.alias, r.correct, r.pointsAwarded, r.answers.q4]),
      [['Ana', 2, 30, 'Robótica'], ['Beto', 1, 0, undefined]],
    )
  })

  test('valor del reto: define los puntos y los ya otorgados lo siguen', async () => {
    const slug = '/events/sac-quest-2027'
    const xp = async () => (await call('GET', `${slug}/me`, { token: ana })).data.me.xp
    const before = await xp()

    const event = (await call('GET', `/admin/events/${eventId}`, { token: admin })).data.event
    assert.deepEqual(event.settings.pointTiers.map((t) => [t.id, t.points]), [['rapido', 10], ['normal', 20], ['dificil', 40], ['especial', 80]])

    // El checkpoint de Ana valía 10: con el valor «Difícil» pasa a 40, también para quien ya lo tenía.
    const bad = await call('PATCH', `/admin/challenges/${qrCh.id}`, { token: admin, body: { tier: 'no-existe' } })
    assert.equal(bad.status, 400)
    const set = await call('PATCH', `/admin/challenges/${qrCh.id}`, { token: admin, body: { tier: 'dificil', points: 1 } })
    assert.deepEqual([set.data.challenge.tier, set.data.challenge.points], ['dificil', 40], 'manda el valor, no los puntos sueltos')
    assert.equal(await xp(), before + 30)
    const listed = (await call('GET', `${slug}/challenges`, { token: ana })).data.challenges.find((c) => c.id === qrCh.id)
    assert.deepEqual([listed.points, listed.tierName], [40, 'Difícil'])

    // Cambiar lo que vale «Difícil» mueve el reto y los puntos ya dados.
    const settings = { teamLabel: 'Rama', accent: '#ffd23f', likes: true }
    const tiers = event.settings.pointTiers.map((t) => (t.id === 'dificil' ? { ...t, points: 50 } : t))
    await call('PATCH', `/admin/events/${eventId}`, { token: admin, body: { settings: { ...settings, pointTiers: tiers } } })
    assert.equal(await xp(), before + 40)

    // Una encuesta fallada sigue en 0 aunque cambie el valor del reto.
    const survey = (await call('GET', `/admin/events/${eventId}/challenges`, { token: admin })).data.challenges.find((c) => c.type === 'TRIVIA')
    await call('PATCH', `/admin/challenges/${survey.id}`, { token: admin, body: { points: 35 } })
    assert.equal(await xp(), before + 45, 'Ana la aprobó: 30 → 35')
    assert.equal((await call('GET', `${slug}/me`, { token: beto })).data.me.xp, 0, 'Beto no llegó al mínimo')

    // Sin valor («Sin XP»): los puntos se ponen a mano.
    const free = await call('PATCH', `/admin/challenges/${qrCh.id}`, { token: admin, body: { tier: null, points: 10 } })
    assert.deepEqual([free.data.challenge.tier, free.data.challenge.points], [null, 10])
    assert.equal(await xp(), before + 5)
  })

  test('avisos: llegan a los participantes con el sondeo de retos', async () => {
    const slug = '/events/sac-quest-2027'
    const none = await call('GET', `${slug}/challenges`, { token: ana })
    assert.deepEqual(none.data.announcements, [])
    assert.equal((await call('POST', `/admin/events/${eventId}/announcements`, { token: mod, body: { text: '' } })).status, 400)
    const sent = await call('POST', `/admin/events/${eventId}/announcements`, { token: mod, body: { text: '  La charla 2 empieza en 5 minutos  ' } })
    assert.equal(sent.status, 201)
    assert.equal(sent.data.announcements[0].author, 'Mod')
    const got = await call('GET', `${slug}/challenges`, { token: ana })
    assert.deepEqual(got.data.announcements.map((n) => n.text), ['La charla 2 empieza en 5 minutos'])
    await call('DELETE', `/admin/announcements/${sent.data.announcements[0].id}`, { token: mod })
    assert.deepEqual((await call('GET', `${slug}/challenges`, { token: ana })).data.announcements, [])
  })

  test('un moderador solo ve los eventos que tiene asignados', async () => {
    const made = await call('POST', '/admin/events', { token: admin, body: { name: 'Evento test' } })
    const otherId = made.data.event.id
    const ch = (await call('POST', `/admin/events/${otherId}/challenges`, { token: admin, body: { type: 'QR', title: 'Reto ajeno' } })).data.challenge
    const ids = async (token) => (await call('GET', '/admin/events', { token })).data.events.map((e) => e.id)

    // Un evento nuevo no tiene moderadores: el moderador no lo ve ni entra por ninguna ruta.
    assert.ok((await ids(admin)).includes(otherId))
    assert.ok(!(await ids(mod)).includes(otherId))
    assert.equal((await call('GET', `/admin/events/${otherId}`, { token: mod })).status, 404)
    assert.equal((await call('GET', `/admin/events/${otherId}/submissions`, { token: mod })).status, 404)
    assert.equal((await call('GET', `/admin/challenges/${ch.id}`, { token: mod })).status, 404)
    assert.equal((await call('GET', `/admin/events/${otherId}/moderators`, { token: mod })).status, 404)

    const list = (await call('GET', `/admin/events/${otherId}/moderators`, { token: admin })).data.moderators
    assert.deepEqual(list.map((m) => [m.username, m.assigned]), [['mod', false]])
    const set = await call('POST', `/admin/events/${otherId}/moderators`, { token: admin, body: { adminIds: [list[0].id, 9999] } })
    assert.deepEqual(set.data.moderators.map((m) => m.assigned), [true])
    assert.ok((await ids(mod)).includes(otherId))
    assert.equal((await call('GET', `/admin/challenges/${ch.id}`, { token: mod })).status, 200)
    // Asignado sigue siendo moderador: no asigna a otros ni edita el evento.
    assert.equal((await call('POST', `/admin/events/${otherId}/moderators`, { token: mod, body: { adminIds: [] } })).status, 403)

    await call('POST', `/admin/events/${otherId}/moderators`, { token: admin, body: { adminIds: [] } })
    assert.equal((await call('GET', `/admin/events/${otherId}`, { token: mod })).status, 404)
    await call('DELETE', `/admin/events/${otherId}`, { token: admin, body: { confirm: made.data.event.slug } })
  })

  test('roles: el revisor solo aprueba y rechaza; el moderador tambien crea y edita retos', async () => {
    const ev = `/admin/events/${eventId}`
    const made0 = await call('POST', '/admin/users', { token: admin, body: { username: 'revisora', name: 'Revisora', password: 'password123', role: 'reviewer' } })
    assert.equal(made0.data.user.role, 'reviewer')
    const rev = made0.data.user.id
    // El rol editor ya no existe.
    assert.equal((await call('POST', '/admin/users', { token: admin, body: { username: 'editor1', name: 'Editor', password: 'password123', role: 'editor' } })).status, 400)
    const session = (await call('POST', '/admin/login', { body: { username: 'revisora', password: 'password123' } })).data
    assert.equal(session.admin.role, 'reviewer')
    const reviewer = session.token
    const st = async (method, path, token, body) => (await call(method, path, { token, body })).status

    // Sin asignar al evento no entra, igual que un moderador.
    assert.equal(await st('GET', ev, reviewer), 404)
    const team = (await call('GET', `${ev}/moderators`, { token: admin })).data.moderators
    assert.deepEqual(team.map((m) => m.role).sort(), ['moderator', 'reviewer'])
    await call('POST', `${ev}/moderators`, { token: admin, body: { adminIds: team.map((m) => m.id) } })
    const sub = (await call('GET', `${ev}/submissions?status=approved`, { token: reviewer })).data.items[0]

    // Revisor: ve la cola y decide; nada mas.
    assert.equal(await st('GET', `${ev}/challenges`, reviewer), 200)
    assert.equal(await st('POST', `/admin/submissions/${sub.id}/review`, reviewer, { decision: 'approve' }), 200)
    assert.equal(await st('DELETE', `/admin/submissions/${sub.id}`, reviewer), 403)
    assert.equal(await st('GET', `${ev}/participants`, reviewer), 403)
    assert.equal(await st('GET', `${ev}/stats`, reviewer), 403)
    assert.equal(await st('POST', `${ev}/challenges`, reviewer, { type: 'QR', title: 'No debe' }), 403)
    assert.equal(await st('POST', `${ev}/export`, reviewer, {}), 403)

    // Moderador: ademas de moderar, crea y edita retos; no los borra ni toca ajustes ni usuarios.
    const made = await call('POST', `${ev}/challenges`, { token: mod, body: { type: 'QR', title: 'Reto del moderador' } })
    assert.equal(made.status, 201)
    assert.equal(await st('PATCH', `/admin/challenges/${made.data.challenge.id}`, mod, { title: 'Reto editado' }), 200)
    assert.equal(await st('POST', `/admin/challenges/${made.data.challenge.id}/regenerate-qr`, mod), 200)
    assert.equal(await st('DELETE', `/admin/challenges/${made.data.challenge.id}`, mod), 403)
    assert.equal(await st('PATCH', ev, mod, { name: 'Otro nombre' }), 403)
    assert.equal(await st('GET', '/admin/users', mod), 403)

    // Cambiar el rol desde Usuarios y dejar todo como estaba.
    assert.equal((await call('PATCH', `/admin/users/${rev}`, { token: admin, body: { role: 'moderator' } })).data.user.role, 'moderator')
    await call('DELETE', `/admin/challenges/${made.data.challenge.id}`, { token: admin })
    await call('PATCH', `/admin/users/${rev}`, { token: admin, body: { active: false } })
    const mods = (await call('GET', `${ev}/moderators`, { token: admin })).data.moderators
    await call('POST', `${ev}/moderators`, { token: admin, body: { adminIds: mods.filter((m) => m.username === 'mod').map((m) => m.id) } })
  })

  test('inicio y fin programados: el evento se abre y se cierra solo, una vez', async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const soon = (ms) => new Date(Date.now() + ms).toISOString()
    const made = await call('POST', '/admin/events', { token: admin, body: { name: 'Evento con horario' } })
    const id = made.data.event.id
    const status = async () => (await call('GET', `/admin/events/${id}`, { token: admin })).data.event.status
    const patch = (body) => call('PATCH', `/admin/events/${id}`, { token: admin, body })

    assert.equal((await patch({ startsAt: soon(5000), endsAt: soon(1000) })).status, 400, 'el fin va despues del inicio')
    // Una fecha ya pasada no abre nada.
    await patch({ startsAt: soon(-60_000) })
    assert.equal(await status(), 'draft')

    await patch({ startsAt: soon(150), endsAt: soon(450) })
    assert.equal(await status(), 'draft')
    await wait(200)
    assert.equal(await status(), 'open', 'se abre solo al llegar el inicio')
    await wait(300)
    assert.equal(await status(), 'closed', 'se cierra solo al llegar el fin')
    assert.equal((await call('POST', '/events/evento-con-horario/join', { body: { alias: 'Tarde', consent: true, code: made.data.event.joinCode } })).status, 403)

    // Lo manual gana: reabierto a mano, el fin no vuelve a cerrarlo.
    await patch({ status: 'open' })
    await wait(50)
    assert.equal(await status(), 'open')
    // Una fecha nueva en el futuro vuelve a armar el cierre.
    await patch({ endsAt: soon(150) })
    await wait(200)
    assert.equal(await status(), 'closed')
    await call('DELETE', `/admin/events/${id}`, { token: admin, body: { confirm: made.data.event.slug } })
  })

  test('un requisito borrado o desactivado no deja el reto bloqueado', async () => {
    const slug = '/events/sac-quest-2027'
    const mk = async (body) => (await call('POST', `/admin/events/${eventId}/challenges`, { token: admin, body: { status: 'active', type: 'QR', ...body } })).data.challenge
    const stateOf = async (id) => (await call('GET', `${slug}/challenges`, { token: beto })).data.challenges.find((c) => c.id === id)?.state
    const first = await mk({ title: 'Primero' })
    const other = await mk({ title: 'Otro requisito' })
    const next = await mk({ title: 'Despues', unlockRule: { afterChallenges: [first.id, other.id, 99999] } })
    assert.deepEqual(next.unlockRule, { afterChallenges: [first.id, other.id] }, 'no se guardan retos que no existen')
    assert.equal(await stateOf(next.id), 'locked')

    await call('DELETE', `/admin/challenges/${first.id}`, { token: admin })
    const kept = (await call('GET', `/admin/challenges/${next.id}`, { token: admin })).data.challenge
    assert.deepEqual(kept.unlockRule, { afterChallenges: [other.id] }, 'el reto borrado sale de la regla')
    assert.equal(await stateOf(next.id), 'locked', 'el otro requisito sigue contando')

    await call('PATCH', `/admin/challenges/${other.id}`, { token: admin, body: { status: 'inactive' } })
    assert.equal(await stateOf(next.id), 'available', 'un requisito desactivado no se exige')

    // Reglas que quedaron rotas antes de este arreglo: se ignoran al calcular.
    db.run('UPDATE challenges SET unlock_rule = :rule WHERE id = :id', { rule: '{"afterChallenges":[99999]}', id: next.id })
    assert.equal(await stateOf(next.id), 'available')
    for (const c of [other, next]) await call('DELETE', `/admin/challenges/${c.id}`, { token: admin })
  })

  test('cerrar el evento bloquea nuevos envíos', async () => {
    await call('PATCH', `/admin/events/${eventId}`, { token: admin, body: { status: 'closed' } })
    const res = await call('POST', `/events/sac-quest-2027/qr/${qrCh.qrCode}`, { token: beto })
    assert.equal(res.status, 403)
    assert.equal(res.data.error.code, 'event_closed')
    const join = await call('POST', '/events/sac-quest-2027/join', { body: { alias: 'Caro', teamId: teamA, consent: true, code: joinCode } })
    assert.equal(join.status, 403)
    // La galería y el ranking siguen disponibles.
    assert.equal((await call('GET', '/events/sac-quest-2027/ranking', { token: ana })).status, 200)
  })
})
