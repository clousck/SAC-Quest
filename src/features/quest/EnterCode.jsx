import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { resolveJoinCode } from '../../api/quest'
import QrScanner from './QrScanner'
import { session } from './session'
import { ErrorBox } from './ui'
import './quest.css'

function QrIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3M21 14v.01M14 21v-.01M17.5 21H21v-3.5" />
    </svg>
  )
}

/** / y /entrar: para quien no escaneo el QR y tiene el codigo del cartel. */
export default function EnterCode() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [scanning, setScanning] = useState(false)
  const lastRead = useRef(null)
  const mine = session.slugs()

  const enter = async (value) => {
    setBusy(true)
    setError(null)
    try {
      const { slug } = await resolveJoinCode(value)
      navigate(`/e/${slug}?c=${encodeURIComponent(value.trim())}`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  const onScan = (text) => {
    // El mismo QR se lee varias veces por segundo: se atiende una vez.
    if (text === lastRead.current) return
    lastRead.current = text
    const value = text.trim()
    // El QR del evento es /e/:slug?c=CODIGO; el de un reto, /e/:slug/q/...
    const link = value.match(/\/e\/[^/?#\s]+(?:\/[^?#\s]*)?(?:\?[^#\s]*)?/)
    const plain = /^[A-Za-z0-9]{4,16}$/.test(value)
    if (!link && !plain) return setError(new Error('Ese QR no es de SAC Quest.'))
    setScanning(false)
    if (plain) {
      setCode(value.toUpperCase())
      return enter(value)
    }
    setCode(new URLSearchParams(link[0].split('?')[1] ?? '').get('c') ?? '')
    navigate(link[0])
  }

  return (
    <div className="quest">
      <section className="screen join">
        <div className="join-hero">
          <p className="eyebrow">SAC Quest</p>
          <h1>Entra a tu evento</h1>
          <p className="muted">Escribe el código que aparece en los carteles del evento o escanea su QR.</p>
        </div>
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault()
            enter(code)
          }}
        >
          <label>
            Código del evento
            <span className="field-row">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="Ej. K7PQ2M"
                required
                autoFocus
              />
              <button
                type="button"
                className={scanning ? 'btn scan-btn on' : 'btn scan-btn'}
                onClick={() => {
                  lastRead.current = null
                  setError(null)
                  setScanning((on) => !on)
                }}
                aria-label={scanning ? 'Cerrar el escáner' : 'Escanear el código QR del evento'}
                aria-pressed={scanning}
              >
                <QrIcon />
              </button>
            </span>
          </label>
          {scanning && (
            <>
              <QrScanner onRead={onScan} />
              <p className="muted small center-text">Apunta al código QR del evento.</p>
            </>
          )}
          <ErrorBox error={error} />
          <button className="btn primary block" disabled={busy}>
            {busy ? 'Buscando…' : 'Entrar'}
          </button>
        </form>
        {mine.length > 0 && (
          <div className="card">
            <h2>Tus eventos</h2>
            <ul className="plain-list">
              {mine.map((slug) => (
                <li key={slug}>
                  <Link to={`/e/${slug}`}>{slug}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
