import { useEffect, useRef, useState } from 'react'

const MESSAGES = {
  NotAllowedError: 'Permiso de cámara denegado. Habilítalo en los ajustes del navegador y recarga.',
  NotFoundError: 'No se encontró ninguna cámara.',
  NotReadableError: 'La cámara está siendo usada por otra app.',
  OverconstrainedError: 'Esta cámara no está disponible.',
}
const NO_FRAMES =
  'La cámara se abrió pero no muestra imagen. Si abriste el enlace desde WeChat, Instagram u otra app, ábrelo en Safari o Chrome.'

// Con ImageCapture (Chrome/Android) la foto sale del sensor a resolucion
// completa, asi que la vista previa puede ser 1080p. Sin ImageCapture
// (iPhone) la foto sale del video: pedimos 4K.
const PREVIEW_SIZE =
  typeof ImageCapture !== 'undefined'
    ? { width: { ideal: 1920 }, height: { ideal: 1080 } }
    : { width: { ideal: 3840 }, height: { ideal: 2160 } }

const FRAME_TIMEOUT = 5000

/**
 * Abre la camara (`user` = frontal, `environment` = trasera) y la conecta al
 * <video> de videoRef. `enabled: false` no pide la camara (modo ?nocam).
 * `size` debe ser una constante: para leer un QR no hace falta 4K.
 *
 * Estados: starting → ready | needs-tap | error.
 * `needs-tap`: el navegador bloqueo la reproduccion automatica (iPhone en
 * modo de bajo consumo, por ejemplo) y hay que llamar a resume() desde un
 * toque del usuario.
 */
export function useCamera(facing, enabled = true, size = PREVIEW_SIZE) {
  const videoRef = useRef(null)
  const [state, setState] = useState({ status: 'starting', error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let stream
    let cancelled = false

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error('Este navegador no permite usar la cámara (se necesita HTTPS).'), {
            name: 'Unsupported',
          })
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, ...size }, audio: false })
        if (cancelled) return
        const video = videoRef.current
        video.srcObject = stream
        try {
          await video.play()
        } catch {
          if (!cancelled) setState({ status: 'needs-tap', error: null })
          return
        }
        if (cancelled) return
        setState({ status: 'ready', error: null })
        if (!(await hasFrames(video, FRAME_TIMEOUT)) && !cancelled) {
          setState({ status: 'error', error: NO_FRAMES })
        }
      } catch (e) {
        if (!cancelled) setState({ status: 'error', error: MESSAGES[e.name] ?? e.message })
      }
    }
    start()

    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [facing, enabled, size, attempt])

  /** Reintenta reproducir el video. Llamarlo desde un toque del usuario. */
  const resume = async () => {
    const video = videoRef.current
    try {
      await video.play()
      setState({ status: 'ready', error: null })
      if (!(await hasFrames(video, FRAME_TIMEOUT))) setState({ status: 'error', error: NO_FRAMES })
    } catch {
      setState({ status: 'error', error: NO_FRAMES })
    }
  }

  return { videoRef, ...state, retry: () => setAttempt((n) => n + 1), resume }
}

/** ¿El video entrega cuadros de verdad? (no solo "abierto" en negro) */
function hasFrames(video, timeout) {
  return new Promise((resolve) => {
    const done = (ok) => {
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => done(video.videoWidth > 0 && video.currentTime > 0), timeout)
    if (video.requestVideoFrameCallback) {
      video.requestVideoFrameCallback(() => done(video.videoWidth > 0))
    } else {
      const check = () => {
        if (video.videoWidth > 0 && video.currentTime > 0) done(true)
        else if (!video.paused) requestAnimationFrame(check)
      }
      check()
    }
  })
}
