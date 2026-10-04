import { useSearchParams } from 'react-router'
import { listChallenges } from '../../api/admin'
import { useAsync } from '../../shared/useAsync'
import { Spinner } from '../quest/ui'
import { useEventAdmin } from './AdminContext'
import QrImage, { appHost, checkpointUrl, eventJoinUrl } from './QrImage'

/**
 * Hoja para imprimir: el QR de entrada al evento, el de cada checkpoint y el
 * de cada encuesta (para proyectarlo al final de la charla).
 * Debajo de cada QR va el codigo en texto, por si la camara no lo lee.
 */
export default function PrintQr() {
  const { event } = useEventAdmin()
  const [params] = useSearchParams()
  const only = params.get('reto')
  const { data, loading } = useAsync(() => listChallenges(event.id), [event.id])
  const checkpoints = (data?.challenges ?? []).filter((c) => (c.type === 'QR' || c.type === 'TRIVIA') && c.qrCode && (!only || String(c.id) === only))

  return (
    <section className="admin-page print-page">
      <div className="toolbar no-print">
        <p className="muted">Cada QR ocupa media hoja. Usa «Imprimir» del navegador (o guárdalo como PDF).</p>
        <button className="btn primary" onClick={() => window.print()}>
          🖨️ Imprimir
        </button>
      </div>
      {loading && <Spinner />}
      <div className="print-sheet">
        {!only && (
          <div className="print-item">
            <p className="print-eyebrow">{event.name}</p>
            <h2>¡Únete a SAC Quest!</h2>
            <QrImage value={eventJoinUrl(event)} size={260} />
            <p>Escanea con la cámara de tu teléfono</p>
            <p className="print-code">
              {appHost()}/entrar · código <strong>{event.joinCode}</strong>
            </p>
          </div>
        )}
        {checkpoints.map((c) => (
          <div key={c.id} className="print-item">
            <p className="print-eyebrow">
              {c.type === 'TRIVIA' ? 'Encuesta' : 'Checkpoint'} · {event.name}
            </p>
            <h2>
              {c.icon} {c.type === 'QR' && c.visibility === 'secret' ? '¡Encontraste un checkpoint secreto!' : c.title}
            </h2>
            <QrImage value={checkpointUrl(event, c)} size={260} />
            <p>{c.type === 'TRIVIA' ? `Escanéalo y responde para ganar ${c.points} XP` : `Escanéalo para ganar ${c.points} XP`}</p>
            <p className="print-code">
              Código: <strong>{c.qrCode}</strong>
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
