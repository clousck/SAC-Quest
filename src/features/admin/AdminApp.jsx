import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes } from 'react-router'
import { ADMIN_LOGOUT_EVENT, adminSession, getAdminMe, login, logout } from '../../api/admin'
import { ErrorBox, Spinner } from '../quest/ui'
import { AdminContext } from './AdminContext'
import { capsFor } from './roles'
import { setAppOrigin } from './QrImage'
import EventAdmin from './EventAdmin'
import EventsList from './EventsList'
import UsersAdmin from './UsersAdmin'
import '../quest/quest.css'
import './admin.css'

export default function AdminApp() {
  // undefined: verificando · null: sin sesion
  const [admin, setAdmin] = useState(undefined)

  useEffect(() => {
    if (!adminSession.get()) {
      setAdmin(null)
      return
    }
    getAdminMe()
      .then((r) => {
        setAppOrigin(r.appUrl)
        setAdmin(r.admin)
      })
      .catch(() => setAdmin(null))
  }, [])

  useEffect(() => {
    const onLogout = () => setAdmin(null)
    window.addEventListener(ADMIN_LOGOUT_EVENT, onLogout)
    return () => window.removeEventListener(ADMIN_LOGOUT_EVENT, onLogout)
  }, [])

  const doLogout = useCallback(async () => {
    await logout().catch(() => {})
    adminSession.clear()
    setAdmin(null)
  }, [])

  const ctx = useMemo(
    () => admin && { admin, isAdmin: admin.role === 'admin', can: capsFor(admin.role), logout: doLogout },
    [admin, doLogout],
  )

  if (admin === undefined) {
    return (
      <div className="quest admin">
        <Spinner />
      </div>
    )
  }
  if (!admin) {
    return (
      <div className="quest admin">
        <Login
          onLogin={(token, a, appUrl) => {
            adminSession.set(token)
            setAppOrigin(appUrl)
            setAdmin(a)
          }}
        />
      </div>
    )
  }

  return (
    <AdminContext.Provider value={ctx}>
      <div className="quest admin">
        <header className="admin-top no-print">
          <Link to="/admin" className="brand">
            SAC Quest <span>· Panel</span>
          </Link>
          <nav>
            {ctx.isAdmin && <Link to="/admin/usuarios">Usuarios</Link>}
            <span className="muted small">
              {admin.name} ({admin.role === 'admin' ? 'admin' : 'moderador'})
            </span>
            <button className="btn small" onClick={doLogout}>
              Salir
            </button>
          </nav>
        </header>
        <Routes>
          <Route index element={<EventsList />} />
          <Route path="usuarios" element={<UsersAdmin />} />
          <Route path="e/:eventId/*" element={<EventAdmin />} />
        </Routes>
      </div>
    </AdminContext.Provider>
  )
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await login(username, password)
      onLogin(res.token, res.admin, res.appUrl)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <section className="screen join">
      <div className="join-hero">
        <p className="eyebrow">SAC Quest</p>
        <h1>Panel de organización</h1>
      </div>
      <form className="card form" onSubmit={submit}>
        <label>
          Usuario
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        </label>
        <label>
          Contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </section>
  )
}
