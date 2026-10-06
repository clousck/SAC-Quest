import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Esquema. Cada entrada de MIGRATIONS se aplica una sola vez, en orden
 * (PRAGMA user_version guarda cuantas se aplicaron). Para cambiar el
 * esquema se agrega una entrada nueva; nunca se edita una ya publicada.
 */
const MIGRATIONS = [
  `
  CREATE TABLE events (
    id           INTEGER PRIMARY KEY,
    slug         TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
    join_code    TEXT NOT NULL UNIQUE,
    starts_at    TEXT,
    ends_at      TEXT,
    levels       TEXT NOT NULL DEFAULT '[]',
    settings     TEXT NOT NULL DEFAULT '{}',
    created_at   TEXT NOT NULL
  );

  CREATE TABLE teams (
    id          INTEGER PRIMARY KEY,
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    short_name  TEXT NOT NULL DEFAULT '',
    UNIQUE (event_id, name)
  );

  CREATE TABLE participants (
    id             INTEGER PRIMARY KEY,
    event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    team_id        INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    alias          TEXT NOT NULL,
    alias_key      TEXT NOT NULL,
    token_hash     TEXT NOT NULL UNIQUE,
    recovery_code  TEXT NOT NULL,
    banned         INTEGER NOT NULL DEFAULT 0,
    consent_at     TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    UNIQUE (event_id, alias_key),
    UNIQUE (event_id, recovery_code)
  );

  CREATE TABLE challenges (
    id                 INTEGER PRIMARY KEY,
    event_id           INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    type               TEXT NOT NULL CHECK (type IN ('PHOTO', 'AR', 'QR', 'TRIVIA', 'TEXT')),
    title              TEXT NOT NULL,
    description        TEXT NOT NULL DEFAULT '',
    icon               TEXT NOT NULL DEFAULT '',
    image_key          TEXT,
    points             INTEGER NOT NULL DEFAULT 10,
    category           TEXT NOT NULL DEFAULT '',
    difficulty         TEXT NOT NULL DEFAULT 'easy' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive')),
    visibility         TEXT NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible', 'secret')),
    unlock_rule        TEXT,
    available_from     TEXT,
    available_until    TEXT,
    max_completions    INTEGER,
    requires_approval  INTEGER NOT NULL DEFAULT 1,
    requires_photo     INTEGER NOT NULL DEFAULT 1,
    config             TEXT NOT NULL DEFAULT '{}',
    qr_code            TEXT UNIQUE,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  );
  CREATE INDEX challenges_event ON challenges(event_id, sort_order);

  CREATE TABLE admins (
    id             INTEGER PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'moderator' CHECK (role IN ('admin', 'moderator')),
    active         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE admin_sessions (
    token_hash  TEXT PRIMARY KEY,
    admin_id    INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    expires_at  TEXT NOT NULL
  );

  CREATE TABLE submissions (
    id              INTEGER PRIMARY KEY,
    event_id        INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    challenge_id    INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    participant_id  INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    status          TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    points_awarded  INTEGER NOT NULL DEFAULT 0,
    answer          TEXT,
    reject_reason   TEXT,
    reviewed_by     INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    reviewed_at     TEXT,
    client_id       TEXT,
    created_at      TEXT NOT NULL,
    UNIQUE (participant_id, client_id)
  );
  CREATE INDEX submissions_event_status ON submissions(event_id, status);
  CREATE INDEX submissions_participant ON submissions(participant_id, status);
  CREATE INDEX submissions_challenge ON submissions(challenge_id, status);

  CREATE TABLE photos (
    id             INTEGER PRIMARY KEY,
    submission_id  INTEGER NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
    event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    key            TEXT NOT NULL,
    thumb_key      TEXT NOT NULL,
    width          INTEGER NOT NULL DEFAULT 0,
    height         INTEGER NOT NULL DEFAULT 0,
    bytes          INTEGER NOT NULL DEFAULT 0,
    captured_with  TEXT NOT NULL DEFAULT 'camera' CHECK (captured_with IN ('camera', 'ar', 'upload')),
    created_at     TEXT NOT NULL
  );
  CREATE INDEX photos_event ON photos(event_id, id);

  CREATE TABLE likes (
    photo_id        INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    participant_id  INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (photo_id, participant_id)
  );

  CREATE TABLE badges (
    id           INTEGER PRIMARY KEY,
    event_id     INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    icon         TEXT NOT NULL DEFAULT '🏅',
    description  TEXT NOT NULL DEFAULT '',
    rule         TEXT NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0
  );
  `,
  // Aprobacion fija por tipo: los checkpoints QR se aprueban solos (se
  // aprueban sus envios pendientes) y las fotos y el AR siempre pasan por un
  // moderador (lo ya aprobado se respeta).
  `
  UPDATE challenges SET requires_approval = 0 WHERE type = 'QR';
  UPDATE challenges SET requires_approval = 1 WHERE type IN ('PHOTO', 'AR');
  UPDATE submissions
     SET status = 'approved',
         points_awarded = (SELECT points FROM challenges c WHERE c.id = submissions.challenge_id),
         reviewed_at = created_at
   WHERE status = 'pending'
     AND challenge_id IN (SELECT id FROM challenges WHERE type = 'QR');
  `,
  // Retos de Rama: se cumplen cuando `members` integrantes distintos tienen
  // aprobado el reto. Dan puntos al Score de la Rama, no XP a las personas.
  `
  CREATE TABLE team_goals (
    id            INTEGER PRIMARY KEY,
    event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    icon          TEXT NOT NULL DEFAULT '🤝',
    description   TEXT NOT NULL DEFAULT '',
    points        INTEGER NOT NULL DEFAULT 10,
    challenge_id  INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    members       INTEGER NOT NULL DEFAULT 3,
    sort_order    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX team_goals_event ON team_goals(event_id, sort_order);
  `,
  // Valor del reto (tier, definido en los ajustes del evento) y avisos de los
  // organizadores. De paso se igualan los puntos ya otorgados al valor actual
  // de cada reto: quedaban desfasados si el reto se editaba despues.
  `
  ALTER TABLE challenges ADD COLUMN tier TEXT;

  CREATE TABLE announcements (
    id          INTEGER PRIMARY KEY,
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    text        TEXT NOT NULL,
    created_by  INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX announcements_event ON announcements(event_id, id);

  UPDATE submissions
     SET points_awarded = (SELECT points FROM challenges c WHERE c.id = submissions.challenge_id)
   WHERE status = 'approved'
     AND (answer IS NULL OR json_extract(answer, '$.passed'));
  `,
  // Moderadores por evento: un moderador solo ve los eventos donde esta
  // asignado (los admin ven todos). Los que ya existian conservan el acceso a
  // los eventos que ya habia.
  `
  CREATE TABLE event_moderators (
    event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    admin_id  INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, admin_id)
  );
  INSERT INTO event_moderators (event_id, admin_id)
    SELECT e.id, a.id FROM events e, admins a WHERE a.role = 'moderator';
  `,
  // Apertura y cierre programados (ver schedule.js): cada fecha se dispara una
  // sola vez. Las fechas que ya pasaron se dan por disparadas, para que esta
  // migracion no abra ni cierre ningun evento existente.
  `
  ALTER TABLE events ADD COLUMN start_fired_at TEXT;
  ALTER TABLE events ADD COLUMN end_fired_at TEXT;
  UPDATE events SET start_fired_at = starts_at WHERE starts_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
  UPDATE events SET end_fired_at = ends_at WHERE ends_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
  `,
  // Roles nuevos del panel: revisor (solo aprueba/rechaza fotos) y editor
  // (retos y participantes). `admins.role` tiene un CHECK que SQLite no deja
  // cambiar sin rehacer la tabla, asi que el rol fino va en otra columna:
  // role = 'moderator' + staff_role = 'reviewer' | 'editor' (ver roleOf).
  `
  ALTER TABLE admins ADD COLUMN staff_role TEXT;
  `,
  // El rol editor duro un dia: se unio al de moderador, que ahora tambien
  // crea y edita retos. Las cuentas que lo tenian pasan a moderador.
  `
  UPDATE admins SET staff_role = NULL WHERE staff_role = 'editor';
  `,
]

function migrate(db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get()
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[i])
      db.exec(`PRAGMA user_version = ${i + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}

// node:sqlite rechaza claves que no estan en la consulta, booleanos y
// undefined. Se normaliza aca para poder pasar objetos "de dominio".
function bindFor(sql) {
  const names = [...new Set([...sql.matchAll(/[:$@]([A-Za-z_]\w*)/g)].map((m) => m[1]))]
  return (params) => {
    const out = {}
    for (const n of names) {
      const v = params[n]
      out[n] = v === undefined ? null : typeof v === 'boolean' ? Number(v) : v
    }
    return out
  }
}

/**
 * Abre (o crea) la base. Devuelve un envoltorio pequeño con consultas
 * preparadas en cache. Todas las operaciones son sincronicas: dentro de
 * un tx() ninguna otra peticion puede intercalarse.
 */
export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `)
  migrate(db)

  const cache = new Map()
  const prep = (sql) => {
    let entry = cache.get(sql)
    if (!entry) {
      entry = { stmt: db.prepare(sql), bind: bindFor(sql) }
      cache.set(sql, entry)
    }
    return entry
  }
  const call = (method) => (sql, params = {}) => {
    const { stmt, bind } = prep(sql)
    return stmt[method](bind(params))
  }

  let depth = 0
  return {
    raw: db,
    get: call('get'),
    all: call('all'),
    run: call('run'),
    tx(fn) {
      if (depth > 0) return fn()
      db.exec('BEGIN IMMEDIATE')
      depth++
      try {
        const result = fn()
        db.exec('COMMIT')
        return result
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      } finally {
        depth--
      }
    },
    close: () => db.close(),
  }
}

export const now = () => new Date().toISOString()

export function parseJson(text, fallback) {
  if (text == null || text === '') return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}
