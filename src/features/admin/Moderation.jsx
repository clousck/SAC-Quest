import { useCallback, useEffect, useState } from 'react'
import { mediaUrl } from '../../api/client'
import { deleteSubmission, listChallenges, listSubmissions, reviewSubmission } from '../../api/admin'
import { useAsync } from '../../shared/useAsync'
import { ErrorBox, Spinner, formatWhen } from '../quest/ui'
import { useEventAdmin } from './AdminContext'

const REASONS = ['No cumple el reto', 'Foto borrosa u oscura', 'Foto repetida', 'Contenido inapropiado']
const STATUS_TABS = [
  ['pending', 'Pendientes'],
  ['approved', 'Aprobadas'],
  ['rejected', 'Rechazadas'],
]

/**
 * Cola de moderacion. En "Pendientes" se muestra una foto grande a la vez,
 * de la mas antigua a la mas nueva: A aprueba, R rechaza (tambien en el
 * telefono, con los botones grandes). Varios moderadores pueden trabajar a
 * la vez: si otro ya decidio, el cambio simplemente se sobrescribe.
 */
export default function Moderation() {
  const { event, setPending } = useEventAdmin()
  const [status, setStatus] = useState('pending')
  const [challengeId, setChallengeId] = useState('')
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const challenges = useAsync(() => listChallenges(event.id), [event.id])

  const load = useCallback(
    async (from = null) => {
      setLoading(true)
      setError(null)
      try {
        const res = await listSubmissions(event.id, { status, challengeId, cursor: from })
        setItems((prev) => (from ? [...prev, ...res.items] : res.items))
        setCursor(res.nextCursor)
        setPending(res.pending)
      } catch (e) {
        setError(e)
      } finally {
        setLoading(false)
      }
    },
    [event.id, status, challengeId, setPending],
  )

  useEffect(() => {
    load()
  }, [load])

  // Busca nuevas fotos pendientes cada 20 s mientras la cola esta vacia.
  useEffect(() => {
    if (status !== 'pending' || items.length) return
    const id = setInterval(() => document.visibilityState === 'visible' && load(), 20_000)
    return () => clearInterval(id)
  }, [status, items.length, load])

  const decide = async (item, decision, extra = {}) => {
    try {
      const res = await reviewSubmission(item.id, { decision, ...extra })
      setPending(res.pending)
      if (status === 'pending' || res.submission.status !== status) {
        setItems((list) => list.filter((x) => x.id !== item.id))
      } else {
        setItems((list) => list.map((x) => (x.id === item.id ? res.submission : x)))
      }
    } catch (e) {
      setError(e)
    }
  }

  const remove = async (item) => {
    if (!window.confirm('¿Borrar este envío y su foto para siempre? La persona pierde los puntos.')) return
    try {
      const res = await deleteSubmission(item.id)
      setPending(res.pending)
      setItems((list) => list.filter((x) => x.id !== item.id))
    } catch (e) {
      setError(e)
    }
  }

  // Si quedan pocas en la cola, traer mas.
  useEffect(() => {
    if (status === 'pending' && items.length < 3 && cursor && !loading) load(cursor)
  }, [status, items.length, cursor, loading, load])

  return (
    <section className="admin-page">
      <div className="toolbar">
        <div className="segmented">
          {STATUS_TABS.map(([value, label]) => (
            <button key={value} className={status === value ? 'on' : ''} onClick={() => setStatus(value)}>
              {label}
            </button>
          ))}
        </div>
        <select value={challengeId} onChange={(e) => setChallengeId(e.target.value)} aria-label="Filtrar por reto">
          <option value="">Todos los retos</option>
          {challenges.data?.challenges.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.title}
            </option>
          ))}
        </select>
      </div>

      <ErrorBox error={error} retry={() => load()} />

      {status === 'pending' ? (
        items.length ? (
          <ReviewCard key={items[0].id} item={items[0]} onDecide={decide} onDelete={remove} queued={items.length - 1} />
        ) : loading ? (
          <Spinner />
        ) : (
          <p className="empty">🎉 No hay fotos por revisar. Esta pantalla se actualiza sola.</p>
        )
      ) : (
        <>
          <div className="sub-grid">
            {items.map((item) => (
              <SubmissionTile key={item.id} item={item} onDecide={decide} onDelete={remove} />
            ))}
          </div>
          {loading && <Spinner />}
          {!loading && !items.length && <p className="empty">No hay envíos aquí.</p>}
          {cursor && !loading && (
            <button className="btn block" onClick={() => load(cursor)}>
              Cargar más
            </button>
          )}
        </>
      )}
    </section>
  )
}

function ReviewCard({ item, onDecide, onDelete, queued }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const act = async (decision, extra) => {
    setBusy(true)
    await onDecide(item, decision, extra)
    setBusy(false)
  }
  const approve = () => act('approve')
  const reject = (r = reason) => act('reject', { reason: r || null })

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select') || busy) return
      if (e.key === 'a' || e.key === 'A') approve()
      if (e.key === 'r' || e.key === 'R') setRejecting(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="review">
      <div className="review-photo">
        {item.photo ? (
          <a href={mediaUrl(item.photo.url)} target="_blank" rel="noreferrer">
            <img src={mediaUrl(item.photo.url)} alt="Foto por revisar" />
          </a>
        ) : (
          <div className="no-photo big">{item.challenge.icon || '📍'} Sin foto</div>
        )}
      </div>
      <div className="review-side">
        <p className="muted small">{queued > 0 ? `${queued} más en la cola` : 'Última de la cola'}</p>
        <h2>
          {item.challenge.icon} {item.challenge.title}
        </h2>
        <p>
          <strong>{item.participant.alias}</strong>
          {item.participant.team && <span className="muted"> · {item.participant.team}</span>}
        </p>
        <p className="muted small">
          Enviada {formatWhen(item.createdAt)}
          {item.photo && ` · ${item.photo.capturedWith === 'ar' ? 'AR con Watt' : item.photo.capturedWith === 'upload' ? 'desde galería' : 'cámara'}`}
        </p>

        {!rejecting ? (
          <>
            <p className="points">+{item.challenge.points} XP</p>
            <button className="btn primary block big" onClick={approve} disabled={busy}>
              ✓ Aprobar <kbd>A</kbd>
            </button>
            <button className="btn block big reject" onClick={() => setRejecting(true)} disabled={busy}>
              ✕ Rechazar <kbd>R</kbd>
            </button>
          </>
        ) : (
          <div className="reject-box">
            <p>¿Por qué? (la persona verá el motivo)</p>
            <div className="reason-chips">
              {REASONS.map((r) => (
                <button key={r} className="btn small" onClick={() => reject(r)} disabled={busy}>
                  {r}
                </button>
              ))}
            </div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Otro motivo…" maxLength={200} />
            <div className="row">
              <button className="btn danger" onClick={() => reject()} disabled={busy}>
                Rechazar
              </button>
              <button className="btn" onClick={() => setRejecting(false)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
        <button className="link-btn" onClick={() => onDelete(item)}>
          Borrar definitivamente
        </button>
      </div>
    </div>
  )
}

function SubmissionTile({ item, onDecide, onDelete }) {
  return (
    <div className="sub-tile card">
      {item.photo ? (
        <a href={mediaUrl(item.photo.url)} target="_blank" rel="noreferrer">
          <img src={mediaUrl(item.photo.thumbUrl)} alt="" loading="lazy" />
        </a>
      ) : (
        <div className="no-photo">{item.challenge.icon || '📍'}</div>
      )}
      <div className="sub-tile-body">
        <strong>{item.participant.alias}</strong>
        <span className="muted small">
          {item.challenge.icon} {item.challenge.title}
        </span>
        {item.status === 'approved' && <span className="points">+{item.pointsAwarded} XP</span>}
        {item.rejectReason && <span className="muted small">«{item.rejectReason}»</span>}
        {item.reviewer && <span className="muted small">por {item.reviewer}</span>}
      </div>
      <div className="row">
        {item.status === 'approved' ? (
          <button className="btn small" onClick={() => onDecide(item, 'reject', { reason: null })}>
            Rechazar
          </button>
        ) : (
          <button className="btn small" onClick={() => onDecide(item, 'approve')}>
            Aprobar
          </button>
        )}
        <button className="btn small" onClick={() => onDelete(item)} aria-label="Borrar">
          🗑️
        </button>
      </div>
    </div>
  )
}
