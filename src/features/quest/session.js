// Sesion de la persona, una por evento (puede estar en varios eventos).
const PREFIX = 'sacquest:v1:'

export const session = {
  get: (slug) => localStorage.getItem(PREFIX + slug),
  set(slug, token) {
    localStorage.setItem(PREFIX + slug, token)
  },
  clear: (slug) => localStorage.removeItem(PREFIX + slug),
  /** Eventos en los que esta persona ya entro desde este telefono. */
  slugs: () =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => k.slice(PREFIX.length)),
}
