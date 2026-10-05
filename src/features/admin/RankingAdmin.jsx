import { useEffect } from 'react'
import { Link } from 'react-router'
import { getRanking } from '../../api/admin'
import { useAsync } from '../../shared/useAsync'
import { ErrorBox, Spinner } from '../quest/ui'
import { useEventAdmin } from './AdminContext'
import QrImage, { eventJoinUrl } from './QrImage'

const MEDAL = ['🥇', '🥈', '🥉']

const teamSub = (t) => `${t.active} de ${t.members} activos · Mejores ${t.performance} · Participación ${t.participation} · Retos ${t.collective}`
const teamScore = (t) => `${t.score} XP`

function RankList({ rows, name, sub, score = (r) => `${r.xp} XP` }) {
  return (
    <ol className="ranking">
      {rows.map((r) => (
        <li key={r.id}>
          <span className="pos">{MEDAL[r.rank - 1] ?? r.rank}</span>
          <span className="who">
            {name(r)}
            {sub && <small>{sub(r)}</small>}
          </span>
          <span className="score">{score(r)}</span>
        </li>
      ))}
    </ol>
  )
}

export default function RankingAdmin() {
  const { event } = useEventAdmin()
  const { data, error, loading, reload } = useAsync(() => getRanking(event.id), [event.id])
  return (
    <section className="admin-page">
      <div className="toolbar">
        <h2>Ranking</h2>
        <div className="row">
          <button className="btn" onClick={reload}>
            Actualizar
          </button>
          <Link className="btn primary" to={`/admin/e/${event.id}/pantalla`} target="_blank">
            📺 Pantalla grande
          </Link>
        </div>
      </div>
      <ErrorBox error={error} retry={reload} />
      {loading && !data && <Spinner />}
      {data && (
        <div className="two-cols">
          <div>
            <h3>Personas</h3>
            <RankList rows={data.participants} name={(p) => p.alias} sub={(p) => `${p.team?.name ?? ''} · ${p.completed} retos`} />
          </div>
          <div>
            <h3>Por {event.settings.teamLabel}</h3>
            <RankList rows={data.teams} name={(t) => t.name} sub={teamSub} score={teamScore} />
          </div>
        </div>
      )}
    </section>
  )
}

/** Para proyectar en el evento: se actualiza sola cada 15 s. */
export function BigScreen() {
  const { event } = useEventAdmin()
  const { data, reload } = useAsync(() => getRanking(event.id), [event.id])
  useEffect(() => {
    const id = setInterval(reload, 15_000)
    return () => clearInterval(id)
  }, [reload])

  return (
    <div className="bigscreen" style={{ '--accent': event.settings.accent }}>
      <header>
        <div>
          <p className="eyebrow">SAC Quest</p>
          <h1>{event.name}</h1>
        </div>
        {event.status === 'open' && (
          <div className="bigscreen-join">
            <QrImage value={eventJoinUrl(event)} size={150} />
            <p>
              ¡Únete! Código <strong>{event.joinCode}</strong>
            </p>
          </div>
        )}
      </header>
      {data && (
        <div className="two-cols">
          <div>
            <h2>🏆 Top 10</h2>
            <RankList rows={data.participants.slice(0, 10)} name={(p) => p.alias} sub={(p) => p.team?.name} />
          </div>
          <div>
            <h2>🏛️ {event.settings.teamLabel}s</h2>
            <RankList rows={data.teams.filter((t) => t.members > 0).slice(0, 10)} name={(t) => t.name} sub={teamSub} score={teamScore} />
          </div>
        </div>
      )}
    </div>
  )
}
