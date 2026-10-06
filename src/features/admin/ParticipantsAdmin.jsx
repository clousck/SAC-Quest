import { useState } from 'react'
import { Link } from 'react-router'
import { listParticipants, listTeams, resetRecoveryCode, updateParticipant } from '../../api/admin'
import { useAsync } from '../../shared/useAsync'
import { ErrorBox, Spinner } from '../quest/ui'
import { useAdmin, useEventAdmin } from './AdminContext'

export default function ParticipantsAdmin() {
  const { event } = useEventAdmin()
  const { can } = useAdmin()
  const { data, error, loading, reload } = useAsync(() => listParticipants(event.id), [event.id])
  const teams = useAsync(() => listTeams(event.id), [event.id])
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const [actionError, setActionError] = useState(null)

  const list = (data?.participants ?? []).filter((p) => {
    const text = `${p.alias} ${p.team?.name ?? ''} ${p.recoveryCode}`.toLowerCase()
    return text.includes(q.trim().toLowerCase())
  })

  const save = async (p, body) => {
    setActionError(null)
    try {
      await updateParticipant(p.id, body)
      setEditing(null)
      reload()
    } catch (e) {
      setActionError(e)
    }
  }

  const newCode = async (p) => {
    if (!window.confirm(`¿Dar un código nuevo a ${p.alias}? El código ${p.recoveryCode} dejará de servir.`)) return
    setActionError(null)
    try {
      await resetRecoveryCode(p.id)
      reload()
    } catch (e) {
      setActionError(e)
    }
  }

  return (
    <section className="admin-page">
      <div className="toolbar">
        <h2>Participantes ({data?.participants.length ?? 0})</h2>
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, Rama o código" />
      </div>
      <p className="muted small">
        ¿Alguien perdió su sesión? Dale su <strong>código de recuperación</strong>: lo escribe en «¿Ya participaste desde otro
        teléfono?». Con «Código nuevo» se le genera otro y el anterior deja de servir.
      </p>
      <ErrorBox error={error || actionError} retry={error ? reload : null} />
      {loading && !data && <Spinner />}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>{event.settings.teamLabel}</th>
              <th className="num">XP</th>
              <th className="num">✓ / ⏳ / ✕</th>
              <th>Código</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((p) =>
              editing === p.id ? (
                <EditRow key={p.id} p={p} teams={teams.data?.teams ?? []} onSave={(body) => save(p, body)} onCancel={() => setEditing(null)} />
              ) : (
                <tr key={p.id} className={p.banned ? 'banned' : ''}>
                  <td>
                    {can.view ? <Link to={`/admin/e/${event.id}/galeria?participantId=${p.id}`}>{p.alias}</Link> : p.alias}
                    {p.banned && <span className="pill bad">suspendido</span>}
                  </td>
                  <td>{p.team?.name ?? '—'}</td>
                  <td className="num">{p.xp}</td>
                  <td className="num">
                    {p.completed} / {p.pending} / {p.rejected}
                  </td>
                  <td className="mono">{p.recoveryCode}</td>
                  <td className="actions-cell">
                    <button className="btn small" onClick={() => setEditing(p.id)}>
                      Editar
                    </button>
                    <button className="btn small" onClick={() => newCode(p)}>
                      Código nuevo
                    </button>
                    <button
                      className="btn small"
                      onClick={() =>
                        (p.banned || window.confirm(`¿Suspender a ${p.alias}? No podrá jugar y sale del ranking.`)) &&
                        save(p, { banned: !p.banned })
                      }
                    >
                      {p.banned ? 'Reactivar' : 'Suspender'}
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {!loading && !list.length && <p className="empty">Nadie por aquí todavía.</p>}
    </section>
  )
}

function EditRow({ p, teams, onSave, onCancel }) {
  const [alias, setAlias] = useState(p.alias)
  const [teamId, setTeamId] = useState(p.team?.id ?? '')
  return (
    <tr className="editing">
      <td>
        <input value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={24} />
      </td>
      <td>
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">—</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </td>
      <td colSpan={3} />
      <td className="actions-cell">
        <button className="btn small primary" onClick={() => onSave({ alias, teamId: Number(teamId) || null })}>
          Guardar
        </button>
        <button className="btn small" onClick={onCancel}>
          Cancelar
        </button>
      </td>
    </tr>
  )
}
