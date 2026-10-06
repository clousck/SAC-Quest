import { useState } from 'react'
import { createUser, listUsers, updateUser } from '../../api/admin'
import { useAsync } from '../../shared/useAsync'
import { ErrorBox, Spinner } from '../quest/ui'
import { useAdmin } from './AdminContext'
import { ROLE_HELP, ROLE_LABEL } from './roles'

const ROLE_OPTIONS = ['moderator', 'reviewer', 'editor', 'admin']

/**
 * Cuentas del panel. Que puede cada rol: roles.js (y ACCESS en el servidor).
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
      <ul className="muted small role-help">
        {['admin', ...ROLE_OPTIONS.slice(0, 3)].map((r) => (
          <li key={r}>
            <strong>{ROLE_LABEL[r]}</strong>: {ROLE_HELP[r]}
          </li>
        ))}
      </ul>
      <p className="muted small">
        Salvo los administradores, cada cuenta solo entra a los eventos donde se le asigna (Ajustes del evento → Equipo de este
        evento).
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
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
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
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ErrorBox error={formError} />
        <button className="btn primary">Crear usuario</button>
      </form>
    </section>
  )
}
