import { request, upload } from './client'

// API de participantes. `token` es el de la persona en ese evento.

const ev = (slug) => `/events/${encodeURIComponent(slug)}`

export const resolveJoinCode = (code) => request(`/join-codes/${encodeURIComponent(code.trim())}`)
export const getEvent = (slug) => request(ev(slug))
export const join = (slug, body) => request(`${ev(slug)}/join`, { method: 'POST', body })
export const recover = (slug, code) => request(`${ev(slug)}/recover`, { method: 'POST', body: { code } })
export const getMe = (slug, token) => request(`${ev(slug)}/me`, { token })
export const getChallenges = (slug, token) => request(`${ev(slug)}/challenges`, { token })
export const getChallenge = (slug, token, id) => request(`${ev(slug)}/challenges/${id}`, { token })
export const claimQr = (slug, token, code) =>
  request(`${ev(slug)}/qr/${encodeURIComponent(code)}`, { method: 'POST', token })
export const getSurvey = (slug, token, id, code) =>
  request(`${ev(slug)}/challenges/${id}/survey${code ? `?code=${encodeURIComponent(code)}` : ''}`, { token })
export const submitSurvey = (slug, token, id, body) =>
  request(`${ev(slug)}/challenges/${id}/answers`, { method: 'POST', token, body })
export const getRanking = (slug, token) => request(`${ev(slug)}/ranking`, { token })
export const getMySubmissions = (slug, token) => request(`${ev(slug)}/me/submissions`, { token })
export const deleteMySubmission = (slug, token, id) =>
  request(`${ev(slug)}/me/submissions/${id}`, { method: 'DELETE', token })
export const setLike = (slug, token, photoId, liked) =>
  request(`${ev(slug)}/photos/${photoId}/like`, { method: liked ? 'POST' : 'DELETE', token })

export function getGallery(slug, token, { challengeId, teamId, before } = {}) {
  const qs = new URLSearchParams()
  if (challengeId) qs.set('challengeId', challengeId)
  if (teamId) qs.set('teamId', teamId)
  if (before) qs.set('before', before)
  return request(`${ev(slug)}/gallery?${qs}`, { token })
}

/** Sube la evidencia de un reto. `photo` y `thumb` son Blobs JPG. */
export function submitPhoto(slug, token, challengeId, { photo, thumb, width, height, capturedWith, clientId }, onProgress) {
  const form = new FormData()
  form.set('photo', photo, 'foto.jpg')
  form.set('thumb', thumb, 'mini.jpg')
  form.set('width', String(width))
  form.set('height', String(height))
  form.set('capturedWith', capturedWith)
  form.set('clientId', clientId)
  return upload(`${ev(slug)}/challenges/${challengeId}/submissions`, form, { token, onProgress })
}
