import { Link, useNavigate } from 'react-router'
import { mediaUrl } from '../../api/client'

export const TYPE_LABEL = { PHOTO: '📷 Foto', AR: '🐱 AR con Watt', QR: '📍 Checkpoint QR', TRIVIA: '📝 Encuesta' }
export const TYPE_EMOJI = { PHOTO: '📷', AR: '🐱', QR: '📍', TRIVIA: '📝' }

export const STATE_LABEL = {
  available: 'Disponible',
  rejected: 'Reintentar',
  pending: 'En revisión',
  approved: 'Completado',
  locked: 'Bloqueado',
  upcoming: 'Próximamente',
  expired: 'Cerrado',
  full: 'Cupo lleno',
  closed: 'Evento cerrado',
}

export function formatWhen(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-EC', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Cabecera de pantalla con boton atras opcional. */
export function Screen({ title, back, children, className = '' }) {
  const navigate = useNavigate()
  return (
    <section className={`screen ${className}`}>
      {(title || back) && (
        <header className="screen-head">
          {back && (
            <button className="back-btn" onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))} aria-label="Volver">
              ←
            </button>
          )}
          {title && <h1>{title}</h1>}
        </header>
      )}
      {children}
    </section>
  )
}

export function ChallengeIcon({ challenge, large = false }) {
  const cls = large ? 'ch-icon large' : 'ch-icon'
  if (challenge.imageUrl) return <img className={cls} src={mediaUrl(challenge.imageUrl)} alt="" />
  return (
    <span className={cls} aria-hidden="true">
      {challenge.icon || TYPE_EMOJI[challenge.type] || '⭐'}
    </span>
  )
}

/** Fila de un reto en una lista; lleva a su detalle. */
export function ChallengeCard({ slug, challenge: c }) {
  return (
    <Link to={`/e/${slug}/r/${c.id}`} className={`challenge-card s-${c.state}`}>
      <ChallengeIcon challenge={c} />
      <div className="ch-body">
        <h3>{c.title}</h3>
        <p className="ch-meta">
          {TYPE_EMOJI[c.type]} {[c.category, c.tierName, c.secret && '🤫 secreto'].filter(Boolean).join(' · ')}
        </p>
        {c.state === 'locked' && c.lockedHint && <p className="ch-hint">🔒 {c.lockedHint}</p>}
      </div>
      <div className="ch-side">
        <span className="points">+{c.points}</span>
        {c.state !== 'available' && <StateBadge state={c.state} />}
      </div>
    </Link>
  )
}

export function StateBadge({ state, label }) {
  return <span className={`state-badge s-${state}`}>{label ?? STATE_LABEL[state] ?? state}</span>
}

export function LevelBar({ me }) {
  const { level } = me
  return (
    <div className="level">
      <div className="level-row">
        <span className="level-name">
          Nivel {level.number} · {level.name}
        </span>
        <span className="xp">{me.xp} XP</span>
      </div>
      <div className="bar" role="progressbar" aria-valuenow={Math.round(level.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${level.progress * 100}%` }} />
      </div>
      <p className="level-next">
        {level.next ? `${level.next.minXp - me.xp} XP para ${level.next.name}` : '¡Nivel máximo!'}
      </p>
    </div>
  )
}

export function Spinner({ label = 'Cargando…' }) {
  return (
    <div className="spinner-box" role="status">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  )
}

export function ErrorBox({ error, retry }) {
  if (!error) return null
  return (
    <div className="error-box" role="alert">
      <p>{error.message || String(error)}</p>
      {retry && (
        <button className="btn small" onClick={retry}>
          Reintentar
        </button>
      )}
    </div>
  )
}

/** Pantalla de festejo tras completar un reto. */
export function Celebration({ icon, title, subtitle, onClose }) {
  return (
    <div className="celebration" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="celebration-card" onClick={(e) => e.stopPropagation()}>
        <div className="celebration-icon">{icon}</div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
        <button className="btn primary block" onClick={onClose} autoFocus>
          Seguir jugando
        </button>
      </div>
    </div>
  )
}
