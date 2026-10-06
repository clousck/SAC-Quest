import { now } from './db.js'

/**
 * Apertura y cierre programados de los eventos. Al llegar el inicio, un
 * evento en borrador se abre; al llegar el fin, uno abierto se cierra. Cada
 * fecha se dispara una sola vez (queda anotada en *_fired_at): lo que un
 * administrador haga despues a mano —reabrir, volver a borrador— se respeta.
 *
 * Se llama antes de atender cada peticion, asi el cambio ocurre en el segundo
 * exacto sin depender de un temporizador. Si ninguna fecha vencio no escribe nada.
 */
export function applySchedule(db, t = now()) {
  db.run(
    `UPDATE events SET status = CASE WHEN status = 'draft' THEN 'open' ELSE status END, start_fired_at = :t
      WHERE starts_at IS NOT NULL AND start_fired_at IS NULL AND starts_at <= :t`,
    { t },
  )
  db.run(
    `UPDATE events SET status = CASE WHEN status = 'open' THEN 'closed' ELSE status END, end_fired_at = :t
      WHERE ends_at IS NOT NULL AND end_fired_at IS NULL AND ends_at <= :t`,
    { t },
  )
}
