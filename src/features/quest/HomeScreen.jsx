import { Link } from 'react-router'
import { useQuest } from './QuestContext'
import { ChallengeCard, LevelBar } from './ui'

const GROUPS = [
  { title: 'Disponibles', states: ['available', 'rejected'] },
  { title: 'En revisión', states: ['pending'] },
  { title: 'Por desbloquear', states: ['locked', 'upcoming'] },
  { title: 'Completados', states: ['approved'] },
  { title: 'No disponibles', states: ['expired', 'full', 'closed'] },
]

export default function HomeScreen() {
  const { slug, home, queued } = useQuest()
  const { me, challenges } = home
  const total = challenges.length
  const done = challenges.filter((c) => c.state === 'approved').length

  return (
    <section className="screen home">
      <header className="me-card">
        <div className="me-top">
          <div>
            <p className="eyebrow">{home.event.name}</p>
            <h1>Hola, {me.alias}</h1>
            {me.team && <p className="muted small">{me.team.name}</p>}
          </div>
          {me.rank && (
            <Link to={`/e/${slug}/ranking`} className="rank-pill">
              #{me.rank}
              <small>de {me.totalParticipants}</small>
            </Link>
          )}
        </div>
        <LevelBar me={me} />
        <p className="muted small">
          {done} de {total} retos completados
          {me.pending > 0 && ` · ${me.pending} en revisión`}
        </p>
      </header>

      {queued > 0 && (
        <p className="notice">📶 {queued} foto(s) esperando señal. Se enviarán solas.</p>
      )}

      {GROUPS.map((g) => {
        const items = challenges.filter((c) => g.states.includes(c.state))
        if (!items.length) return null
        return (
          <div key={g.title} className="group">
            <h2 className="group-title">
              {g.title} <span>{items.length}</span>
            </h2>
            <ul className="challenge-list">
              {items.map((c) => (
                <li key={c.id}>
                  <ChallengeCard slug={slug} challenge={c} />
                </li>
              ))}
            </ul>
          </div>
        )
      })}

      {total === 0 && <p className="empty">Aún no hay retos. ¡Vuelve en un rato!</p>}
    </section>
  )
}
