import { useState } from 'react'
import { getRanking } from '../../api/quest'
import { useAsync } from '../../shared/useAsync'
import { useQuest } from './QuestContext'
import { ErrorBox, Screen, Spinner } from './ui'

const MEDAL = ['🥇', '🥈', '🥉']

export default function RankingScreen() {
  const { slug, token, event } = useQuest()
  const [tab, setTab] = useState('people')
  const { data, error, loading, reload } = useAsync(() => getRanking(slug, token), [slug, token])
  const teamLabel = event.settings.teamLabel
  const myTeam = data?.teams.find((t) => t.id === data.me?.team?.id)

  return (
    <Screen title="Ranking">
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'people'} className={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}>
          Personas
        </button>
        <button role="tab" aria-selected={tab === 'teams'} className={tab === 'teams' ? 'on' : ''} onClick={() => setTab('teams')}>
          Por {teamLabel}
        </button>
      </div>

      <ErrorBox error={error} retry={reload} />
      {loading && !data && <Spinner />}

      {data && tab === 'people' && (
        <>
          <ol className="ranking">
            {data.participants.map((p) => (
              <li key={p.id} className={p.id === data.me?.id ? 'me' : ''}>
                <span className="pos">{MEDAL[p.rank - 1] ?? p.rank}</span>
                <span className="who">
                  {p.alias}
                  {p.team && <small>{p.team.shortName || p.team.name}</small>}
                </span>
                <span className="score">{p.xp} XP</span>
              </li>
            ))}
          </ol>
          {data.me && data.me.rank > data.participants.length && (
            <ol className="ranking pinned">
              <li className="me">
                <span className="pos">{data.me.rank}</span>
                <span className="who">{data.me.alias} (tú)</span>
                <span className="score">{data.me.xp} XP</span>
              </li>
            </ol>
          )}
          {!data.participants.length && <p className="empty">Todavía no hay puntos. ¡Sé el primero!</p>}
        </>
      )}

      {data && tab === 'teams' && (
        <>
          <ol className="ranking">
            {data.teams.map((t) => (
              <li key={t.id} className={t.id === data.me?.team?.id ? 'me' : ''}>
                <span className="pos">{MEDAL[t.rank - 1] ?? t.rank}</span>
                <span className="who">
                  {t.name}
                  <small>
                    {t.active} de {t.members} participando
                  </small>
                  <small>
                    Mejores {t.performance} · Participación {t.participation} · Retos de {teamLabel} {t.collective}
                  </small>
                </span>
                <span className="score">{t.score} XP</span>
              </li>
            ))}
          </ol>
          {myTeam?.goals.length > 0 && (
            <>
              <h3>Retos de tu {teamLabel}</h3>
              <ul className="ranking">
                {myTeam.goals.map((g) => (
                  <li key={g.id}>
                    <span className="pos">{g.icon}</span>
                    <span className="who">
                      {g.name}
                      {g.description && <small>{g.description}</small>}
                    </span>
                    <span className="score">{g.met ? '✓' : `${g.count}/${g.members}`}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted small center-text">
            El XP de una {teamLabel} suma el de sus mejores integrantes (el primero completo y los siguientes cada vez menos), un bono por
            cada integrante que participa y los retos de {teamLabel}. Quien no juega no suma. Tu XP personal no cambia.
          </p>
        </>
      )}
    </Screen>
  )
}
