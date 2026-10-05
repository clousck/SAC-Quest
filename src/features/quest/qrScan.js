import { useEffect, useRef } from 'react'

const SCAN_MS = 200
const SIDE = 480 // lado del recorte que se le pasa a jsQR

/**
 * Lector de un cuadro de video → texto del QR (o null). Usa el detector del
 * navegador si lo tiene (Chrome en Android); el iPhone no lo trae, asi que ahi
 * se descarga jsQR solo al abrir el escaner.
 */
async function createReader() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats()
      if (formats.includes('qr_code')) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        return async (video) => (await detector.detect(video))[0]?.rawValue ?? null
      }
    } catch {
      // sin detector nativo util: se sigue con jsQR
    }
  }
  const { default: jsQR } = await import('jsqr')
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIDE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  return async (video) => {
    // Solo el cuadrado central: es lo que muestra el visor.
    const side = Math.min(video.videoWidth, video.videoHeight)
    const sx = (video.videoWidth - side) / 2
    const sy = (video.videoHeight - side) / 2
    ctx.drawImage(video, sx, sy, side, side, 0, 0, SIDE, SIDE)
    const { data } = ctx.getImageData(0, 0, SIDE, SIDE)
    return jsQR(data, SIDE, SIDE, { inversionAttempts: 'dontInvert' })?.data || null
  }
}

/** Mientras `active`, busca un QR en el video y avisa con onRead(texto). */
export function useQrScan(videoRef, active, onRead) {
  const onReadRef = useRef(onRead)
  useEffect(() => {
    onReadRef.current = onRead
  })

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer

    createReader()
      .then((read) => {
        const tick = async () => {
          if (cancelled) return
          const video = videoRef.current
          if (video && video.readyState >= 2 && video.videoWidth > 0 && document.visibilityState === 'visible') {
            try {
              const text = await read(video)
              if (text && !cancelled) onReadRef.current(text)
            } catch {
              // un cuadro que no se pudo leer no detiene el escaner
            }
          }
          timer = setTimeout(tick, SCAN_MS)
        }
        tick()
      })
      .catch(() => {})

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [videoRef, active])
}

/**
 * Que hacer con el texto de un QR: los de checkpoints y encuestas son
 * /e/:slug/q/:codigo. Tambien sirve el codigo suelto.
 */
export function parseQuestQr(text, slug) {
  const value = text.trim()
  const m = value.match(/\/e\/([^/?#]+)\/q\/([^/?#]+)/)
  if (m) return m[1] === slug ? { code: decodeURIComponent(m[2]) } : { problem: 'Ese QR es de otro evento.' }
  if (/^[A-Za-z0-9-]{4,16}$/.test(value)) return { code: value }
  if (new RegExp(`/e/${slug}(?:[/?#]|$)`).test(value)) return { problem: 'Ese es el QR para entrar al evento, y ya estás dentro.' }
  return { problem: 'Ese QR no es de un reto de este evento.' }
}
