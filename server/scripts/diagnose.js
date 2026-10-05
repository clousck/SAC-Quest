// Diagnostico de un evento: retos con su regla de desbloqueo, envios por
// estado, retos de Rama con el conteo de cada Rama y lo que ve una persona.
// Solo lee la base (sirve con el servidor andando).
//   npm run diagnose                      lista los eventos
//   npm run diagnose -- <slug>            todo el evento
//   npm run diagnose -- <slug> "<alias>"  ademas, los retos como los ve esa persona
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { loadConfig } from '../src/config.js'
import { challengeState, participantRanking, participantStats, possibleXp, teamRanking, toChallenge, toEvent, usedSlots } from '../src/rules.js'

try {
  process.loadEnvFile()
} catch {
  // sin .env
}

const [slug, alias] = process.argv.slice(2)
const raw = new DatabaseSync(join(loadConfig().dataDir, 'quest.db'), { readOnly: true })
// La misma interfaz minima que usan las reglas (parametros con nombre).
const db = {
  all: (sql, params = {}) => raw.prepare(sql).all(params),
  get: (sql, params = {}) => raw.prepare(sql).get(params),
}
const title = (text) => console.log(`\n== ${text} ==`)

const events = db.all('SELECT * FROM events ORDER BY id').map(toEvent)
const ev = events.find((e) => e.slug === slug)
if (!ev) {
  title('Eventos')
  for (const e of events) console.log(`${e.slug}  (${e.status})  ${e.name}`)
  console.log('\nUso: npm run diagnose -- <slug> ["<alias>"]')
  process.exit(slug ? 1 : 0)
}
const eventId = ev.id
console.log(`Evento ${ev.slug} (id ${ev.id}) · estado ${ev.status} · ${new Date().toISOString()}`)

const challenges = db.all('SELECT * FROM challenges WHERE event_id = :eventId ORDER BY sort_order, id', { eventId }).map(toChallenge)
const byId = new Map(challenges.map((c) => [c.id, c]))
const counts = new Map()
for (const r of db.all('SELECT challenge_id, status, COUNT(*) n FROM submissions WHERE event_id = :eventId GROUP BY 1, 2', { eventId })) {
  counts.set(`${r.challenge_id}:${r.status}`, r.n)
}

title('Retos')
for (const c of challenges) {
  const n = (s) => counts.get(`${c.id}:${s}`) ?? 0
  console.log(
    `#${c.id} [${c.status}/${c.visibility}] ${c.type} «${c.title}» ${c.points} XP · aprobadas ${n('approved')}, pendientes ${n('pending')}, rechazadas ${n('rejected')}`,
  )
  const rule = c.unlockRule
  if (!rule) continue
  console.log(`     regla guardada: ${JSON.stringify(rule)}`)
  for (const id of rule.afterChallenges ?? []) {
    const req = byId.get(id)
    if (!req) console.log(`     ⚠ pide el reto #${id}, que YA NO EXISTE`)
    else if (req.status !== 'active') console.log(`     ⚠ pide «${req.title}» (#${id}), que esta en ${req.status}`)
    else console.log(`     pide «${req.title}» (#${id})`)
  }
}

title('Participantes por Rama')
for (const r of db.all(
  `SELECT COALESCE(t.name, '(sin Rama)') AS team, COUNT(*) n, SUM(p.banned) banned
     FROM participants p LEFT JOIN teams t ON t.id = p.team_id
    WHERE p.event_id = :eventId GROUP BY p.team_id ORDER BY n DESC`,
  { eventId },
)) {
  console.log(`${r.team}: ${r.n}${r.banned ? ` (${r.banned} suspendidos)` : ''}`)
}

title('Retos de Rama')
const goals = db.all('SELECT * FROM team_goals WHERE event_id = :eventId ORDER BY sort_order, id', { eventId })
if (!goals.length) console.log('(ninguno)')
const ranking = teamRanking(db, ev)
for (const g of goals) {
  const ch = byId.get(g.challenge_id)
  console.log(`«${g.name}»: ${g.members} integrantes con aprobado «${ch?.title}» (#${g.challenge_id}, ${ch?.type}, ${ch?.status})`)
  for (const t of ranking) {
    const tg = t.goals.find((x) => x.id === g.id)
    // Quienes cuentan y quienes aun no (pendientes o rechazadas no suman).
    const people = db.all(
      `SELECT p.alias, s.status FROM submissions s JOIN participants p ON p.id = s.participant_id
        WHERE s.challenge_id = :challengeId AND p.team_id = :teamId AND p.banned = 0 ORDER BY s.id`,
      { challengeId: g.challenge_id, teamId: t.id },
    )
    if (!people.length) continue
    console.log(`     ${tg.met ? '✅' : '❌'} ${t.name}: ${tg.count}/${g.members} · ${people.map((p) => `${p.alias} (${p.status})`).join(', ')}`)
  }
}

title('XP de Rama')
console.log(`XP posible por persona: ${possibleXp(db, eventId)} · pesos: ${JSON.stringify(ev.settings.teamScore)}`)
for (const t of ranking) {
  console.log(
    `${t.rank}. ${t.name}: ${t.score} XP = mejores ${t.performance} + participacion ${t.participation} + retos de Rama ${t.collective} · ${t.active} activos de ${t.members}`,
  )
}

title('Ranking de personas')
for (const p of participantRanking(db, eventId)) {
  console.log(`${p.rank}. ${p.alias} (${p.team?.name ?? 'sin Rama'}): ${p.xp} XP, ${p.completed} retos`)
}

title('Ultimos 25 envios')
for (const s of db.all(
  `SELECT s.id, s.status, s.points_awarded, s.created_at, s.reviewed_at, p.alias, c.title
     FROM submissions s JOIN participants p ON p.id = s.participant_id JOIN challenges c ON c.id = s.challenge_id
    WHERE s.event_id = :eventId ORDER BY s.id DESC LIMIT 25`,
  { eventId },
)) {
  console.log(`#${s.id} ${s.created_at} ${s.status} ${s.points_awarded} XP · ${s.alias} → «${s.title}»`)
}

if (alias) {
  const person = db.get('SELECT * FROM participants WHERE event_id = :eventId AND alias_key = :key', { eventId, key: alias.trim().toLowerCase() })
  title(`Como ve los retos «${alias}»`)
  if (!person) console.log('No hay nadie con ese nombre en este evento.')
  else {
    const active = challenges.filter((c) => c.status === 'active')
    const ctx = {
      stats: participantStats(db, person.id),
      used: usedSlots(db, eventId),
      event: ev,
      titles: new Map(active.filter((c) => c.visibility === 'visible').map((c) => [c.id, c.title])),
      active: new Set(active.map((c) => c.id)),
    }
    console.log(`id ${person.id} · ${ctx.stats.xp} XP · suspendido: ${person.banned ? 'si' : 'no'}`)
    for (const c of active) {
      const st = challengeState(c, ctx)
      console.log(`#${c.id} «${c.title}»: ${st ? st.state : '(oculto: secreto)'}${st?.lockedHint ? ` — ${st.lockedHint}` : ''}`)
    }
  }
}
