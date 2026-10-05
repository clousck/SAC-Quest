// Crea un evento de prueba "demo" abierto, con Ramas y un reto de cada tipo.
//   npm run seed-demo
// Borra y recrea el evento demo si ya existe. No toca otros eventos.
import { join } from 'node:path'
import { randomCode } from '../src/auth.js'
import { loadConfig } from '../src/config.js'
import { now, openDb } from '../src/db.js'
import { DEFAULT_LEVELS, DEFAULT_SETTINGS } from '../src/rules.js'
import { DEFAULT_BADGES } from '../src/routes/admin.js'

try {
  process.loadEnvFile()
} catch {
  // sin .env
}

const config = loadConfig()
const db = openDb(join(config.dataDir, 'quest.db'))
const t = now()

const TEAMS = ['Rama ESPOL', 'Rama EPN', 'Rama UCuenca', 'Rama ESPE', 'Rama PUCE', 'Rama UTPL', 'Rama USFQ', 'Rama UPS']

const CHALLENGES = [
  { type: 'PHOTO', icon: '🤝', title: 'Conoce una nueva Rama', description: 'Encuentra a alguien de una Rama diferente a la tuya y tómense una foto juntos.', points: 20, category: 'Networking' },
  { type: 'AR', icon: '🐱', title: 'Encuentra a Watt', description: 'Abre la cámara, coloca a Watt y tómate una foto con él.', points: 15, category: 'Watt' },
  { type: 'QR', icon: '📍', title: 'Checkpoint: Registro', description: 'Busca el código QR en la mesa de registro y escanéalo.', points: 10, category: 'Exploración', requiresApproval: false },
  { type: 'PHOTO', icon: '🎤', title: 'Selfie con un ponente', description: 'Tómate una foto con alguno de los ponentes del evento.', points: 30, category: 'Networking' },
  { type: 'PHOTO', icon: '🧑‍🤝‍🧑', title: 'Foto grupal de tu Rama', description: 'Reúne al menos a 5 personas de tu Rama para una foto.', points: 25, category: 'Equipo', maxCompletions: 40 },
  { type: 'QR', icon: '🔒', title: 'Checkpoint secreto', description: 'Hay un QR escondido en el lugar. ¿Lo encontrarás?', points: 40, category: 'Exploración', visibility: 'secret', requiresApproval: false },
]

db.tx(() => {
  db.run(`DELETE FROM events WHERE slug = 'demo'`)
  const eventId = Number(
    db.run(
      `INSERT INTO events (slug, name, description, status, join_code, levels, settings, created_at)
       VALUES ('demo', 'SAC Quest Demo', 'Evento de prueba', 'open', :code, :levels, :settings, :t)`,
      { code: randomCode(6), levels: JSON.stringify(DEFAULT_LEVELS), settings: JSON.stringify(DEFAULT_SETTINGS), t },
    ).lastInsertRowid,
  )
  for (const name of TEAMS) db.run('INSERT INTO teams (event_id, name) VALUES (:eventId, :name)', { eventId, name })

  const ids = []
  CHALLENGES.forEach((ch, i) => {
    ids.push(
      Number(
        db.run(
          `INSERT INTO challenges (event_id, type, title, description, icon, points, category, status,
              visibility, max_completions, requires_approval, requires_photo, qr_code, sort_order, created_at, updated_at)
           VALUES (:eventId, :type, :title, :description, :icon, :points, :category, 'active',
              :visibility, :maxCompletions, :requiresApproval, :requiresPhoto, :qrCode, :i, :t, :t)`,
          {
            eventId,
            ...ch,
            visibility: ch.visibility ?? 'visible',
            requiresApproval: ch.requiresApproval ?? true,
            requiresPhoto: ch.type !== 'QR',
            qrCode: ch.type === 'QR' ? randomCode(6) : null,
            i,
            t,
          },
        ).lastInsertRowid,
      ),
    )
  })
  // Un reto que se desbloquea al completar el primero.
  db.run(
    `INSERT INTO challenges (event_id, type, title, description, icon, points, category, status,
        unlock_rule, requires_approval, requires_photo, sort_order, created_at, updated_at)
     VALUES (:eventId, 'PHOTO', 'Tres Ramas, una foto', 'Ahora reúne a personas de tres Ramas distintas en una sola foto.',
        '🌐', 40, 'Networking', 'active', :rule, 1, 1, 99, :t, :t)`,
    { eventId, rule: JSON.stringify({ afterChallenges: [ids[0]] }), t },
  )
  DEFAULT_BADGES.forEach((b, i) =>
    db.run(
      `INSERT INTO badges (event_id, name, icon, description, rule, sort_order)
       VALUES (:eventId, :name, :icon, :description, :rule, :i)`,
      { eventId, ...b, rule: JSON.stringify(b.rule), i },
    ),
  )
})

const ev = db.get(`SELECT * FROM events WHERE slug = 'demo'`)
console.log(`Evento demo listo. Código: ${ev.join_code}`)
console.log(`  Entrar:  /e/demo?c=${ev.join_code}`)
for (const q of db.all(`SELECT title, qr_code FROM challenges WHERE event_id = :id AND qr_code IS NOT NULL`, { id: ev.id })) {
  console.log(`  QR «${q.title}»: /e/demo/q/${q.qr_code}`)
}
db.close()
