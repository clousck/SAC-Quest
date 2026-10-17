// Roles del panel y lo que ve cada uno. El servidor decide de verdad (ACCESS
// en server/src/routes/admin.js): esto solo evita mostrar lo que daria error.
export const ROLE_LABEL = { admin: 'Admin', moderator: 'Moderador', reviewer: 'Revisor' }

export const ROLE_HELP = {
  admin: 'todo, en todos los eventos.',
  moderator: 'crea y edita retos, revisa y borra fotos, gestiona participantes, ve estadísticas, descarga fotos y, en Ajustes, cambia las Ramas y los retos de Rama.',
  reviewer: 'solo aprueba y rechaza las fotos de los retos.',
}

const CAPS = {
  admin: ['review', 'deleteSubmissions', 'participants', 'challenges', 'view', 'settings', 'teams'],
  moderator: ['review', 'deleteSubmissions', 'participants', 'challenges', 'view', 'settings', 'teams'],
  reviewer: ['review'],
}

/**
 * review: cola de fotos · deleteSubmissions: borrar envios · participants ·
 * challenges: crear y editar retos · view: resumen, ranking, galeria y lista
 * de retos · settings: ver Ajustes (editarlos es solo de admin) · teams:
 * Ramas y retos de Rama, dentro de Ajustes.
 */
export function capsFor(role) {
  const list = CAPS[role] ?? []
  return Object.fromEntries(CAPS.admin.map((c) => [c, list.includes(c)]))
}
