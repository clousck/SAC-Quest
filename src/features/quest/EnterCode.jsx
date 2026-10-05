import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { resolveJoinCode } from '../../api/quest'
import QrCodeField from './QrCodeField'
import { session } from './session'
import { ErrorBox } from './ui'
import './quest.css'

/** / y /entrar: para quien no escaneo el QR y tiene el codigo del cartel. */
export default function EnterCode() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
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
    const value = text.trim()
    // El QR del evento es /e/:slug?c=CODIGO; el de un reto, /e/:slug/q/...
    const link = value.match(/\/e\/[^/?#\s]+(?:\/[^?#\s]*)?(?:\?[^#\s]*)?/)
    if (link) {
      setCode(new URLSearchParams(link[0].split('?')[1] ?? '').get('c') ?? '')
      return void navigate(link[0])
    }
    if (!/^[A-Za-z0-9]{4,16}$/.test(value)) return 'Ese QR no es de SAC Quest.'
    setCode(value.toUpperCase())
    enter(value)
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
          <QrCodeField
            label="Código del evento"
            value={code}
            onChange={setCode}
            onScan={onScan}
            hint="Apunta al código QR del evento."
            placeholder="Ej. K7PQ2M"
            autoFocus
          />
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
