import { useRef, useState } from 'react'
import QrScanner from './QrScanner'

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

/**
 * Campo para escribir un codigo con un boton a la derecha que abre la camara
 * y lo lee de un QR. `onScan(texto)` decide que hacer con lo leido: si
 * devuelve un mensaje, el QR no servia y el escaner sigue abierto.
 */
export default function QrCodeField({ label, value, onChange, onScan, hint, ...inputProps }) {
  const [scanning, setScanning] = useState(false)
  const [problem, setProblem] = useState(null)
  const lastRead = useRef(null)

  const read = (text) => {
    // El mismo QR se lee varias veces por segundo: se atiende una vez.
    if (text === lastRead.current) return
    lastRead.current = text
    const bad = onScan(text)
    if (typeof bad === 'string') setProblem(bad)
    else setScanning(false)
  }

  return (
    <>
      <label>
        {label}
        <span className="field-row">
          <input value={value} onChange={(e) => onChange(e.target.value)} autoCapitalize="characters" autoComplete="off" required {...inputProps} />
          <button
            type="button"
            className={scanning ? 'btn scan-btn on' : 'btn scan-btn'}
            onClick={() => {
              lastRead.current = null
              setProblem(null)
              setScanning((on) => !on)
            }}
            aria-label={scanning ? 'Cerrar el escáner' : 'Escanear el código QR'}
            aria-pressed={scanning}
          >
            <QrIcon />
          </button>
        </span>
      </label>
      {scanning && (
        <>
          <QrScanner onRead={read} />
          <p className="muted small center-text" role="status">
            {problem ?? hint}
          </p>
        </>
      )}
    </>
  )
}
