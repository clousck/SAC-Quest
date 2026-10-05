import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { claimQr } from '../../api/quest'
import { prepareImage } from '../../shared/imageResize'
import { useToast } from '../../shared/Toast'
import { useQuest } from './QuestContext'
import { Celebration, ChallengeIcon, ErrorBox, Screen, StateBadge, TYPE_LABEL, formatWhen } from './ui'
import { sendEvidence } from './uploadQueue'

// El booth (three.js + Watt) solo se descarga si se abre un reto AR.
const WattBooth = lazy(() => import('../booth/WattBooth'))

const STATE_TEXT = {
  pending: '⏳ Tu foto está en revisión. Te avisaremos cuando la aprueben.',
  expired: 'Este reto ya cerró.',
  full: 'Este reto alcanzó su límite de participantes.',
  closed: 'El evento terminó.',
}

export default function ChallengeScreen() {
  const { id } = useParams()
  const { slug, home } = useQuest()
  const navigate = useNavigate()
  // El festejo vive aca y no en el flujo de envio: al refrescar, el reto pasa
  // a "pendiente"/"completado" y el flujo de envio se desmonta.
  const [celebration, setCelebration] = useState(null)
  const challenge = home.challenges.find((c) => String(c.id) === id)

  if (!challenge) {
    return (
      <Screen back={`/e/${slug}`} title="Reto">
        <p className="empty">Este reto no existe o aún no está visible.</p>
      </Screen>
    )
  }

  const c = challenge
  const canDo = c.state === 'available' || c.state === 'rejected'

  return (
    <Screen back={`/e/${slug}`} className="challenge">
      <div className="ch-hero">
        <ChallengeIcon challenge={c} large />
        <h1>{c.title}</h1>
        <p className="chips">
          <span className="chip accent">+{c.points} XP</span>
          <span className="chip">{TYPE_LABEL[c.type]}</span>
          {c.category && <span className="chip">{c.category}</span>}
          {c.tierName && <span className="chip">{c.tierName}</span>}
        </p>
      </div>

      {c.description && <p className="ch-description">{c.description}</p>}

      <ul className="ch-facts">
        {c.requiresApproval && c.type !== 'QR' && <li>👀 Un organizador revisará tu foto antes de sumar los puntos.</li>}
        {c.slotsLeft != null && <li>🎟️ Quedan {c.slotsLeft} cupos.</li>}
        {c.availableFrom && <li>🕒 Desde {formatWhen(c.availableFrom)}</li>}
        {c.availableUntil && <li>⌛ Hasta {formatWhen(c.availableUntil)}</li>}
      </ul>

      {c.state === 'approved' && (
        <div className="result ok">
          ✅ ¡Completado! Ganaste {c.points ?? ''} XP.
        </div>
      )}
      {c.type === 'TRIVIA' && c.state === 'approved' && (
        <Link className="btn block" to={`/e/${slug}/s/${c.id}`}>
          Ver mis respuestas
        </Link>
      )}
      {c.state === 'rejected' && (
        <div className="result bad">
          Tu foto no fue aprobada{c.rejectReason ? `: ${c.rejectReason}` : '.'} Puedes intentarlo de nuevo.
        </div>
      )}
      {c.state === 'locked' && <div className="result">🔒 {c.lockedHint || 'Completa otros retos para desbloquearlo.'}</div>}
      {c.state === 'upcoming' && <div className="result">🕒 Disponible desde {formatWhen(c.availableFrom)}.</div>}
      {STATE_TEXT[c.state] && <div className="result">{STATE_TEXT[c.state]}</div>}

      {canDo && c.type === 'QR' && <QrAction onDone={setCelebration} />}
      {canDo && c.type === 'TRIVIA' && <SurveyAction challenge={c} />}
      {canDo && c.type !== 'QR' && c.type !== 'TRIVIA' && <EvidenceAction challenge={c} onDone={setCelebration} />}

      {celebration && <Celebration {...celebration} onClose={() => navigate(`/e/${slug}`)} />}

      {!canDo && c.state !== 'approved' && (
        <p className="center-text">
          <StateBadge state={c.state} />
        </p>
      )}
    </Screen>
  )
}

/** Foto (PHOTO) o foto con Watt (AR) → vista previa → envio. */
function EvidenceAction({ challenge, onDone }) {
  const { slug, token, refresh, refreshQueue } = useQuest()
  const navigate = useNavigate()
  const toast = useToast()
  const cameraInput = useRef(null)
  const galleryInput = useRef(null)
  const [phase, setPhase] = useState('idle') // idle | preparing | preview | uploading
  const [prepared, setPrepared] = useState(null)
  const [capturedWith, setCapturedWith] = useState('camera')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)
  const [boothOpen, setBoothOpen] = useState(false)

  const actionsRef = useRef(null)

  useEffect(() => () => prepared && URL.revokeObjectURL(prepared.previewUrl), [prepared])

  // Con la vista previa lista, el boton "Enviar foto" queda a la vista.
  useEffect(() => {
    if (phase === 'preview') actionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [phase])

  const handleImage = async (blob, source, { autoSend = false } = {}) => {
    setError(null)
    setPhase('preparing')
    setCapturedWith(source)
    try {
      const p = await prepareImage(blob)
      const next = { ...p, previewUrl: URL.createObjectURL(p.photo) }
      setPrepared(next)
      if (autoSend) send(next, source)
      else setPhase('preview')
    } catch (e) {
      setError(e)
      setPhase('idle')
    }
  }

  const onFile = (source) => (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // permite elegir la misma foto otra vez
    if (file) handleImage(file, source)
  }

  const send = async (p = prepared, source = capturedWith) => {
    setPhase('uploading')
    setProgress(0)
    setError(null)
    try {
      const res = await sendEvidence({
        slug,
        token,
        challengeId: challenge.id,
        prepared: { photo: p.photo, thumb: p.thumb, width: p.width, height: p.height },
        capturedWith: source,
        onProgress: setProgress,
      })
      const approved = res.submission.status === 'approved'
      onDone({
        icon: approved ? '🎉' : '📸',
        title: approved ? `+${res.submission.pointsAwarded} XP` : '¡Foto enviada!',
        subtitle: approved ? `Completaste «${challenge.title}».` : 'Un organizador la revisará pronto. Te avisaremos.',
      })
      await refresh()
    } catch (e) {
      if (e.queued) {
        toast(e.message, { tone: 'info', ms: 6000 })
        refreshQueue()
        navigate(`/e/${slug}`)
        return
      }
      setError(e)
      setPhase('preview')
    }
  }

  if (boothOpen) {
    return (
      <div className="booth-layer">
        <Suspense fallback={<div className="overlay-msg">Cargando a Watt…</div>}>
          <WattBooth
            mode="challenge"
            onExit={() => setBoothOpen(false)}
            onSubmit={(blob) => {
              setBoothOpen(false)
              handleImage(blob, 'ar', { autoSend: true })
            }}
          />
        </Suspense>
      </div>
    )
  }

  return (
    <div className="evidence">
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onFile('camera')} />
      <input ref={galleryInput} type="file" accept="image/*" hidden onChange={onFile('upload')} />

      {phase === 'preparing' && <p className="muted center-text">Preparando la foto…</p>}

      {(phase === 'preview' || phase === 'uploading') && prepared && (
        <figure className="evidence-preview">
          <img src={prepared.previewUrl} alt="Vista previa de tu foto" />
        </figure>
      )}

      <ErrorBox error={error} />

      {phase === 'uploading' && (
        <div className="upload-progress">
          <div className="bar">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="muted small">{progress < 1 ? `Subiendo… ${Math.round(progress * 100)}%` : 'Guardando…'}</p>
        </div>
      )}

      {phase === 'preview' && (
        <div className="actions" ref={actionsRef}>
          <button className="btn primary block" onClick={() => send()}>
            Enviar foto
          </button>
          <button
            className="btn block"
            onClick={() => (challenge.type === 'AR' ? setBoothOpen(true) : cameraInput.current.click())}
          >
            Tomar otra
          </button>
        </div>
      )}

      {phase === 'idle' && (
        <div className="actions">
          {challenge.type === 'AR' ? (
            <button className="btn primary block big" onClick={() => setBoothOpen(true)}>
              🐱 Abrir cámara con Watt
            </button>
          ) : (
            <>
              <button className="btn primary block big" onClick={() => cameraInput.current.click()}>
                📷 Tomar foto
              </button>
              <button className="link-btn" onClick={() => galleryInput.current.click()}>
                Elegir una foto de la galería
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Encuesta: se abre directo o, si es "solo con QR", con el codigo de su QR. */
function SurveyAction({ challenge }) {
  const { slug } = useQuest()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const { survey } = challenge

  if (!survey.qrOnly) {
    return (
      <div className="evidence">
        <Link className="btn primary block big" to={`/e/${slug}/s/${challenge.id}`}>
          Responder ({survey.questions} {survey.questions === 1 ? 'pregunta' : 'preguntas'})
        </Link>
      </div>
    )
  }
  return (
    <div className="evidence">
      <div className="qr-help">
        <p>📱 Escanea el código QR de la encuesta con el botón <strong>Capturar</strong> o con la cámara de tu teléfono.</p>
        <Link className="btn primary block" to={`/e/${slug}/capturar`}>
          Escanear QR
        </Link>
      </div>
      <form
        className="form inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          navigate(`/e/${slug}/s/${challenge.id}?c=${encodeURIComponent(code.trim())}`)
        }}
      >
        <label>
          ¿No puedes escanear? Escribe el código que está bajo el QR
          <input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoComplete="off" required />
        </label>
        <button className="btn primary block">Abrir encuesta</button>
      </form>
    </div>
  )
}

/** Checkpoint QR: se escanea con la camara del telefono; aca, codigo manual. */
function QrAction({ onDone }) {
  const { slug, token, refresh } = useQuest()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Si el codigo es de otro checkpoint, igual cuenta: se festeja ese.
      const res = await claimQr(slug, token, code)
      if (res.survey) return navigate(`/e/${slug}/s/${res.survey.id}?c=${encodeURIComponent(code.trim())}`)
      onDone({
        icon: '📍',
        title: res.already
          ? 'Ya lo tenías'
          : res.submission.status === 'approved'
            ? `+${res.submission.pointsAwarded} XP`
            : '¡Checkpoint registrado!',
        subtitle: `Checkpoint «${res.challenge.title}».`,
      })
      await refresh()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="evidence">
      <div className="qr-help">
        <p>📱 Busca el código QR en el lugar y escanéalo con el botón <strong>Capturar</strong> o con la cámara de tu teléfono.</p>
        <Link className="btn primary block" to={`/e/${slug}/capturar`}>
          Escanear QR
        </Link>
      </div>
      <form className="form inline-form" onSubmit={submit}>
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
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Verificando…' : 'Registrar checkpoint'}
        </button>
      </form>
    </div>
  )
}
