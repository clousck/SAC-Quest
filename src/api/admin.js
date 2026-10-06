import { request, upload } from './client'

// API del panel. La sesion se guarda aparte de las de participantes.

const KEY = 'sacquest:admin'
export const adminSession = {
  get: () => localStorage.getItem(KEY),
  set: (token) => localStorage.setItem(KEY, token),
  clear: () => localStorage.removeItem(KEY),
}

/** Sesion vencida o cerrada en otro lado: el panel vuelve al login. */
export const ADMIN_LOGOUT_EVENT = 'sacquest:admin-logout'

async function call(path, opts = {}) {
  try {
    return await request(`/admin${path}`, { ...opts, token: adminSession.get() })
  } catch (e) {
    if (e.status === 401) {
      adminSession.clear()
      window.dispatchEvent(new Event(ADMIN_LOGOUT_EVENT))
    }
    throw e
  }
}
const post = (path, body = {}) => call(path, { method: 'POST', body })
const patch = (path, body) => call(path, { method: 'PATCH', body })
const del = (path, body) => call(path, { method: 'DELETE', body })

export const login = (username, password) => request('/admin/login', { method: 'POST', body: { username, password } })
export const logout = () => post('/logout')
export const getAdminMe = () => call('/me')

export const listEvents = () => call('/events')
export const createEvent = (body) => post('/events', body)
export const getEvent = (id) => call(`/events/${id}`)
export const updateEvent = (id, body) => patch(`/events/${id}`, body)
export const deleteEvent = (id, confirm) => del(`/events/${id}`, { confirm })
export const duplicateEvent = (id, body) => post(`/events/${id}/duplicate`, body)

export const listTeams = (eventId) => call(`/events/${eventId}/teams`)
export const addTeams = (eventId, names) => post(`/events/${eventId}/teams`, { names })
export const updateTeam = (id, body) => patch(`/teams/${id}`, body)
export const deleteTeam = (id) => del(`/teams/${id}`)

export const listChallenges = (eventId) => call(`/events/${eventId}/challenges`)
export const createChallenge = (eventId, body) => post(`/events/${eventId}/challenges`, body)
export const getChallenge = (id) => call(`/challenges/${id}`)
export const updateChallenge = (id, body) => patch(`/challenges/${id}`, body)
export const deleteChallenge = (id) => del(`/challenges/${id}`)
export const reorderChallenges = (eventId, ids) => post(`/events/${eventId}/challenges/reorder`, { ids })
export const regenerateQr = (id) => post(`/challenges/${id}/regenerate-qr`)
export const deleteChallengeImage = (id) => del(`/challenges/${id}/image`)
export function uploadChallengeImage(id, blob) {
  const form = new FormData()
  form.set('image', blob, 'imagen.jpg')
  return upload(`/admin/challenges/${id}/image`, form, { token: adminSession.get() })
}

export const listAnnouncements = (eventId) => call(`/events/${eventId}/announcements`)
export const sendAnnouncement = (eventId, text) => post(`/events/${eventId}/announcements`, { text })
export const deleteAnnouncement = (id) => del(`/announcements/${id}`)

export const getSurveyResults = (id) => call(`/challenges/${id}/survey-results`)

export const listBadges = (eventId) => call(`/events/${eventId}/badges`)
export const createBadge = (eventId, body) => post(`/events/${eventId}/badges`, body)
export const updateBadge = (id, body) => patch(`/badges/${id}`, body)
export const deleteBadge = (id) => del(`/badges/${id}`)

export const listTeamGoals = (eventId) => call(`/events/${eventId}/team-goals`)
export const createTeamGoal = (eventId, body) => post(`/events/${eventId}/team-goals`, body)
export const updateTeamGoal = (id, body) => patch(`/team-goals/${id}`, body)
export const deleteTeamGoal = (id) => del(`/team-goals/${id}`)

export function listSubmissions(eventId, filters = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v)
  return call(`/events/${eventId}/submissions?${qs}`)
}
export const reviewSubmission = (id, body) => post(`/submissions/${id}/review`, body)
export const deleteSubmission = (id) => del(`/submissions/${id}`)

export const listParticipants = (eventId) => call(`/events/${eventId}/participants`)
export const updateParticipant = (id, body) => patch(`/participants/${id}`, body)
export const resetRecoveryCode = (id) => post(`/participants/${id}/recovery-code`)

export const getRanking = (eventId) => call(`/events/${eventId}/ranking`)
export const getStats = (eventId) => call(`/events/${eventId}/stats`)
export const exportPhotos = (eventId, body) => post(`/events/${eventId}/export`, body)

export const listModerators = (eventId) => call(`/events/${eventId}/moderators`)
export const setModerators = (eventId, adminIds) => post(`/events/${eventId}/moderators`, { adminIds })
export const listUsers = () => call('/users')
export const createUser = (body) => post('/users', body)
export const updateUser = (id, body) => patch(`/users/${id}`, body)
