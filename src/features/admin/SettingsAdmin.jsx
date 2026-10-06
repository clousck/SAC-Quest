import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  addTeams,
  createBadge,
  createTeamGoal,
  deleteBadge,
  deleteEvent,
  deleteTeam,
  deleteTeamGoal,
  duplicateEvent,
  listBadges,
  listChallenges,
  listModerators,
  listTeamGoals,
  listTeams,
  setModerators,
  updateBadge,
  updateEvent,
  updateTeam,
  updateTeamGoal,
} from '../../api/admin'
import { useAsync } from '../../shared/useAsync'
import { ErrorBox } from '../quest/ui'
import { useAdmin, useEventAdmin } from './AdminContext'
import QrImage, { appHost, eventJoinUrl, fromLocalInput, hasPublicOrigin, toLocalInput } from './QrImage'

export default function SettingsAdmin() {
  const { isAdmin } = useAdmin()
  return (
    <section className="admin-page narrow">
      {!isAdmin && <p className="notice">Solo un administrador puede cambiar los ajustes.</p>}
      <StatusCard />
      <AccessCard />
      {isAdmin && <ModeratorsCard />}
      <EventCard />
      <TeamsCard />
      <PointTiersCard />
      <TeamScoreCard />
      <TeamGoalsCard />
      <LevelsCard />
      <BadgesCard />
      {isAdmin && <DuplicateCard />}
      {isAdmin && <DangerCard />}
    </section>
  )
}

function useSaver() {
  const { event, setEvent } = useEventAdmin()
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const save = async (body) => {
    setError(null)
    setSaved(false)
    try {
      const { event: updated } = await updateEvent(event.id, body)
      setEvent(updated)
      setSaved(true)
      return true
    } catch (e) {
      setError(e)
      return false
    }
  }
  return { save, error, saved }
}

function StatusCard() {
  const { event } = useEventAdmin()
  const { isAdmin } = useAdmin()
  const { save, error } = useSaver()
  const setStatus = (status, question) => () => (!question || window.confirm(question)) && save({ status })

  return (
    <div className="card">
      <h3>Estado del evento</h3>
      {event.status === 'draft' && <p>📝 En borrador: los participantes aún no pueden entrar. Prepara retos y Ramas, y ábrelo el día del evento.</p>}
      {event.status === 'open' && <p>🟢 Abierto: se puede entrar y completar retos.</p>}
      {event.status === 'closed' && <p>🏁 Cerrado: no se aceptan nuevos participantes ni envíos. El ranking queda congelado y la galería sigue visible.</p>}
      {isAdmin && (
        <div className="row">
          {event.status !== 'open' && (
            <button className="btn primary" onClick={setStatus('open', event.status === 'closed' ? '¿Reabrir el evento?' : null)}>
              {event.status === 'closed' ? 'Reabrir evento' : 'Abrir evento'}
            </button>
          )}
          {event.status === 'open' && (
            <button className="btn danger" onClick={setStatus('closed', '¿Cerrar el evento? Ya no se aceptarán envíos.')}>
              Cerrar evento
            </button>
          )}
          {event.status !== 'draft' && (
            <button className="btn" onClick={setStatus('draft', '¿Volver a borrador? Los participantes no podrán entrar.')}>
              Pasar a borrador
            </button>
          )}
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  )
}

function AccessCard() {
  const { event } = useEventAdmin()
  const { isAdmin } = useAdmin()
  const { save, error } = useSaver()
  const url = eventJoinUrl(event)
  return (
    <div className="card qr-card">
      <h3>Acceso de participantes</h3>
      {!hasPublicOrigin() && (
        <p className="notice">
          El servidor no tiene <strong>APP_DOMAIN</strong> configurado: los QR usan la dirección de este navegador (
          {appHost()}). Configúralo en <code>server/.env</code> antes de imprimir.
        </p>
      )}
      <QrImage value={url} size={180} />
      <p className="code-text">{event.joinCode}</p>
      <p className="muted small break">{url}</p>
      <p className="muted small">
        El QR ya incluye el código. Sin QR, se entra en <strong>{appHost()}</strong> con el código. Solo quien lo
        tenga puede unirse y ver la galería.
      </p>
      <div className="row">
        <Link className="btn" to={`/admin/e/${event.id}/imprimir`}>
          🖨️ Imprimir QRs
        </Link>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(url)}>
          Copiar enlace
        </button>
        {isAdmin && (
          <button
            className="btn"
            onClick={() =>
              window.confirm('Los QR impresos con el código actual dejarán de servir para entrar. ¿Cambiar el código?') &&
              save({ regenerateJoinCode: true })
            }
          >
            Cambiar código
          </button>
        )}
      </div>
      <ErrorBox error={error} />
    </div>
  )
}

/** Que moderadores ven y moderan este evento. Los administradores ven todos. */
function ModeratorsCard() {
  const { event } = useEventAdmin()
  const { data, error, setData } = useAsync(() => listModerators(event.id), [event.id])
  const [actionError, setActionError] = useState(null)
  const list = data?.moderators ?? []

  const toggle = async (id, on) => {
    setActionError(null)
    const ids = list.filter((m) => (m.id === id ? on : m.assigned)).map((m) => m.id)
    try {
      setData(await setModerators(event.id, ids))
    } catch (e) {
      setActionError(e)
    }
  }

  return (
    <div className="card form">
      <h3>Moderadores de este evento</h3>
      <p className="muted small">
        Un moderador solo ve y modera los eventos donde está marcado. Los administradores ven todos. Las cuentas se crean en{' '}
        <Link to="/admin/usuarios">Usuarios</Link>.
      </p>
      <div className="check-list">
        {list.map((m) => (
          <label key={m.id} className="check">
            <input type="checkbox" checked={m.assigned} onChange={(e) => toggle(m.id, e.target.checked)} />
            <span>
              {m.name} <span className="muted small">@{m.username}</span>
              {!m.active && <span className="muted small"> · cuenta desactivada</span>}
            </span>
          </label>
        ))}
      </div>
      {data && !list.length && <p className="muted small">Todavía no hay cuentas de moderador.</p>}
      <ErrorBox error={error || actionError} />
    </div>
  )
}

function EventCard() {
  const { event } = useEventAdmin()
  const { isAdmin } = useAdmin()
  const { save, error, saved } = useSaver()
  const [f, setF] = useState(() => ({
    name: event.name,
    description: event.description,
    startsAt: toLocalInput(event.startsAt),
    endsAt: toLocalInput(event.endsAt),
    teamLabel: event.settings.teamLabel,
    accent: event.settings.accent,
    likes: event.settings.likes,
  }))
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    save({
      name: f.name,
      description: f.description,
      startsAt: fromLocalInput(f.startsAt),
      endsAt: fromLocalInput(f.endsAt),
      settings: { teamLabel: f.teamLabel, accent: f.accent, likes: f.likes },
    })
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h3>Datos del evento</h3>
      <fieldset disabled={!isAdmin}>
        <label>
          Nombre
          <input value={f.name} onChange={set('name')} required minLength={2} maxLength={80} />
        </label>
        <label>
          Descripción (se ve al entrar)
          <textarea value={f.description} onChange={set('description')} rows={2} maxLength={500} />
        </label>
        <div className="form-grid">
          <label>
            Inicio
            <input type="datetime-local" value={f.startsAt} onChange={set('startsAt')} />
          </label>
          <label>
            Fin
            <input type="datetime-local" value={f.endsAt} onChange={set('endsAt')} />
          </label>
          <label>
            Cómo se llama un equipo
            <input value={f.teamLabel} onChange={set('teamLabel')} maxLength={20} placeholder="Rama" />
          </label>
          <label>
            Color principal
            <input type="color" value={f.accent} onChange={set('accent')} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={f.likes} onChange={set('likes')} />
          <span>Permitir likes en la galería</span>
        </label>
      </fieldset>
      <ErrorBox error={error} />
      {isAdmin && (
        <div className="row">
          <button className="btn primary">Guardar</button>
          {saved && <span className="saved">✓ Guardado</span>}
        </div>
      )}
    </form>
  )
}

function TeamsCard() {
  const { event } = useEventAdmin()
  const { isAdmin } = useAdmin()
  const { data, error, setData } = useAsync(() => listTeams(event.id), [event.id])
  const [text, setText] = useState('')
  const [actionError, setActionError] = useState(null)
  const label = event.settings.teamLabel

  const run = async (fn) => {
    setActionError(null)
    try {
      setData(await fn())
    } catch (e) {
      setActionError(e)
    }
  }

  const add = (e) => {
    e.preventDefault()
    const names = text.split('\n').map((s) => s.trim()).filter(Boolean)
    if (names.length) run(() => addTeams(event.id, names)).then(() => setText(''))
  }

  return (
    <div className="card">
      <h3>
        {label}s ({data?.teams.length ?? 0})
      </h3>
      <p className="muted small">Se eligen al entrar y forman el ranking por {label}. Si no agregas ninguna, no se pregunta.</p>
      <ul className="team-list">
        {data?.teams.map((t) => (
          <li key={t.id}>
            <span>{t.name}</span>
            <span className="muted small">{t.members} personas</span>
            {isAdmin && (
              <span className="row">
                <button
                  className="btn small"
                  onClick={() => {
                    const name = window.prompt(`Nuevo nombre para «${t.name}»`, t.name)
                    if (name && name !== t.name) run(() => updateTeam(t.id, { name }))
                  }}
                >
                  Renombrar
                </button>
                <button
                  className="btn small"
                  onClick={() =>
                    window.confirm(
                      t.members ? `${t.members} personas quedarán sin ${label}. ¿Borrar «${t.name}»?` : `¿Borrar «${t.name}»?`,
                    ) && run(() => deleteTeam(t.id))
                  }
                >
                  Borrar
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <form className="form" onSubmit={add}>
          <label>
            Agregar (una por línea)
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={'Rama ESPOL\nRama EPN\nRama UCuenca'} />
          </label>
          <button className="btn">Agregar</button>
        </form>
      )}
      <ErrorBox error={error || actionError} />
    </div>
  )
}

/** Valores del puntaje por equipo: se ajustan por evento sin tocar codigo. */
function TeamScoreCard() {
  const { event } = useEventAdmin()
  const { isAdmin } = useAdmin()
  const { save, error, saved } = useSaver()
  const label = event.settings.teamLabel
  const [f, setF] = useState(() => {
    const ts = event.settings.teamScore
    const pct = (v) => (ts.performance ? Math.round((100 * v) / ts.performance) : 0)
    return {
      top: ts.top.map((w) => Math.round(w * 100)).join(', '),
      participation: pct(ts.participation),
      participationRef: ts.participationRef,
      collective: pct(ts.collective),
    }
  })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const challenges = useAsync(() => listChallenges(event.id), [event.id])
  const goals = useAsync(() => listTeamGoals(event.id), [event.id])

  // Maximos con lo que hay escrito en el formulario (mismo calculo que
  // teamRanking en el servidor): cambian al editar, antes de guardar.
  const weights = f.top
    .split(',')
    .map((w) => Number(w) / 100)
    .filter((w) => w > 0)
  // XP que puede juntar una persona: todos los retos publicados.
  const possible = (challenges.data?.challenges ?? []).filter((c) => c.status !== 'draft').reduce((sum, c) => sum + c.points, 0)
  const maxBest = Math.round(weights.reduce((a, b) => a + b, 0) * possible)
  const maxParticipation = Math.round((maxBest * (Number(f.participation) || 0)) / 100)
  const hasGoals = (goals.data?.goals.length ?? 0) > 0
  const maxCollective = hasGoals ? Math.round((maxBest * (Number(f.collective) || 0)) / 100) : 0

  const submit = (e) => {
    e.preventDefault()
    const { teamLabel, accent, likes } = event.settings
    save({
      settings: {
        teamLabel,
        accent,
        likes,
        // Se guardan como pesos frente a un desempeño de 100.
        teamScore: {
          performance: 100,
          participation: Number(f.participation),
          collective: Number(f.collective),
          participationRef: Number(f.participationRef),
          top: weights,
        },
      },
    })
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h3>XP por {label}</h3>
      <p className="muted small">
        Cómo se compara una {label} con otra. No cambia el XP de las personas, y los inscritos que no participan no suman.
      </p>
      <fieldset disabled={!isAdmin}>
        <div className="form-grid">
          <label>
            Cuánto aporta cada uno de los mejores (%)
            <input value={f.top} onChange={set('top')} placeholder="100, 60, 40, 25, 15" required />
            <MaxXp value={maxBest} />
          </label>
          <label>
            Bono de participación (% del máximo de los mejores)
            <input type="number" min="0" max="1000" value={f.participation} onChange={set('participation')} required />
            <MaxXp value={maxParticipation} note={`con ${f.participationRef} activos`} />
          </label>
          <label>
            Integrantes activos para el bono completo
            <input type="number" min="1" value={f.participationRef} onChange={set('participationRef')} required />
          </label>
          <label>
            Retos de {label} (% del máximo de los mejores)
            <input type="number" min="0" max="1000" value={f.collective} onChange={set('collective')} required />
            <MaxXp value={maxCollective} note={hasGoals ? 'cumpliéndolos todos' : 'aún no hay retos creados'} />
          </label>
        </div>
      </fieldset>
      <p className="max-total">
        Máximo total por {label}: <strong>{(maxBest + maxParticipation + maxCollective).toLocaleString('es-EC')} XP</strong>
        <span className="muted small"> · con los {possible} XP de los retos publicados hoy</span>
      </p>
      <p className="muted small">
        <strong>Mejores:</strong> el XP del mejor integrante cuenta completo y el de los siguientes, el porcentaje indicado.{' '}
        <strong>Participación:</strong> un bono que crece con cada integrante que tiene al menos un reto aprobado con puntos, cada vez un
        poco menos. <strong>Retos de {label}:</strong> ver abajo. Los dos porcentajes se miden frente a lo máximo que pueden sumar los
        mejores (todos ellos con todos los retos del evento).
      </p>
      <ErrorBox error={error} />
      {isAdmin && (
        <div className="row">
          <button className="btn primary">Guardar</button>
          {saved && <span className="saved">✓ Guardado</span>}
        </div>
      )}
    </form>
  )
}

/** Maximo de XP que puede dar un campo de «XP por Rama»; va debajo del campo. */
function MaxXp({ value, note }) {
  return (
    <span className="field-max">
      Máximo: <strong>{value.toLocaleString('es-EC')} XP</strong>
      {note && ` (${note})`}
    </span>
  )
}

/** Valores de reto: cada reto elige uno y de ahi salen sus puntos. */
function PointTiersCard() {
  const { event } = useEventAdmin()
  const { isAdmin } = useAdmin()
  const { save, error, saved } = useSaver()
  const [tiers, setTiers] = useState(event.settings.pointTiers)
  const set = (i, k) => (e) => setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, [k]: e.target.value } : t)))

  const submit = () => {
    const { teamLabel, accent, likes } = event.settings
    save({ settings: { teamLabel, accent, likes, pointTiers: tiers.map((t) => ({ ...t, points: Number(t.points) || 0 })) } })
  }

  return (
    <div className="card form">
      <h3>Valores de reto</h3>
      <p className="muted small">
        Cada reto elige un valor y de ahí salen sus puntos. Si cambias los puntos de un valor, cambian todos sus retos y también los
        puntos ya ganados con ellos.
      </p>
      <fieldset disabled={!isAdmin} className="levels">
        {tiers.map((t, i) => (
          <div key={i} className="row">
            <input value={t.name} onChange={set(i, 'name')} aria-label="Nombre del valor" maxLength={20} />
            <input type="number" min="0" value={t.points} onChange={set(i, 'points')} aria-label="Puntos" />
            <span className="muted small">XP</span>
            {tiers.length > 1 && (
              <button type="button" className="btn small" onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))}>
                ✕
              </button>
            )}
          </div>
        ))}
      </fieldset>
      {isAdmin && (
        <div className="row">
          {tiers.length < 8 && (
            <button type="button" className="btn small" onClick={() => setTiers((ts) => [...ts, { name: 'Nuevo valor', points: 30 }])}>
              + Valor
            </button>
          )}
          <button className="btn primary" onClick={submit}>
            Guardar valores
          </button>
          {saved && <span className="saved">✓ Guardado</span>}
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  )
}

const MAX_GOAL_MEMBERS = 5

/** Retos de equipo: dan puntos al equipo (no XP) cuando N integrantes completan un reto. */
function TeamGoalsCard() {
  const { event } = useEventAdmin()
  const { isAdmin } = useAdmin()
  const label = event.settings.teamLabel
  const goals = useAsync(() => listTeamGoals(event.id), [event.id])
  const challenges = useAsync(() => listChallenges(event.id), [event.id])
  const [editing, setEditing] = useState(null) // id o 'new'
  const [error, setError] = useState(null)
  const chList = challenges.data?.challenges ?? []
  const list = goals.data?.goals ?? []
  const totalPoints = list.reduce((sum, g) => sum + g.points, 0)

  const saveGoal = async (body) => {
    setError(null)
    try {
      const res = editing === 'new' ? await createTeamGoal(event.id, body) : await updateTeamGoal(editing, body)
      goals.setData(res)
      setEditing(null)
    } catch (e) {
      setError(e)
    }
  }

  return (
    <div className="card">
      <h3>Retos de {label}</h3>
      <p className="muted small">
        Se cumplen una sola vez, cuando varios integrantes distintos de la {label} completan un reto. Se reparten el XP de retos de{' '}
        {label} según su valor. Para una foto grupal, crea un reto de foto de 0 XP y pide 1 integrante.
      </p>
      <ul className="team-list">
        {list.map((g) =>
          editing === g.id ? (
            <li key={g.id}>
              <TeamGoalForm goal={g} challenges={chList} onSave={saveGoal} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={g.id}>
              <span>
                {g.icon} <strong>{g.name}</strong> · {Math.round((100 * g.points) / totalPoints)} %
                <br />
                <small className="muted">
                  {g.members} o más integrantes completan «{chList.find((c) => c.id === g.challengeId)?.title ?? '¿?'}»
                </small>
              </span>
              {isAdmin && (
                <span className="row">
                  <button className="btn small" onClick={() => setEditing(g.id)}>
                    Editar
                  </button>
                  <button
                    className="btn small"
                    onClick={async () => window.confirm(`¿Borrar «${g.name}»?`) && goals.setData(await deleteTeamGoal(g.id))}
                  >
                    Borrar
                  </button>
                </span>
              )}
            </li>
          ),
        )}
      </ul>
      {!list.length && <p className="muted small">Todavía no hay retos de {label}: nadie suma esa parte del XP.</p>}
      {editing === 'new' && <TeamGoalForm challenges={chList} onSave={saveGoal} onCancel={() => setEditing(null)} />}
      {isAdmin && editing !== 'new' && chList.length > 0 && (
        <button className="btn" onClick={() => setEditing('new')}>
          + Nuevo reto de {label}
        </button>
      )}
      <ErrorBox error={error || goals.error} />
    </div>
  )
}

function TeamGoalForm({ goal, challenges, onSave, onCancel }) {
  const [f, setF] = useState(() => ({
    name: goal?.name ?? '',
    icon: goal?.icon ?? '🤝',
    description: goal?.description ?? '',
    points: goal?.points ?? 10,
    members: goal?.members ?? 3,
    challengeId: goal?.challengeId ?? challenges[0]?.id ?? '',
  }))
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    onSave({ ...f, points: Number(f.points), members: Number(f.members), challengeId: Number(f.challengeId) })
  }

  return (
    <form className="form badge-form" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Icono
          <input value={f.icon} onChange={set('icon')} maxLength={16} required />
        </label>
        <label>
          Nombre
          <input value={f.name} onChange={set('name')} maxLength={60} required minLength={2} placeholder="Cinco con Watt" />
        </label>
      </div>
      <label>
        Descripción
        <input value={f.description} onChange={set('description')} maxLength={200} />
      </label>
      <div className="form-grid">
        <label>
          Reto a completar
          <select value={f.challengeId} onChange={set('challengeId')}>
            {challenges.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Integrantes (máx. {MAX_GOAL_MEMBERS})
          <input type="number" min="1" max={MAX_GOAL_MEMBERS} value={f.members} onChange={set('members')} required />
        </label>
        <label>
          Valor (frente a los demás)
          <input type="number" min="1" max="1000" value={f.points} onChange={set('points')} required />
        </label>
      </div>
      <div className="row">
        <button className="btn primary">Guardar</button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

function LevelsCard() {
  const { event } = useEventAdmin()
  const { isAdmin } = useAdmin()
  const { save, error, saved } = useSaver()
  const [levels, setLevels] = useState(event.levels)
  const set = (i, k) => (e) => setLevels((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)))

  return (
    <div className="card form">
      <h3>Niveles</h3>
      <p className="muted small">XP necesario para cada nivel. El primero siempre empieza en 0.</p>
      <fieldset disabled={!isAdmin} className="levels">
        {levels.map((l, i) => (
          <div key={i} className="row">
            <input value={l.name} onChange={set(i, 'name')} aria-label="Nombre del nivel" />
            <input
              type="number"
              min="0"
              value={l.minXp}
              onChange={set(i, 'minXp')}
              disabled={i === 0}
              aria-label="XP mínimo"
            />
            <span className="muted small">XP</span>
            {i > 0 && (
              <button type="button" className="btn small" onClick={() => setLevels((ls) => ls.filter((_, j) => j !== i))}>
                ✕
              </button>
            )}
          </div>
        ))}
      </fieldset>
      {isAdmin && (
        <div className="row">
          <button
            type="button"
            className="btn small"
            onClick={() => setLevels((ls) => [...ls, { name: 'Nuevo nivel', minXp: (Number(ls.at(-1)?.minXp) || 0) + 100 }])}
          >
            + Nivel
          </button>
          <button className="btn primary" onClick={() => save({ levels: levels.map((l) => ({ name: l.name, minXp: Number(l.minXp) || 0 })) })}>
            Guardar niveles
          </button>
          {saved && <span className="saved">✓ Guardado</span>}
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  )
}

const RULES = [
  ['count', 'Completar N retos'],
  ['xp', 'Llegar a N XP'],
  ['category', 'N retos de una categoría'],
  ['challengeType', 'N retos de un tipo'],
  ['challenge', 'Completar un reto concreto'],
  ['allOfType', 'Todos los retos de un tipo'],
]

function ruleText(rule, challenges) {
  switch (rule.type) {
    case 'count':
      return `Completar ${rule.n} reto(s)`
    case 'xp':
      return `Llegar a ${rule.n} XP`
    case 'category':
      return `${rule.n} reto(s) de «${rule.category}»`
    case 'challengeType':
      return `${rule.n} reto(s) ${rule.challengeType}`
    case 'challenge':
      return `Completar «${challenges.find((c) => c.id === rule.challengeId)?.title ?? '¿?'}»`
    case 'allOfType':
      return `Todos los retos ${rule.challengeType}`
    default:
      return rule.type
  }
}

function BadgesCard() {
  const { event } = useEventAdmin()
  const { isAdmin } = useAdmin()
  const badges = useAsync(() => listBadges(event.id), [event.id])
  const challenges = useAsync(() => listChallenges(event.id), [event.id])
  const [editing, setEditing] = useState(null) // id o 'new'
  const [error, setError] = useState(null)
  const chList = challenges.data?.challenges ?? []

  const saveBadge = async (body) => {
    setError(null)
    try {
      const res = editing === 'new' ? await createBadge(event.id, body) : await updateBadge(editing, body)
      badges.setData(res)
      setEditing(null)
    } catch (e) {
      setError(e)
    }
  }

  return (
    <div className="card">
      <h3>Logros (badges)</h3>
      <ul className="team-list">
        {badges.data?.badges.map((b) =>
          editing === b.id ? (
            <li key={b.id}>
              <BadgeForm badge={b} challenges={chList} onSave={saveBadge} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={b.id}>
              <span>
                {b.icon} <strong>{b.name}</strong>
                <br />
                <small className="muted">{ruleText(b.rule, chList)}</small>
              </span>
              {isAdmin && (
                <span className="row">
                  <button className="btn small" onClick={() => setEditing(b.id)}>
                    Editar
                  </button>
                  <button
                    className="btn small"
                    onClick={async () => window.confirm(`¿Borrar «${b.name}»?`) && badges.setData(await deleteBadge(b.id))}
                  >
                    Borrar
                  </button>
                </span>
              )}
            </li>
          ),
        )}
      </ul>
      {editing === 'new' && <BadgeForm challenges={chList} onSave={saveBadge} onCancel={() => setEditing(null)} />}
      {isAdmin && editing !== 'new' && (
        <button className="btn" onClick={() => setEditing('new')}>
          + Nuevo logro
        </button>
      )}
      <ErrorBox error={error || badges.error} />
    </div>
  )
}

function BadgeForm({ badge, challenges, onSave, onCancel }) {
  const [f, setF] = useState(() => ({
    name: badge?.name ?? '',
    icon: badge?.icon ?? '🏅',
    description: badge?.description ?? '',
    type: badge?.rule.type ?? 'count',
    n: badge?.rule.n ?? 1,
    category: badge?.rule.category ?? '',
    challengeType: badge?.rule.challengeType ?? 'PHOTO',
    challengeId: badge?.rule.challengeId ?? challenges[0]?.id ?? '',
  }))
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const needsN = ['count', 'xp', 'category', 'challengeType'].includes(f.type)

  const submit = (e) => {
    e.preventDefault()
    onSave({
      name: f.name,
      icon: f.icon,
      description: f.description,
      rule: {
        type: f.type,
        n: Number(f.n),
        category: f.category,
        challengeType: f.challengeType,
        challengeId: Number(f.challengeId),
      },
    })
  }

  return (
    <form className="form badge-form" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Icono
          <input value={f.icon} onChange={set('icon')} maxLength={16} required />
        </label>
        <label>
          Nombre
          <input value={f.name} onChange={set('name')} maxLength={40} required minLength={2} />
        </label>
      </div>
      <label>
        Descripción
        <input value={f.description} onChange={set('description')} maxLength={200} />
      </label>
      <div className="form-grid">
        <label>
          Se gana al…
          <select value={f.type} onChange={set('type')}>
            {RULES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {needsN && (
          <label>
            N
            <input type="number" min="1" value={f.n} onChange={set('n')} />
          </label>
        )}
        {f.type === 'category' && (
          <label>
            Categoría
            <input value={f.category} onChange={set('category')} required />
          </label>
        )}
        {(f.type === 'challengeType' || f.type === 'allOfType') && (
          <label>
            Tipo
            <select value={f.challengeType} onChange={set('challengeType')}>
              <option value="PHOTO">Foto</option>
              <option value="AR">AR</option>
              <option value="QR">QR</option>
            </select>
          </label>
        )}
        {f.type === 'challenge' && (
          <label>
            Reto
            <select value={f.challengeId} onChange={set('challengeId')}>
              {challenges.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="row">
        <button className="btn primary">Guardar</button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

function DuplicateCard() {
  const { event } = useEventAdmin()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    try {
      const { event: copy } = await duplicateEvent(event.id, { name, slug: slug || undefined })
      navigate(`/admin/e/${copy.id}/ajustes`)
    } catch (err) {
      setError(err)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h3>Duplicar evento</h3>
      <p className="muted small">
        Crea un evento nuevo con las mismas {event.settings.teamLabel}s, retos (en borrador), logros, niveles y ajustes. Sin
        participantes ni fotos. Ideal para reutilizar un evento en el siguiente.
      </p>
      <div className="form-grid">
        <label>
          Nombre del nuevo evento
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </label>
        <label>
          Identificador (opcional)
          <input value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>
      </div>
      <ErrorBox error={error} />
      <button className="btn">Duplicar</button>
    </form>
  )
}

function DangerCard() {
  const { event } = useEventAdmin()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    try {
      await deleteEvent(event.id, confirm)
      navigate('/admin')
    } catch (err) {
      setError(err)
    }
  }

  return (
    <form className="card form danger-zone" onSubmit={submit}>
      <h3>Borrar evento</h3>
      <p className="muted small">
        Borra para siempre el evento, sus participantes y todas sus fotos. Descarga antes el ZIP desde Galería si quieres
        conservarlas.
      </p>
      <label>
        Escribe «{event.slug}» para confirmar
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
      </label>
      <ErrorBox error={error} />
      <button className="btn danger" disabled={confirm !== event.slug}>
        Borrar evento
      </button>
    </form>
  )
}
