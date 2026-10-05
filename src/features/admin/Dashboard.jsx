import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { deleteAnnouncement, getStats, listAnnouncements, sendAnnouncement } from '../../api/admin'
import { useAsync } from '../../shared/useAsync'
import { ErrorBox, Spinner, TYPE_EMOJI } from '../quest/ui'
import { useEventAdmin } from './AdminContext'
import { CH_STATUS } from './ChallengesAdmin'

const nf = new Intl.NumberFormat('es-EC')
const compact = new Intl.NumberFormat('es-EC', { notation: 'compact', maximumFractionDigits: 1 })
const fmt = (n) => (n >= 10000 ? compact.format(n) : nf.format(n))

export default function Dashboard() {
  const { event, pending } = useEventAdmin()
  const { data, error, loading, reload } = useAsync(() => getStats(event.id), [event.id])

  // Durante el evento, el resumen se actualiza solo cada 30 s.
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && reload(), 30_000)
    return () => clearInterval(id)
  }, [reload])

  if (error) return <section className="admin-page"><ErrorBox error={error} retry={reload} /></section>
  if (loading && !data) return <Spinner />
  const t = data.totals
  const base = `/admin/e/${event.id}`

  return (
    <section className="admin-page">
      <div className="kpis">
        <StatTile label="Participantes" value={t.participants} note={`${fmt(t.active)} con al menos un envío`} />
        <StatTile label="Por revisar" value={pending} note={pending > 0 ? <Link to={`${base}/moderar`}>Ir a moderar →</Link> : 'Todo al día'} />
        <StatTile label="Aprobadas" value={t.approved} note={`${fmt(t.rejected)} rechazadas`} />
        <StatTile label="Fotos" value={t.photos} note={`${(t.bytes / 1024 / 1024).toFixed(1)} MB en disco`} />
        <StatTile label="Likes" value={t.likes} />
      </div>

      <Announcements />

      <div className="card">
        <h3>Envíos por hora</h3>
        <HourlyColumns rows={data.byHour} />
      </div>

      <div className="card">
        <h3>Por reto</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Reto</th>
                <th>Estado</th>
                <th className="num">Aprobadas</th>
                <th className="num">Pendientes</th>
                <th className="num">Rechazadas</th>
                <th className="bar-col">Participación</th>
              </tr>
            </thead>
            <tbody>
              {data.byChallenge.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`${base}/retos/${c.id}`}>
                      {TYPE_EMOJI[c.type]} {c.title}
                    </Link>
                  </td>
                  <td>{CH_STATUS[c.status]}</td>
                  <td className="num">{fmt(c.approved)}</td>
                  <td className="num">{fmt(c.pending)}</td>
                  <td className="num">{fmt(c.rejected)}</td>
                  <td className="bar-col">
                    <InlineBar value={c.approved} max={t.participants} label={`${c.approved} de ${t.participants} participantes`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Por {event.settings.teamLabel}</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>{event.settings.teamLabel}</th>
                <th className="num">Inscritos</th>
                <th className="num">Activos</th>
                <th className="num">Mejores</th>
                <th className="num">Participación</th>
                <th className="num">Retos</th>
                <th className="num">XP</th>
              </tr>
            </thead>
            <tbody>
              {data.byTeam.map((team) => (
                <tr key={team.id}>
                  <td className="num">{team.rank}</td>
                  <td>{team.name}</td>
                  <td className="num">{fmt(team.members)}</td>
                  <td className="num">{fmt(team.active)}</td>
                  <td className="num">{fmt(team.performance)}</td>
                  <td className="num">{fmt(team.participation)}</td>
                  <td className="num">{fmt(team.collective)}</td>
                  <td className="num">
                    <strong>{fmt(team.score)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

/** Avisos a todos los participantes: les aparecen como el aviso de "nuevo reto". */
function Announcements() {
  const { event } = useEventAdmin()
  const { data, error, setData } = useAsync(() => listAnnouncements(event.id), [event.id])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sendError, setSendError] = useState(null)

  const send = async (e) => {
    e.preventDefault()
    setBusy(true)
    setSendError(null)
    try {
      setData(await sendAnnouncement(event.id, text))
      setText('')
    } catch (err) {
      setSendError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h3>Avisos a los participantes</h3>
      <p className="muted small">Les aparece en pantalla en menos de un minuto, a quienes tengan la app abierta o la abran en las próximas 2 horas.</p>
      <form className="toolbar wrap" onSubmit={send}>
        <input
          className="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="La charla 2 empieza en 5 minutos"
          maxLength={200}
          required
          minLength={2}
        />
        <button className="btn primary" disabled={busy}>
          Enviar aviso
        </button>
      </form>
      <ErrorBox error={sendError || error} />
      <ul className="team-list">
        {data?.announcements.slice(0, 5).map((n) => (
          <li key={n.id}>
            <span>
              📣 {n.text}
              <br />
              <small className="muted">
                {new Date(n.createdAt).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}
                {n.author && ` · ${n.author}`}
              </small>
            </span>
            <button className="btn small" onClick={async () => setData(await deleteAnnouncement(n.id))}>
              Borrar
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Stat tile: etiqueta · valor · nota. El valor usa tinta de texto, no color de serie. */
function StatTile({ label, value, note }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{fmt(value)}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  )
}

function InlineBar({ value, max, label }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0
  return (
    <span className="inline-bar" title={label} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </span>
  )
}

const HOUR = 3600_000
const MAX_HOURS = 48

/** Rellena las horas sin envios con 0 (un eje de tiempo no se salta horas). */
function fillHours(rows) {
  if (!rows.length) return []
  const counts = new Map(rows.map((r) => [new Date(r.hour).getTime(), r.n]))
  const last = new Date(rows.at(-1).hour).getTime()
  const first = Math.max(new Date(rows[0].hour).getTime(), last - (MAX_HOURS - 1) * HOUR)
  const out = []
  for (let t = first; t <= last; t += HOUR) out.push({ t, n: counts.get(t) ?? 0 })
  return out
}

/** Ticks redondos: 0, 5, 10… o 0, 10, 20… segun el maximo. */
function niceTicks(max) {
  if (max <= 0) return [0, 1]
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)
  const top = Math.ceil(max / step) * step
  const ticks = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  return ticks
}

const hourLabel = (t) => new Date(t).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })
const dayHourLabel = (t) =>
  new Date(t).toLocaleString('es-EC', { weekday: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Columnas de una sola serie (sin leyenda: el titulo dice que es).
 * Tooltip por columna al pasar el mouse o con el teclado; tabla accesible debajo.
 */
function HourlyColumns({ rows }) {
  const [hover, setHover] = useState(null)
  const data = fillHours(rows)
  if (!data.length) return <p className="muted">Aún no hay envíos.</p>
  const ticks = niceTicks(Math.max(...data.map((d) => d.n)))
  const top = ticks.at(-1)
  const labelEvery = Math.ceil(data.length / 8)
  const peak = data.reduce((a, b) => (b.n > a.n ? b : a))

  return (
    <figure className="hourly">
      <div className="hourly-plot" onMouseLeave={() => setHover(null)}>
        <div className="hourly-grid" aria-hidden="true">
          {ticks.map((v) => (
            <div key={v} className="gridline" style={{ bottom: `${(v / top) * 100}%` }}>
              <span>{nf.format(v)}</span>
            </div>
          ))}
        </div>
        <div className="hourly-cols">
          {data.map((d, i) => (
            <button
              key={d.t}
              type="button"
              className="hourly-slot"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${dayHourLabel(d.t)}: ${d.n} envíos`}
            >
              <span className="hourly-bar" style={{ height: `${(d.n / top) * 100}%` }} />
              {d === peak && d.n > 0 && hover == null && (
                <span className="hourly-peak" style={{ bottom: `${(d.n / top) * 100}%` }}>
                  {d.n}
                </span>
              )}
              {hover === i && (
                <span className="hourly-tip" role="tooltip">
                  <strong>{nf.format(d.n)}</strong> envíos
                  <br />
                  {dayHourLabel(d.t)}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="hourly-x" aria-hidden="true">
        {data.map((d, i) => (
          <span key={d.t}>{i % labelEvery === 0 ? hourLabel(d.t) : ''}</span>
        ))}
      </div>
      <details className="table-view">
        <summary>Ver como tabla</summary>
        <table className="table">
          <thead>
            <tr>
              <th>Hora</th>
              <th className="num">Envíos</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.t}>
                <td>{dayHourLabel(d.t)}</td>
                <td className="num">{nf.format(d.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
