import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useParams } from 'react-router'
import { getChallenges, getEvent } from '../../api/quest'
import { ToastProvider, useToast } from '../../shared/Toast'
import { useAsync } from '../../shared/useAsync'
import ChallengeScreen from './ChallengeScreen'
import GalleryScreen from './GalleryScreen'
import HomeScreen from './HomeScreen'
import JoinScreen from './JoinScreen'
import ProfileScreen from './ProfileScreen'
import QrClaim from './QrClaim'
import RankingScreen from './RankingScreen'
import SurveyScreen from './SurveyScreen'
import { QuestContext } from './QuestContext'
import { session } from './session'
import { ErrorBox, Spinner } from './ui'
import { flushQueue, listQueued } from './uploadQueue'
import './quest.css'

const POLL_MS = 45_000

export default function EventApp() {
  return (
    <ToastProvider>
      <EventRoot />
    </ToastProvider>
  )
}

function EventRoot() {
  const { slug } = useParams()
  const [token, setToken] = useState(() => session.get(slug))
  const [notice, setNotice] = useState(null)
  const eventQ = useAsync(() => getEvent(slug), [slug])

  useEffect(() => setToken(session.get(slug)), [slug])

  const signOut = useCallback(
    (message = null) => {
      session.clear(slug)
      setToken(null)
      setNotice(message)
    },
    [slug],
  )

  const accent = eventQ.data?.event.settings.accent
  const style = accent ? { '--accent': accent } : undefined

  let body
  if (eventQ.loading && !eventQ.data) body = <Spinner label="Cargando evento…" />
  else if (eventQ.error)
    body = (
      <div className="screen center">
        <h1>Evento no disponible</h1>
        <ErrorBox error={eventQ.error} retry={eventQ.error.status === 404 ? null : eventQ.reload} />
        <Link className="btn" to="/entrar">
          Ingresar otro código
        </Link>
      </div>
    )
  else if (!token)
    body = (
      <JoinScreen
        event={eventQ.data.event}
        teams={eventQ.data.teams}
        notice={notice}
        onJoined={(t) => {
          session.set(slug, t)
          setNotice(null)
          setToken(t)
        }}
      />
    )
  else body = <Joined key={token} slug={slug} token={token} eventData={eventQ.data} signOut={signOut} />

  return (
    <div className="quest" style={style}>
      {body}
    </div>
  )
}

/** Avisos de los organizadores: cada uno se muestra una sola vez en este telefono. */
function announce(slug, list, toast) {
  const key = `sacquest:avisos:${slug}`
  const seen = Number(localStorage.getItem(key)) || 0
  const fresh = list.filter((n) => n.id > seen)
  if (!fresh.length) return
  localStorage.setItem(key, String(Math.max(...fresh.map((n) => n.id))))
  for (const n of fresh.reverse()) toast(`📣 ${n.text}`, { tone: 'accent', ms: 9000 })
}

/** Avisos al detectar cambios entre dos sondeos. */
function announceChanges(prev, next, toast) {
  const before = new Map(prev.challenges.map((c) => [c.id, c]))
  for (const c of next.challenges) {
    const old = before.get(c.id)
    const open = c.state === 'available'
    if (open && (!old || old.state === 'locked' || old.state === 'upcoming')) {
      toast(`🔓 Nuevo reto: ${c.title}`, { tone: 'accent', ms: 5000 })
    }
    if (old?.state === 'pending' && c.state === 'approved') {
      toast(`✅ Aprobada: ${c.title} · +${c.points} XP`, { tone: 'ok', ms: 5000 })
    }
    if (old?.state === 'pending' && c.state === 'rejected') {
      toast(`❌ Tu foto de «${c.title}» no fue aprobada. Puedes intentarlo de nuevo.`, { tone: 'bad', ms: 6000 })
    }
  }
  const had = new Set(prev.me.badges.filter((b) => b.earned).map((b) => b.id))
  for (const b of next.me.badges) {
    if (b.earned && !had.has(b.id)) toast(`${b.icon} ¡Nuevo logro: ${b.name}!`, { tone: 'accent', ms: 5000 })
  }
  if (next.me.level.number > prev.me.level.number) {
    toast(`⚡ ¡Subiste a nivel ${next.me.level.name}!`, { tone: 'accent', ms: 5000 })
  }
}

function Joined({ slug, token, eventData, signOut }) {
  const toast = useToast()
  const location = useLocation()
  const [home, setHome] = useState(null)
  const [homeError, setHomeError] = useState(null)
  const [banned, setBanned] = useState(false)
  const [queued, setQueued] = useState(0)
  const prevRef = useRef(null)

  const refresh = useCallback(async () => {
    try {
      const data = await getChallenges(slug, token)
      if (prevRef.current) announceChanges(prevRef.current, data, toast)
      announce(slug, data.announcements ?? [], toast)
      prevRef.current = data
      setHome(data)
      setHomeError(null)
      return data
    } catch (e) {
      if (e.status === 401) signOut('Tu sesión expiró. Vuelve a entrar o recupera tu cuenta con tu código.')
      else if (e.code === 'banned') setBanned(true)
      else setHomeError(e)
      return null
    }
  }, [slug, token, toast, signOut])

  const refreshQueue = useCallback(async () => {
    setQueued((await listQueued(slug)).length)
  }, [slug])

  // Fotos que quedaron guardadas sin señal: reintentar al abrir y al volver la red.
  const retryQueue = useCallback(async () => {
    const { sent, failed } = await flushQueue(slug, token)
    if (sent.length) {
      toast(`📤 Se enviaron ${sent.length} foto(s) pendiente(s).`, { tone: 'ok' })
      refresh()
    }
    for (const f of failed) toast(`No se pudo enviar una foto guardada: ${f.error.message}`, { tone: 'bad', ms: 6000 })
    refreshQueue()
  }, [slug, token, toast, refresh, refreshQueue])

  useEffect(() => {
    refresh()
    retryQueue()
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh()
        retryQueue()
      }
    }
    const id = setInterval(() => document.visibilityState === 'visible' && refresh(), POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', retryQueue)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', retryQueue)
    }
  }, [refresh, retryQueue])

  const ctx = useMemo(
    () => ({
      slug,
      token,
      event: home?.event ?? eventData.event,
      teams: eventData.teams,
      home,
      refresh,
      signOut,
      queued,
      refreshQueue,
    }),
    [slug, token, eventData, home, refresh, signOut, queued, refreshQueue],
  )

  if (banned) {
    return (
      <div className="screen center">
        <h1>Cuenta suspendida</h1>
        <p>Los organizadores suspendieron tu participación. Si crees que es un error, acércate a la mesa de organización.</p>
      </div>
    )
  }
  if (!home) return homeError ? <div className="screen center"><ErrorBox error={homeError} retry={refresh} /></div> : <Spinner />

  // El QR, el detalle de un reto y una encuesta ocupan toda la pantalla, sin barra de pestañas.
  const tabs = !/\/(q|r|s)\//.test(location.pathname)

  return (
    <QuestContext.Provider value={ctx}>
      {home.event.status === 'closed' && <div className="event-closed">🏁 El evento terminó. ¡Gracias por participar!</div>}
      <main className={tabs ? 'quest-main with-tabs' : 'quest-main'}>
        <Routes>
          <Route index element={<HomeScreen />} />
          <Route path="r/:id" element={<ChallengeScreen />} />
          <Route path="q/:code" element={<QrClaim />} />
          <Route path="s/:id" element={<SurveyScreen />} />
          <Route path="ranking" element={<RankingScreen />} />
          <Route path="galeria" element={<GalleryScreen />} />
          <Route path="perfil" element={<ProfileScreen />} />
          <Route path="*" element={<HomeScreen />} />
        </Routes>
      </main>
      {tabs && (
        <nav className="tabbar">
          <NavLink end to={`/e/${slug}`}>
            <span aria-hidden="true">🎯</span>Retos
          </NavLink>
          <NavLink to={`/e/${slug}/ranking`}>
            <span aria-hidden="true">🏆</span>Ranking
          </NavLink>
          <NavLink to={`/e/${slug}/galeria`}>
            <span aria-hidden="true">🖼️</span>Galería
          </NavLink>
          <NavLink to={`/e/${slug}/perfil`}>
            <span aria-hidden="true">👤</span>Perfil
          </NavLink>
        </nav>
      )}
    </QuestContext.Provider>
  )
}
