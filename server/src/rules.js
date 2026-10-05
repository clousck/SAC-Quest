import { parseJson } from './db.js'

/**
 * Reglas del juego. Todo se calcula a partir de las submissions aprobadas
 * (no hay contadores guardados): aprobar, rechazar o borrar una foto
 * corrige XP, nivel, badges y ranking automaticamente.
 */

export const DEFAULT_LEVELS = [
  { name: 'Chispa', minXp: 0 },
  { name: 'Voltio', minXp: 40 },
  { name: 'Amperio', minXp: 100 },
  { name: 'Ohm', minXp: 180 },
  { name: 'Watt', minXp: 280 },
  { name: 'Tesla', minXp: 400 },
]

/**
 * XP de Rama = desempeño + participacion + retos de Rama, en las mismas
 * unidades que el XP de las personas:
 *  - desempeño: XP de los mejores de la Rama, ponderado con `top`. Su maximo
 *    es que esos puestos tengan todo el XP posible de una persona.
 *  - participacion: bono por miembros activos, con rendimientos decrecientes;
 *    llega al maximo con `participationRef` activos.
 *  - colectivo: retos de Rama cumplidos (tabla team_goals).
 * performance / participation / collective son pesos relativos: con
 * 150/75/75, participacion y colectivo pueden valer cada uno la mitad del
 * desempeño maximo.
 */
export const DEFAULT_TEAM_SCORE = {
  performance: 150,
  participation: 75,
  collective: 75,
  top: [1, 0.6, 0.4, 0.25, 0.15],
  participationRef: 10,
}

// Un reto de Rama no pide mas que esto: asi lo puede cumplir una Rama chica.
export const TEAM_GOAL_MAX_MEMBERS = 5

// Valores de reto: cada reto elige uno y de ahi salen sus puntos.
export const DEFAULT_POINT_TIERS = [
  { id: 'rapido', name: 'Rápido', points: 10 },
  { id: 'normal', name: 'Normal', points: 20 },
  { id: 'dificil', name: 'Difícil', points: 40 },
  { id: 'especial', name: 'Especial', points: 80 },
]

export const DEFAULT_SETTINGS = {
  teamLabel: 'Rama', // como se llama un equipo en este evento
  accent: '#ffd23f',
  likes: true,
  teamScore: DEFAULT_TEAM_SCORE,
  pointTiers: DEFAULT_POINT_TIERS,
}

// TRIVIA es la encuesta (ver survey.js)
export const CHALLENGE_TYPES = ['PHOTO', 'AR', 'QR', 'TRIVIA']
export const PHOTO_TYPES = ['PHOTO', 'AR']

// --- filas → objetos ---

export function toEvent(row) {
  if (!row) return null
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    joinCode: row.join_code,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    levels: normalizeLevels(parseJson(row.levels, [])),
    settings: withTeamScore({ ...DEFAULT_SETTINGS, ...parseJson(row.settings, {}) }),
    createdAt: row.created_at,
  }
}

// Eventos creados antes del Score de Rama no traen todos los campos.
function withTeamScore(settings) {
  return { ...settings, teamScore: { ...DEFAULT_TEAM_SCORE, ...settings.teamScore } }
}

export function toTeamGoal(row) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    description: row.description,
    points: row.points,
    challengeId: row.challenge_id,
    members: row.members,
    sortOrder: row.sort_order,
  }
}

export function toChallenge(row) {
  if (!row) return null
  return {
    id: row.id,
    eventId: row.event_id,
    type: row.type,
    title: row.title,
    description: row.description,
    icon: row.icon,
    imageKey: row.image_key,
    points: row.points,
    category: row.category,
    tier: row.tier ?? null,
    status: row.status,
    visibility: row.visibility,
    unlockRule: parseJson(row.unlock_rule, null),
    availableFrom: row.available_from,
    availableUntil: row.available_until,
    maxCompletions: row.max_completions,
    requiresApproval: !!row.requires_approval,
    requiresPhoto: !!row.requires_photo,
    config: parseJson(row.config, {}),
    qrCode: row.qr_code,
    sortOrder: row.sort_order,
  }
}

export function toBadge(row) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    description: row.description,
    rule: parseJson(row.rule, {}),
    sortOrder: row.sort_order,
  }
}

// --- niveles ---

export function normalizeLevels(levels) {
  const list = Array.isArray(levels) && levels.length ? levels : DEFAULT_LEVELS
  return list
    .map((l) => ({ name: String(l.name), minXp: Math.max(0, Number(l.minXp) || 0) }))
    .sort((a, b) => a.minXp - b.minXp)
}

export function levelFor(levels, xp) {
  const list = normalizeLevels(levels)
  let index = 0
  list.forEach((l, i) => {
    if (xp >= l.minXp) index = i
  })
  const current = list[index]
  const next = list[index + 1] ?? null
  const progress = next ? (xp - current.minXp) / (next.minXp - current.minXp) : 1
  return {
    number: index + 1,
    name: current.name,
    minXp: current.minXp,
    next: next && { name: next.name, minXp: next.minXp },
    progress: Math.max(0, Math.min(1, progress)),
  }
}

// --- estadisticas de una persona ---

export function participantStats(db, participantId) {
  const rows = db.all(
    `SELECT s.id, s.challenge_id, s.status, s.points_awarded, s.reject_reason, s.created_at,
            c.category, c.type
       FROM submissions s JOIN challenges c ON c.id = s.challenge_id
      WHERE s.participant_id = :participantId
      ORDER BY s.id`,
    { participantId },
  )
  const stats = {
    xp: 0,
    completed: 0,
    pending: 0,
    approved: new Set(),
    latest: new Map(), // challengeId → ultima submission
    byCategory: {},
    byType: {},
  }
  for (const r of rows) {
    stats.latest.set(r.challenge_id, r)
    if (r.status === 'pending') stats.pending++
    if (r.status !== 'approved') continue
    stats.xp += r.points_awarded
    stats.completed++
    stats.approved.add(r.challenge_id)
    if (r.category) stats.byCategory[r.category] = (stats.byCategory[r.category] ?? 0) + 1
    stats.byType[r.type] = (stats.byType[r.type] ?? 0) + 1
  }
  return stats
}

// --- desbloqueo y disponibilidad de retos ---

/** unlockRule: { afterChallenges?: number[], minXp?: number } — se exigen todas. */
export function ruleSatisfied(rule, stats) {
  if (!rule) return true
  if (rule.minXp && stats.xp < rule.minXp) return false
  if (rule.afterChallenges?.length && !rule.afterChallenges.every((id) => stats.approved.has(id))) return false
  return true
}

function unlockHint(rule, titles) {
  const parts = []
  if (rule?.afterChallenges?.length) {
    const names = rule.afterChallenges.map((id) => titles.get(id)).filter(Boolean)
    parts.push(names.length ? `Completa ${names.map((n) => `«${n}»`).join(', ')}` : 'Completa otros retos')
  }
  if (rule?.minXp) parts.push(`Llega a ${rule.minXp} XP`)
  return parts.join(' y ')
}

/** Cupos usados (pendientes + aprobadas) por reto. */
export function usedSlots(db, eventId) {
  const rows = db.all(
    `SELECT challenge_id, COUNT(*) n FROM submissions
      WHERE event_id = :eventId AND status IN ('pending', 'approved')
      GROUP BY challenge_id`,
    { eventId },
  )
  return new Map(rows.map((r) => [r.challenge_id, r.n]))
}

/**
 * Estado de un reto para una persona. Devuelve null si no debe verlo
 * (reto secreto sin desbloquear y sin intentos).
 *
 * state: approved | pending | available | rejected | locked | upcoming |
 *        expired | full | closed
 */
export function challengeState(ch, { stats, used, event, titles, now = new Date().toISOString() }) {
  const sub = stats.latest.get(ch.id)
  const unlocked = ruleSatisfied(ch.unlockRule, stats)
  if (ch.visibility === 'secret' && !sub && !(ch.unlockRule && unlocked)) return null

  const base = { submissionId: sub?.id ?? null, rejectReason: null, lockedHint: null }
  if (sub?.status === 'approved') return { ...base, state: 'approved', points: sub.points_awarded }
  if (sub?.status === 'pending') return { ...base, state: 'pending' }
  if (event.status === 'closed') return { ...base, state: 'closed' }
  if (!unlocked) return { ...base, state: 'locked', lockedHint: unlockHint(ch.unlockRule, titles) }
  if (ch.availableFrom && now < ch.availableFrom) return { ...base, state: 'upcoming' }
  if (ch.availableUntil && now > ch.availableUntil) return { ...base, state: 'expired' }
  if (ch.maxCompletions && (used.get(ch.id) ?? 0) >= ch.maxCompletions) return { ...base, state: 'full' }
  if (sub?.status === 'rejected') return { ...base, state: 'rejected', rejectReason: sub.reject_reason }
  return { ...base, state: 'available' }
}

export const canSubmit = (state) => state === 'available' || state === 'rejected'

// --- badges ---

/**
 * Reglas soportadas:
 *  { type: 'count', n }                       n retos completados
 *  { type: 'xp', n }                          n XP
 *  { type: 'category', category, n }          n retos de una categoria
 *  { type: 'challengeType', challengeType, n} n retos de un tipo (PHOTO/AR/QR)
 *  { type: 'challenge', challengeId }         un reto concreto
 *  { type: 'allOfType', challengeType }       todos los retos activos de un tipo
 */
export function badgeEarned(rule, stats, activeByType) {
  const n = Math.max(1, Number(rule.n) || 1)
  switch (rule.type) {
    case 'count':
      return stats.completed >= n
    case 'xp':
      return stats.xp >= n
    case 'category':
      return (stats.byCategory[rule.category] ?? 0) >= n
    case 'challengeType':
      return (stats.byType[rule.challengeType] ?? 0) >= n
    case 'challenge':
      return stats.approved.has(Number(rule.challengeId))
    case 'allOfType': {
      const ids = activeByType.get(rule.challengeType) ?? []
      return ids.length > 0 && ids.every((id) => stats.approved.has(id))
    }
    default:
      return false
  }
}

export function badgesFor(db, eventId, stats) {
  const badges = db
    .all('SELECT * FROM badges WHERE event_id = :eventId ORDER BY sort_order, id', { eventId })
    .map(toBadge)
  const activeByType = new Map()
  for (const r of db.all(
    `SELECT id, type FROM challenges WHERE event_id = :eventId AND status = 'active'`,
    { eventId },
  )) {
    if (!activeByType.has(r.type)) activeByType.set(r.type, [])
    activeByType.get(r.type).push(r.id)
  }
  return badges.map((b) => ({
    id: b.id,
    name: b.name,
    icon: b.icon,
    description: b.description,
    earned: badgeEarned(b.rule, stats, activeByType),
  }))
}

// --- ranking ---

/** Ranking individual. Empate: gana quien llego antes a ese puntaje. */
export function participantRanking(db, eventId) {
  const rows = db.all(
    `SELECT p.id, p.alias, p.team_id, t.name AS team_name, t.short_name AS team_short,
            COALESCE(SUM(s.points_awarded), 0) AS xp,
            COUNT(s.id) AS completed,
            MAX(s.reviewed_at) AS last_at
       FROM participants p
       LEFT JOIN teams t ON t.id = p.team_id
       LEFT JOIN submissions s ON s.participant_id = p.id AND s.status = 'approved'
      WHERE p.event_id = :eventId AND p.banned = 0
      GROUP BY p.id
      ORDER BY xp DESC, last_at ASC NULLS LAST, p.alias COLLATE NOCASE`,
    { eventId },
  )
  return rows.map((r, i) => ({
    rank: i + 1,
    id: r.id,
    alias: r.alias,
    team: r.team_id ? { id: r.team_id, name: r.team_name, shortName: r.team_short } : null,
    xp: r.xp,
    completed: r.completed,
  }))
}

/** XP que puede juntar una persona: todos los retos publicados, sigan activos o no. */
export function possibleXp(db, eventId) {
  return db.get(`SELECT COALESCE(SUM(points), 0) AS xp FROM challenges WHERE event_id = :eventId AND status != 'draft'`, {
    eventId,
  }).xp
}

/**
 * Ranking por equipo con el Score de Rama (ver DEFAULT_TEAM_SCORE). El XP de
 * las personas no cambia: esto solo decide como se compara una Rama con otra.
 * Inscritos sin actividad no suman nada.
 */
export function teamRanking(db, event) {
  const cfg = event.settings.teamScore
  const eventId = event.id
  const teams = db.all('SELECT id, name, short_name FROM teams WHERE event_id = :eventId', { eventId })
  const people = db.all(
    `SELECT p.team_id,
            COALESCE(SUM(s.points_awarded), 0) AS xp,
            COUNT(s.id) AS completed,
            COALESCE(SUM(s.points_awarded > 0), 0) AS scored
       FROM participants p
       LEFT JOIN submissions s ON s.participant_id = p.id AND s.status = 'approved'
      WHERE p.event_id = :eventId AND p.banned = 0 AND p.team_id IS NOT NULL
      GROUP BY p.id`,
    { eventId },
  )
  // Cuantos integrantes distintos de cada Rama tienen aprobado cada reto.
  const done = new Map()
  for (const r of db.all(
    `SELECT p.team_id, s.challenge_id, COUNT(DISTINCT p.id) AS n
       FROM submissions s JOIN participants p ON p.id = s.participant_id
      WHERE s.event_id = :eventId AND s.status = 'approved' AND p.banned = 0 AND p.team_id IS NOT NULL
      GROUP BY p.team_id, s.challenge_id`,
    { eventId },
  )) {
    done.set(`${r.team_id}:${r.challenge_id}`, r.n)
  }
  const goals = db
    .all('SELECT * FROM team_goals WHERE event_id = :eventId ORDER BY sort_order, id', { eventId })
    .map(toTeamGoal)
  const goalTotal = goals.reduce((sum, g) => sum + g.points, 0)
  const weightSum = cfg.top.reduce((a, b) => a + b, 0)
  const best = weightSum * possibleXp(db, eventId)

  const rows = teams.map((t) => {
    const members = people.filter((p) => p.team_id === t.id)
    const xps = members.map((m) => m.xp).sort((a, b) => b - a)
    const weighted = cfg.top.reduce((sum, w, i) => sum + w * (xps[i] ?? 0), 0)
    const active = members.filter((m) => m.scored > 0).length
    const teamGoals = goals.map((g) => {
      const count = done.get(`${t.id}:${g.challengeId}`) ?? 0
      return { id: g.id, name: g.name, icon: g.icon, description: g.description, members: g.members, count, met: count >= g.members }
    })
    const met = goals.filter((_, i) => teamGoals[i].met).reduce((sum, g) => sum + g.points, 0)
    // Todo sale en XP: `unit` convierte los pesos a XP (el desempeño queda
    // igual al XP ponderado de los mejores).
    const unit = cfg.performance ? best / cfg.performance : 0
    const performance = unit * cfg.performance * (best ? Math.min(1, weighted / best) : 0)
    const participation = unit * cfg.participation * Math.min(1, Math.log(1 + active) / Math.log(1 + cfg.participationRef))
    const collective = unit * (goalTotal ? (cfg.collective * met) / goalTotal : 0)
    return {
      id: t.id,
      name: t.name,
      shortName: t.short_name,
      members: members.length,
      active,
      xp: members.reduce((sum, m) => sum + m.xp, 0),
      completed: members.reduce((sum, m) => sum + m.completed, 0),
      exact: performance + participation + collective,
      performance: Math.round(performance),
      participation: Math.round(participation),
      collective: Math.round(collective),
      goals: teamGoals,
    }
  })
  rows.sort((a, b) => b.exact - a.exact || b.active - a.active || a.name.localeCompare(b.name, 'es'))
  // El total es la suma de lo que se muestra de cada componente.
  return rows.map(({ exact: _exact, ...r }, i) => ({ rank: i + 1, ...r, score: r.performance + r.participation + r.collective }))
}
