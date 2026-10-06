import { useState } from 'react'
import { createUser, listUsers, updateUser } from '../../api/admin'
import { useAsync } from '../../shared/useAsync'
import { ErrorBox, Spinner } from '../quest/ui'
import { useAdmin } from './AdminContext'

/**
 * Cuentas del panel. Rol "admin": todo. Rol "moderador": revisar fotos,
 * gestionar participantes, ver todo y descargar; no edita retos ni ajustes.
 */
export default function UsersAdmin() {
  const { admin, isAdmin } = useAdmin()
  const { data, error, loading, reload } = useAsync(listUsers, [])
  const [f, setF] = useState({ username: '', name: '', password: '', role: 'moderator' })
  const [formError, setFormError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  if (!isAdmin) return <section className="admin-page"><p className="notice">Solo para administradores.</p></section>

  const create = async (e) => {
    e.preventDefault()
    setFormError(null)
    try {
      await createUser(f)
      setF({ username: '', name: '', password: '', role: 'moderator' })
      reload()
    } catch (err) {
      setFormError(err)
    }
  }

  const change = async (u, body) => {
    setActionError(null)
    try {
      await updateUser(u.id, body)
      reload()
    } catch (err) {
      setActionError(err)
    }
  }

  return (
    <section className="admin-page narrow">
      <h1>Usuarios del panel</h1>
      <p className="muted small">
        <strong>Admin</strong>: todo. <strong>Moderador</strong>: revisa fotos, gestiona participantes, ve estadísticas y
        descarga fotos; no edita retos ni ajustes, y solo en los eventos donde se le asigna (Ajustes del evento → Moderadores de
        este evento).
      </p>
      <ErrorBox error={error || actionError} retry={error ? reload : null} />
      {loading && !data && <Spinner />}
      <ul className="team-list">
        {data?.users.map((u) => (
          <li key={u.id} className={u.active ? '' : 'inactive'}>
            <span>
              <strong>{u.name}</strong> <span className="muted small">@{u.username}</span>
              {!u.active && <span className="pill bad">desactivado</span>}
            </span>
            {u.id !== admin.id && (
              <span className="row">
                <select value={u.role} onChange={(e) => change(u, { role: e.target.value })} aria-label="Rol">
                  <option value="admin">Admin</option>
                  <option value="moderator">Moderador</option>
                </select>
                <button
                  className="btn small"
                  onClick={() => {
                    const password = window.prompt(`Nueva contraseña para ${u.name} (mín. 8 caracteres)`)
                    if (password) change(u, { password })
                  }}
                >
                  Contraseña
                </button>
                <button className="btn small" onClick={() => change(u, { active: !u.active })}>
                  {u.active ? 'Desactivar' : 'Activar'}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      <form className="card form" onSubmit={create}>
        <h3>Nuevo usuario</h3>
        <div className="form-grid">
          <label>
            Nombre
            <input value={f.name} onChange={set('name')} required minLength={2} />
          </label>
          <label>
            Usuario
            <input value={f.username} onChange={set('username')} required minLength={3} autoCapitalize="none" pattern="[a-zA-Z0-9._\-]+" />
          </label>
          <label>
            Contraseña
            <input value={f.password} onChange={set('password')} required minLength={8} type="password" autoComplete="new-password" />
          </label>
          <label>
            Rol
            <select value={f.role} onChange={set('role')}>
              <option value="moderator">Moderador</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
        <ErrorBox error={formError} />
        <button className="btn primary">Crear usuario</button>
      </form>
    </section>
  )
}
