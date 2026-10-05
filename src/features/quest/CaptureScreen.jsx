import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuest } from './QuestContext'
import QrScanner from './QrScanner'
import { parseQuestQr } from './qrScan'
import { ChallengeCard } from './ui'

/**
 * Boton central de la barra: escanea el QR de un checkpoint o encuesta sin
 * salir de la app y deja a mano los retos de foto que se pueden hacer ahora.
 */
export default function CaptureScreen() {
  const { slug, home } = useQuest()
  const navigate = useNavigate()
  const [problem, setProblem] = useState(null)
  const [code, setCode] = useState('')
  const lastBad = useRef(null)

  const claim = (value) => navigate(`/e/${slug}/q/${encodeURIComponent(value)}`)

  const onRead = (text) => {
    // El mismo QR se lee varias veces por segundo: se atiende una vez.
    if (text === lastBad.current) return
    const res = parseQuestQr(text, slug)
    lastBad.current = text
    if (res.code) return claim(res.code)
    setProblem(res.problem)
  }

  const photos = home.challenges.filter(
    (c) => (c.type === 'PHOTO' || c.type === 'AR') && (c.state === 'available' || c.state === 'rejected'),
  )

  return (
    <section className="screen capture">
      <h1>Capturar</h1>

      <QrScanner onRead={onRead} />
      <p className="muted center-text" role="status">
        {problem ?? 'Apunta al código QR de un checkpoint o de una encuesta.'}
      </p>

      <form
        className="form inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          claim(code.trim())
        }}
      >
        <label>
          ¿No puedes escanear? Escribe el código impreso bajo el QR
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="Ej. K7PQ2M"
            required
          />
        </label>
        <button className="btn block">Usar código</button>
      </form>

      <div className="group">
        <h2 className="group-title">
          Retos de foto <span>{photos.length}</span>
        </h2>
        {photos.length ? (
          <ul className="challenge-list">
            {photos.map((c) => (
              <li key={c.id}>
                <ChallengeCard slug={slug} challenge={c} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No tienes retos de foto pendientes ahora.</p>
        )}
      </div>
    </section>
  )
}
