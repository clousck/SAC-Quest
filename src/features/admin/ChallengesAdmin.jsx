import { Link } from 'react-router'
import { listChallenges, reorderChallenges, updateChallenge } from '../../api/admin'
import { useAsync } from '../../shared/useAsync'
import { DIFFICULTY_LABEL, ErrorBox, Spinner, TYPE_LABEL } from '../quest/ui'
import { useAdmin, useEventAdmin } from './AdminContext'

export const CH_STATUS = { draft: 'Borrador', active: 'Activo', inactive: 'Inactivo' }

// Checkpoints y encuestas se abren y cierran en el momento (una charla, un QR escondido).
const TIMED = ['QR', 'TRIVIA']
const hour = (iso) => new Date(iso).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })

/** Estado segun el horario: abierto, cerrado o por abrir. */
function timeState(c, now = Date.now()) {
  if (c.availableUntil && now > new Date(c.availableUntil).getTime()) return { closed: true, text: `Cerrado a las ${hour(c.availableUntil)}` }
  if (c.availableFrom && now < new Date(c.availableFrom).getTime()) return { closed: false, text: `Abre a las ${hour(c.availableFrom)}` }
  return { closed: false, text: c.availableUntil ? `Abierto hasta las ${hour(c.availableUntil)}` : '' }
}

export default function ChallengesAdmin() {
  const { event } = useEventAdmin()
  const { isAdmin } = useAdmin()
  const { data, error, loading, reload, setData } = useAsync(() => listChallenges(event.id), [event.id])
  const list = data?.challenges ?? []
  const base = `/admin/e/${event.id}`

  const toggle = async (ch) => {
    const status = ch.status === 'active' ? 'inactive' : 'active'
    const { challenge } = await updateChallenge(ch.id, { status })
    setData((d) => ({ challenges: d.challenges.map((c) => (c.id === ch.id ? challenge : c)) }))
  }

  const patch = async (ch, body) => {
    const { challenge } = await updateChallenge(ch.id, body)
    setData((d) => ({ challenges: d.challenges.map((c) => (c.id === ch.id ? challenge : c)) }))
  }
  // "Cerrar ahora" pone el fin del horario: el reto sigue visible, pero ya nadie puede completarlo.
  const closeNow = (ch) => patch(ch, { availableFrom: null, availableUntil: new Date().toISOString() })
  const openNow = (ch) => patch(ch, { availableFrom: null, availableUntil: null })
  const openFor = (ch) => {
    const minutes = Number(window.prompt('¿Cuántos minutos queda abierto?', '10'))
    if (minutes > 0) patch(ch, { availableFrom: null, availableUntil: new Date(Date.now() + minutes * 60_000).toISOString() })
  }

  const move = async (index, delta) => {
    const next = [...list]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    setData({ challenges: next })
    await reorderChallenges(event.id, next.map((c) => c.id)).catch(reload)
  }

  return (
    <section className="admin-page">
      <div className="toolbar">
        <h2>Retos ({list.length})</h2>
        {isAdmin && (
          <div className="row">
            {list.some((c) => TIMED.includes(c.type)) && (
              <Link className="btn" to={`${base}/imprimir`}>
                🖨️ Imprimir QRs
              </Link>
            )}
            <Link className="btn primary" to={`${base}/retos/nuevo`}>
              + Nuevo reto
            </Link>
          </div>
        )}
      </div>
      <ErrorBox error={error} retry={reload} />
      {loading && !data && <Spinner />}

      <ul className="admin-list">
        {list.map((c, i) => (
          <li key={c.id} className={`card ch-row st-${c.status}`}>
            {isAdmin && (
              <div className="order-btns">
                <button className="btn small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                  ↑
                </button>
                <button className="btn small" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">
                  ↓
                </button>
              </div>
            )}
            <span className="ch-icon">{c.icon || '⭐'}</span>
            <div className="ch-row-body">
              <Link to={`${base}/retos/${c.id}`}>
                <strong>{c.title}</strong>
              </Link>
              <span className="muted small">
                {TYPE_LABEL[c.type]} · {c.points} XP · {DIFFICULTY_LABEL[c.difficulty]}
                {c.category && ` · ${c.category}`}
                {c.visibility === 'secret' && ' · 🤫 secreto'}
                {c.unlockRule && ' · 🔒 con desbloqueo'}
                {c.requiresApproval ? ' · 👀 revisión' : ' · ⚡ automático'}
              </span>
              <span className="muted small">
                ✓ {c.counts.approved} · ⏳ {c.counts.pending} · ✕ {c.counts.rejected}
                {c.maxCompletions && ` · cupo ${c.maxCompletions}`}
              </span>
              {c.status === 'active' && timeState(c).text && (
                <span className={timeState(c).closed ? 'muted small' : 'small ok-text'}>🕒 {timeState(c).text}</span>
              )}
              {c.type === 'TRIVIA' && (
                <Link className="small" to={`${base}/retos/${c.id}/resultados`}>
                  📊 Ver resultados
                </Link>
              )}
            </div>
            <div className="ch-row-side">
              <span className={`pill st-${c.status}`}>{CH_STATUS[c.status]}</span>
              {isAdmin && c.status === 'active' && TIMED.includes(c.type) && (
                <div className="row">
                  {timeState(c).closed ? (
                    <button className="btn small" onClick={() => openNow(c)}>
                      Abrir ahora
                    </button>
                  ) : (
                    <button className="btn small" onClick={() => closeNow(c)}>
                      Cerrar ahora
                    </button>
                  )}
                  <button className="btn small" onClick={() => openFor(c)}>
                    Abrir X min
                  </button>
                </div>
              )}
              {isAdmin && (
                <button className="btn small" onClick={() => toggle(c)}>
                  {c.status === 'active' ? 'Desactivar' : 'Activar'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!loading && !list.length && <p className="empty">Crea el primer reto del evento.</p>}
    </section>
  )
}
