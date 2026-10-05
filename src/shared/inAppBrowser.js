// Navegadores dentro de apps: si el enlace se abre desde Instagram, Facebook
// o TikTok, la camara suele verse en negro y hay menos memoria para graficos 3D.
const IN_APP = [
  [/Instagram/i, 'Instagram'],
  [/FBAN|FBAV|FB_IAB/i, 'Facebook'],
  [/BytedanceWebview|musical_ly|TikTok/i, 'TikTok'],
]

/** Nombre de la app si la pagina esta abierta en su navegador interno, o null. */
export function detectInAppBrowser(ua = navigator.userAgent) {
  return IN_APP.find(([re]) => re.test(ua))?.[1] ?? null
}

export const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
