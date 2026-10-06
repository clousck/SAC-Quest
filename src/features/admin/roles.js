// Roles del panel y lo que ve cada uno. El servidor decide de verdad (ACCESS
// en server/src/routes/admin.js): esto solo evita mostrar lo que daria error.
export const ROLE_LABEL = { admin: 'Admin', moderator: 'Moderador', reviewer: 'Revisor', editor: 'Editor' }

export const ROLE_HELP = {
  admin: 'todo, en todos los eventos.',
  moderator: 'revisa y borra fotos, gestiona participantes, ve estadísticas y descarga fotos.',
  reviewer: 'solo aprueba y rechaza las fotos de los retos.',
  editor: 'crea y edita retos y gestiona participantes.',
}

const CAPS = {
  admin: ['review', 'deleteSubmissions', 'participants', 'challenges', 'view', 'settings'],
  moderator: ['review', 'deleteSubmissions', 'participants', 'view', 'settings'],
  reviewer: ['review'],
  editor: ['challenges', 'participants'],
}

/**
 * review: cola de fotos · deleteSubmissions: borrar envios · participants ·
 * challenges: crear y editar retos · view: resumen, ranking, galeria y lista
 * de retos · settings: ver Ajustes (editarlos es solo de admin).
 */
export function capsFor(role) {
  const list = CAPS[role] ?? []
  return Object.fromEntries(CAPS.admin.map((c) => [c, list.includes(c)]))
}
