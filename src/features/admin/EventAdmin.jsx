import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router'
import { getEvent, listSubmissions } from '../../api/admin'
import { ErrorBox, Spinner } from '../quest/ui'
import { EventAdminContext, useAdmin } from './AdminContext'
import ChallengeForm from './ChallengeForm'
import ChallengesAdmin from './ChallengesAdmin'
import Dashboard from './Dashboard'
import { EVENT_STATUS } from './EventsList'
import GalleryAdmin from './GalleryAdmin'
import Moderation from './Moderation'
import ParticipantsAdmin from './ParticipantsAdmin'
import PrintQr from './PrintQr'
import RankingAdmin, { BigScreen } from './RankingAdmin'
import SettingsAdmin from './SettingsAdmin'
import SurveyResults from './SurveyResults'

export default function EventAdmin() {
  const { eventId } = useParams()
  const location = useLocation()
  const { can } = useAdmin()
  const [event, setEvent] = useState(null)
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(0)

  const reloadEvent = useCallback(async () => {
    try {
      const { event } = await getEvent(eventId)
      setEvent(event)
      setPending(event.counts.pending)
    } catch (e) {
      setError(e)
    }
  }, [eventId])

  useEffect(() => {
    setEvent(null)
    reloadEvent()
  }, [reloadEvent])

  // Contador de pendientes siempre al dia (varios moderadores a la vez).
  useEffect(() => {
    if (!can.review) return
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      listSubmissions(eventId, { status: 'pending', limit: 1 })
        .then((r) => setPending(r.pending))
        .catch(() => {})
    }, 20_000)
    return () => clearInterval(id)
  }, [eventId, can.review])

  const ctx = useMemo(() => ({ event, setEvent, reloadEvent, pending, setPending }), [event, reloadEvent, pending])

  if (error) return <section className="admin-page"><ErrorBox error={error} retry={reloadEvent} /></section>
  if (!event) return <Spinner />

  // Pantalla grande para proyectar: sin menus.
  if (location.pathname.endsWith('/pantalla')) {
    return (
      <EventAdminContext.Provider value={ctx}>
        <BigScreen />
      </EventAdminContext.Provider>
    )
  }

  const base = `/admin/e/${event.id}`
  // Cada rol ve solo sus pestañas; quien no tiene Resumen entra a la primera suya.
  const home = can.view ? null : can.review ? 'moderar' : can.challenges ? 'retos' : 'participantes'
  const showChallenges = can.view || can.challenges
  return (
    <EventAdminContext.Provider value={ctx}>
      <div className="event-head no-print">
        <h1>
          {event.name} <span className={`pill st-${event.status}`}>{EVENT_STATUS[event.status]}</span>
        </h1>
        <nav className="admin-tabs">
          {can.view && <NavLink end to={base}>Resumen</NavLink>}
          {can.review && (
            <NavLink to={`${base}/moderar`}>
              Moderar {pending > 0 && <span className="count">{pending}</span>}
            </NavLink>
          )}
          {showChallenges && <NavLink to={`${base}/retos`}>Retos</NavLink>}
          {can.participants && <NavLink to={`${base}/participantes`}>Participantes</NavLink>}
          {can.view && <NavLink to={`${base}/ranking`}>Ranking</NavLink>}
          {can.view && <NavLink to={`${base}/galeria`}>Galería</NavLink>}
          {can.settings && <NavLink to={`${base}/ajustes`}>Ajustes</NavLink>}
        </nav>
      </div>
      <Routes>
        <Route index element={home ? <Navigate replace to={`${base}/${home}`} /> : <Dashboard />} />
        {can.review && <Route path="moderar" element={<Moderation />} />}
        {showChallenges && (
          <>
            <Route path="retos" element={<ChallengesAdmin />} />
            <Route path="retos/nuevo" element={<ChallengeForm />} />
            <Route path="retos/:challengeId" element={<ChallengeForm />} />
            <Route path="retos/:challengeId/resultados" element={<SurveyResults />} />
            <Route path="imprimir" element={<PrintQr />} />
          </>
        )}
        {can.participants && <Route path="participantes" element={<ParticipantsAdmin />} />}
        {can.view && <Route path="ranking" element={<RankingAdmin />} />}
        {can.view && <Route path="galeria" element={<GalleryAdmin />} />}
        {can.settings && <Route path="ajustes" element={<SettingsAdmin />} />}
        <Route path="*" element={<Navigate replace to={home ? `${base}/${home}` : base} />} />
      </Routes>
    </EventAdminContext.Provider>
  )
}
