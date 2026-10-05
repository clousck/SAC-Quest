import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { join, recover } from '../../api/quest'
import { ErrorBox } from './ui'

/**
 * Codigo de recuperacion mientras se escribe: XXXX-XXXX, con el guion puesto
 * solo. Al borrar no se repone el guion final (no se podria borrar mas alla).
 */
function formatRecoveryInput(value, prev) {
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  if (raw.length > 4) return `${raw.slice(0, 4)}-${raw.slice(4)}`
  return raw.length === 4 && value.length > prev.length ? `${raw}-` : raw
}

/**
 * Una sola pantalla para entrar: nombre + Rama + aceptar. El codigo del
 * evento viene en el QR (?c=...); solo se pide si se entro sin el.
 */
export default function JoinScreen({ event, teams, notice, onJoined }) {
  const [params] = useSearchParams()
  const codeFromQr = params.get('c') || ''
  const [code, setCode] = useState(codeFromQr)
  const [alias, setAlias] = useState('')
  const [teamId, setTeamId] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [recovering, setRecovering] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')
  const teamLabel = event.settings.teamLabel
  const closed = event.status === 'closed'

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await join(event.slug, { code, alias, teamId: Number(teamId) || null, consent })
      onJoined(res.token)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  const submitRecovery = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await recover(event.slug, recoveryCode)
      onJoined(res.token)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <section className="screen join">
      <div className="join-hero">
        <p className="eyebrow">SAC Quest</p>
        <h1>{event.name}</h1>
        {event.description && <p className="muted">{event.description}</p>}
      </div>

      {notice && <p className="notice">{notice}</p>}

      {recovering ? (
        <form className="card form" onSubmit={submitRecovery}>
          <h2>Recuperar mi cuenta</h2>
          <p className="muted small">Escribe el código que aparece en tu perfil (por ejemplo ABCD-EFGH).</p>
          <label>
            Código de recuperación
            <input
              value={recoveryCode}
              onChange={(e) => setRecoveryCode((prev) => formatRecoveryInput(e.target.value, prev))}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="XXXX-XXXX"
              maxLength={9}
              required
            />
          </label>
          <ErrorBox error={error} />
          <button className="btn primary block" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
          <button type="button" className="link-btn" onClick={() => setRecovering(false)}>
            Volver
          </button>
        </form>
      ) : closed ? (
        <div className="card">
          <p>🏁 Este evento ya terminó y no admite nuevos participantes.</p>
          <button type="button" className="link-btn" onClick={() => setRecovering(true)}>
            ¿Participaste? Entra con tu código de recuperación
          </button>
        </div>
      ) : (
        <form className="card form" onSubmit={submit}>
          {!codeFromQr && (
            <label>
              Código del evento
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="Está en el QR o en los carteles"
                required
              />
            </label>
          )}
          <label>
            Tu nombre o alias
            <input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              maxLength={24}
              minLength={2}
              autoComplete="nickname"
              placeholder="Como quieres aparecer en el ranking"
              required
            />
          </label>
          {teams.length > 0 && (
            <label>
              Tu {teamLabel}
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
                <option value="">Elige tu {teamLabel}…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
            <span>
              Acepto que mis fotos aprobadas se muestren en la galería privada del evento, visible solo para
              participantes y organizadores.
            </span>
          </label>
          <ErrorBox error={error} />
          <button className="btn primary block" disabled={busy}>
            {busy ? 'Entrando…' : '¡Empezar!'}
          </button>
          <button type="button" className="link-btn" onClick={() => setRecovering(true)}>
            ¿Ya participaste desde otro teléfono?
          </button>
        </form>
      )}
    </section>
  )
}
