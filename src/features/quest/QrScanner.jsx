import { useCamera } from '../booth/useCamera'
import { useQrScan } from './qrScan'

// Para leer un QR alcanza con 720p (el booth pide mucho mas para la foto).
const SCAN_SIZE = { width: { ideal: 1280 }, height: { ideal: 720 } }

/** Visor de camara que avisa con onRead(texto) cada vez que lee un QR. */
export default function QrScanner({ onRead }) {
  const camera = useCamera('environment', true, SCAN_SIZE)
  useQrScan(camera.videoRef, camera.status === 'ready', onRead)

  return (
    <div className="scanner">
      <video ref={camera.videoRef} playsInline muted />
      {camera.status === 'ready' && <span className="scanner-frame" aria-hidden="true" />}
      {camera.status === 'starting' && <p className="scanner-msg">Abriendo cámara…</p>}
      {camera.status === 'needs-tap' && (
        <div className="scanner-msg">
          <button type="button" className="btn primary" onClick={camera.resume}>
            Activar cámara
          </button>
        </div>
      )}
      {camera.status === 'error' && (
        <div className="scanner-msg">
          <p>{camera.error}</p>
          <button type="button" className="btn small" onClick={camera.retry}>
            Reintentar
          </button>
        </div>
      )}
    </div>
  )
}
