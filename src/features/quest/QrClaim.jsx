import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { claimQr } from '../../api/quest'
import { useQuest } from './QuestContext'
import { ChallengeIcon, ErrorBox, Spinner } from './ui'

/**
 * Destino del QR impreso de un checkpoint: /e/:slug/q/:code.
 * Si el QR es de una encuesta, lleva a responderla.
 * Si la persona aun no entro al evento, EventApp le pide entrar primero y
 * despues vuelve aca solo (la URL no cambia).
 */
export default function QrClaim() {
  const { code } = useParams()
  const { slug, token, refresh } = useQuest()
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const started = useRef(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (started.current) return
    started.current = true
    claimQr(slug, token, code)
      .then((res) => {
        if (res.survey) return navigate(`/e/${slug}/s/${res.survey.id}?c=${encodeURIComponent(code)}`, { replace: true })
        setResult(res)
        refresh()
      })
      .catch(setError)
  }, [slug, token, code, refresh, navigate])

  return (
    <section className="screen center qr-claim">
      {!result && !error && <Spinner label="Registrando checkpoint…" />}
      {error && (
        <>
          <div className="celebration-icon">🤔</div>
          <h1>No se pudo registrar</h1>
          <ErrorBox error={error} />
        </>
      )}
      {result && (
        <>
          <ChallengeIcon challenge={result.challenge} large />
          <h1>{result.already ? 'Ya tenías este checkpoint' : '¡Checkpoint encontrado!'}</h1>
          <p className="big-text">{result.challenge.title}</p>
          {!result.already && result.submission.status === 'approved' && (
            <p className="xp-burst">+{result.submission.pointsAwarded} XP</p>
          )}
          {!result.already && result.submission.status === 'pending' && (
            <p className="muted">Un organizador lo confirmará pronto.</p>
          )}
        </>
      )}
      <Link className="btn primary" to={`/e/${slug}`}>
        Ver mis retos
      </Link>
    </section>
  )
}
