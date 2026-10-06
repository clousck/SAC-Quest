import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { createEvent, listEvents } from '../../api/admin'
import { useAsync } from '../../shared/useAsync'
import { ErrorBox, Spinner } from '../quest/ui'
import { useAdmin } from './AdminContext'

export const EVENT_STATUS = { draft: 'Borrador', open: 'Abierto', closed: 'Cerrado' }

export default function EventsList() {
  const { isAdmin } = useAdmin()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useAsync(listEvents, [])
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState(null)

  const create = async (e) => {
    e.preventDefault()
    setBusy(true)
    setCreateError(null)
    try {
      const { event } = await createEvent({ name, slug: slug || undefined })
      navigate(`/admin/e/${event.id}/ajustes`)
    } catch (err) {
      setCreateError(err)
      setBusy(false)
    }
  }

  return (
    <section className="admin-page">
      <h1>Eventos</h1>
      <ErrorBox error={error} retry={reload} />
      {loading && !data && <Spinner />}
      {data && (
        <ul className="event-list">
          {data.events.map((ev) => (
            <li key={ev.id}>
              <Link to={`/admin/e/${ev.id}`} className="card event-card">
                <div>
                  <h2>{ev.name}</h2>
                  <p className="muted small">
                    /e/{ev.slug} · código {ev.joinCode}
                  </p>
                </div>
                <div className="event-card-side">
                  <span className={`pill st-${ev.status}`}>{EVENT_STATUS[ev.status]}</span>
                  <span className="muted small">
                    {ev.counts.participants} participantes · {ev.counts.challenges} retos
                  </span>
                  {ev.counts.pending > 0 && <span className="pill warn">{ev.counts.pending} por revisar</span>}
                </div>
              </Link>
            </li>
          ))}
          {!data.events.length && (
            <p className="empty">
              {isAdmin ? 'Todavía no hay eventos.' : 'Todavía no tienes eventos asignados. Pídele a un administrador que te agregue.'}
            </p>
          )}
        </ul>
      )}

      {isAdmin && (
        <form className="card form" onSubmit={create}>
          <h2>Nuevo evento</h2>
          <div className="form-grid">
            <label>
              Nombre
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="SAC Quest 2027" required minLength={2} />
            </label>
            <label>
              Identificador en la URL (opcional)
              <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="sacquest2027" />
            </label>
          </div>
          <p className="muted small">
            Se crea en borrador con niveles y logros por defecto. Para copiar retos y Ramas de otro evento, usa
            «Duplicar» en sus ajustes.
          </p>
          <ErrorBox error={createError} />
          <button className="btn primary" disabled={busy}>
            Crear evento
          </button>
        </form>
      )}
    </section>
  )
}
