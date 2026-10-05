import { useCallback, useEffect, useRef, useState } from 'react'
import WattCanvas from './WattCanvas'
import { useCamera } from './useCamera'
import { requestMotionPermission, useDeviceRotation } from './useDeviceRotation'
import { composePhoto } from './composePhoto'
import { buildPoseUSDZ, openQuickLook, supportsQuickLook } from './quickLook'
import { POSES, initialPose } from './poses'
import { FACES, initialFace } from './faces'
import { IS_IOS, detectInAppBrowser } from '../../shared/inAppBrowser'
import './WattBooth.css'

const START_POSE = initialPose()
const START_FACE = initialFace()
const faceUrl = (id) => FACES.find((f) => f.id === id).url
const ALL_FACE_URLS = FACES.map((f) => f.url)
// ?nocam: no pide la camara (util para probar en escritorio / capturas).
const NO_CAM = new URLSearchParams(window.location.search).has('nocam')
const COUNTDOWN = 3
const IN_APP = detectInAppBrowser()
// Controles que no deben disparar el "tocar el piso" de WebXR.
const UI_SELECTOR = 'button, .top-bar, .bottom-bar, .preview, .banner'

/**
 * Modos de AR, segun el dispositivo:
 *  - webxr:     Android/Chrome. Watt en el piso, poses y foto dentro de la pagina.
 *  - quicklook: iPhone/iPad. Quick Look con la pose elegida; la foto se toma
 *               con el boton de captura de Quick Look y queda en la galeria
 *               (en un reto se sube desde ahi al volver).
 *  - none:      solo el modo camara con Watt encima.
 */
async function detectAR() {
  if (navigator.xr?.isSessionSupported) {
    try {
      if (await navigator.xr.isSessionSupported('immersive-ar')) return 'webxr'
    } catch {
      // sigue con el siguiente modo
    }
  }
  return supportsQuickLook() ? 'quicklook' : 'none'
}

/**
 * Photo booth con Watt.
 *  - mode "free":      la foto se comparte o descarga (experiencia original).
 *  - mode "challenge": la foto es la evidencia de un reto; se entrega con
 *                      onSubmit(blob). onExit reemplaza la pantalla de cierre.
 */
export default function WattBooth({ mode = 'free', onSubmit, onExit }) {
  const challenge = mode === 'challenge'
  const stageRef = useRef(null)
  const boothRef = useRef(null)
  const viewRef = useRef(null)
  const galleryRef = useRef(null)
  // Arranca con la trasera; el boton ⇄ cambia a la frontal (selfie).
  const [facing, setFacing] = useState('environment')
  const [pose, setPose] = useState(START_POSE)
  const [face, setFace] = useState(START_FACE)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [count, setCount] = useState(null)
  const [flashKey, setFlashKey] = useState(0)
  const [photo, setPhoto] = useState(null)
  const [notice, setNotice] = useState(null)
  const [arMode, setArMode] = useState('checking')
  const [inAR, setInAR] = useState(false)
  const [placed, setPlaced] = useState(false)
  const [usdz, setUsdz] = useState(null)
  const [exited, setExited] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [glLost, setGlLost] = useState(false)
  const [inAppDismissed, setInAppDismissed] = useState(false)

  const { videoRef, status: camStatus, error: camError, retry: retryCam, resume: resumeCam } = useCamera(
    facing,
    !NO_CAM && !inAR && !exited,
  )
  const mirror = facing === 'user'
  // Giro del telefono que la pagina no aplico (rotacion automatica apagada).
  const rotation = useDeviceRotation()
  const landscape = rotation % 180 !== 0

  // Con el telefono de lado, la camara virtual gira para que Watt se vea
  // derecho. En AR no hace falta: Watt esta anclado al piso real.
  useEffect(() => {
    if (loaded) stageRef.current?.setRoll(inAR ? 0 : rotation)
  }, [rotation, inAR, loaded])

  // iOS pide permiso para el acelerometro: lo solicitamos con el primer toque.
  useEffect(() => {
    const el = boothRef.current
    el.addEventListener('pointerdown', requestMotionPermission, { once: true })
    return () => el.removeEventListener('pointerdown', requestMotionPermission)
  }, [])

  useEffect(() => {
    detectAR().then(setArMode)
  }, [])

  // La pagina no se desplaza mientras el booth esta abierto.
  useEffect(() => {
    document.documentElement.classList.add('booth-open')
    return () => document.documentElement.classList.remove('booth-open')
  }, [])

  // Gestos sobre toda la pagina (no solo el canvas): en AR el canvas no se ve
  // y lo que recibe los toques es el overlay.
  useEffect(() => {
    if (!loaded) return
    return stageRef.current.attachGestures(boothRef.current)
  }, [loaded])

  // Si iOS le quita la GPU a la pagina, avisar (three.js intenta recuperarla).
  useEffect(() => {
    if (!loaded) return
    const stage = stageRef.current
    stage.onContextChange = setGlLost
    return () => {
      stage.onContextChange = null
    }
  }, [loaded])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setNotice(`Enlace copiado. Pégalo en ${IS_IOS ? 'Safari' : 'Chrome'}.`)
    } catch {
      setNotice(`Copia este enlace y ábrelo en ${IS_IOS ? 'Safari' : 'Chrome'}: ${window.location.href}`)
    }
  }

  // En AR, tocar un boton no debe mover a Watt.
  useEffect(() => {
    const el = boothRef.current
    const block = (e) => e.target.closest?.(UI_SELECTOR) && e.preventDefault()
    el.addEventListener('beforexrselect', block)
    return () => el.removeEventListener('beforexrselect', block)
  }, [])

  // iPhone: el USDZ de la pose se genera por adelantado, porque Quick Look
  // tiene que abrirse sincronicamente dentro del toque.
  useEffect(() => {
    if (arMode !== 'quicklook' || !loaded) return
    let cancelled = false
    let url = null
    const stage = stageRef.current
    stage
      .texture(faceUrl(face))
      .then((map) => buildPoseUSDZ(stage, pose, map))
      .then((u) => {
        url = u
        if (cancelled) URL.revokeObjectURL(u)
        else setUsdz(u)
      })
      .catch((e) => !cancelled && setNotice(`No se pudo preparar el AR: ${e.message}`))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
      setUsdz(null)
    }
  }, [arMode, loaded, pose, face])

  const enterAR = async () => {
    if (arMode === 'quicklook') {
      if (usdz) openQuickLook(usdz)
      return
    }
    // ARCore necesita la camara: soltamos la de getUserMedia antes de pedir la sesion.
    videoRef.current?.srcObject?.getTracks().forEach((t) => t.stop())
    try {
      const { cameraAccess } = await stageRef.current.startAR(boothRef.current, {
        onPlaced: () => setPlaced(true),
        onEnd: () => {
          setInAR(false)
          setPlaced(false)
          setCount(null)
        },
      })
      setInAR(true)
      if (!cameraAccess) {
        setNotice('Este teléfono no permite fotos dentro del AR: usa la captura de pantalla del teléfono.')
      }
    } catch (e) {
      setNotice(`No se pudo iniciar el AR: ${e.message}`)
      retryCam()
    }
  }

  // Salir: en AR vuelve al modo camara; fuera del AR cierra la experiencia
  // (apaga la camara). Una pagina abierta desde un QR no puede cerrar su
  // propia pestaña, asi que mostramos una pantalla de cierre.
  const exit = () => {
    setCount(null)
    if (stageRef.current?.ar) {
      stageRef.current.endAR()
      return
    }
    if (onExit) onExit()
    else setExited(true)
  }

  const capture = useCallback(async () => {
    const stage = stageRef.current
    const view = viewRef.current
    if (!stage || !view) return
    setFlashKey((k) => k + 1)
    setProcessing(true)
    try {
      const blob = stage.ar
        ? await stage.captureAR(rotation)
        : await composePhoto({
            video: NO_CAM ? null : videoRef.current,
            mirror,
            stage,
            viewW: view.clientWidth,
            viewH: view.clientHeight,
            rotation,
            sensor: !challenge,
          })
      setPhoto({ blob, url: URL.createObjectURL(blob) })
    } catch (e) {
      setNotice(e.message)
    } finally {
      setProcessing(false)
    }
  }, [videoRef, mirror, rotation])

  // Cuenta regresiva 3 → 2 → 1 → foto.
  useEffect(() => {
    if (count === null) return
    const id = setTimeout(() => {
      if (count > 1) {
        setCount(count - 1)
      } else {
        setCount(null)
        capture()
      }
    }, 1000)
    return () => clearTimeout(id)
  }, [count, capture])

  const closePhoto = () => {
    URL.revokeObjectURL(photo.url)
    setPhoto(null)
  }

  const fileName = () => `foto-con-watt-${Date.now()}.jpg`

  // Compartir o descargar desde dentro de la sesion AR no es fiable (la hoja
  // de compartir queda detras): primero se sale del AR.
  const leaveARFirst = async () => {
    if (stageRef.current?.ar) await stageRef.current.endAR()
  }

  const download = async () => {
    await leaveARFirst()
    const a = document.createElement('a')
    a.href = photo.url
    a.download = fileName()
    a.click()
  }

  // Web Share abre la hoja de compartir del sistema, donde aparece WhatsApp.
  // Solo mandamos el archivo: si se agrega texto, algunas apps descartan la imagen.
  const share = async () => {
    const file = new File([photo.blob], fileName(), { type: 'image/jpeg' })
    if (!navigator.canShare?.({ files: [file] })) {
      await download()
      setNotice('Tu navegador no permite compartir directo: la foto se descargó, súbela desde la galería.')
      return
    }
    await leaveARFirst()
    try {
      await navigator.share({ files: [file] })
    } catch (e) {
      if (e.name !== 'AbortError') setNotice('No se pudo compartir. Prueba con Descargar.')
    }
  }

  const submit = async () => {
    await leaveARFirst()
    URL.revokeObjectURL(photo.url)
    onSubmit?.(photo.blob)
  }

  const counting = count !== null
  const canShoot = loaded && !counting && !processing && (!inAR || placed)
  const showARButton = !inAR && (arMode === 'webxr' || arMode === 'quicklook')

  let hint = null
  if (inAR) hint = placed ? 'Toca el piso para moverlo · pellizca para agrandar y girar' : 'Apunta al piso y toca para poner a Watt'
  else if (loaded) hint = 'Arrastra para mover · pellizca para agrandar y girar'

  return (
    <main className={inAR ? 'booth in-ar' : 'booth'} ref={boothRef}>
      <div className="view" ref={viewRef}>
        {NO_CAM ? (
          <div className="backdrop" />
        ) : (
          <video
            ref={videoRef}
            className={mirror ? 'camera mirror' : 'camera'}
            playsInline
            muted
            autoPlay
          />
        )}
        <WattCanvas
          stageRef={stageRef}
          pose={pose}
          initialPose={START_POSE}
          face={faceUrl(face)}
          initialFace={faceUrl(START_FACE)}
          allFaces={ALL_FACE_URLS}
          onLoaded={() => setLoaded(true)}
          onError={(e) => setLoadError(e.message || String(e))}
        />
      </div>

      {!loaded && !loadError && <div className="overlay-msg">Cargando a Watt…</div>}
      {loadError && <div className="overlay-msg error">No se pudo cargar a Watt: {loadError}</div>}

      {!NO_CAM && !inAR && camStatus === 'error' && (
        <div className="banner">
          {camError}
          <button onClick={retryCam}>Reintentar</button>
        </div>
      )}

      {IN_APP && !inAppDismissed && (
        <div className="banner in-app">
          <span>
            Estás en el navegador de {IN_APP}: la cámara puede verse en negro. Toca ··· y elige
            «Abrir en {IS_IOS ? 'Safari' : 'el navegador'}».
          </span>
          <button onClick={copyLink}>Copiar enlace</button>
          <button onClick={() => setInAppDismissed(true)} aria-label="Cerrar aviso">✕</button>
        </div>
      )}

      {glLost && (
        <div className="banner">
          El gráfico 3D se interrumpió (el teléfono liberó memoria).
          <button onClick={() => window.location.reload()}>Recargar</button>
        </div>
      )}

      {!NO_CAM && !inAR && !exited && camStatus === 'needs-tap' && (
        <button className="tap-to-start" onClick={resumeCam}>
          Toca para activar la cámara
        </button>
      )}

      {notice && (
        <div className="banner" onClick={() => setNotice(null)}>
          {notice}
          <button>OK</button>
        </div>
      )}

      <header className="top-bar">
        <button className="exit-btn" onClick={exit}>
          {inAR ? 'Salir del AR' : 'Salir'}
        </button>
        {hint && <p className="hint">{hint}</p>}
        <div className="top-actions">
          {!inAR && (
            <button className="icon-btn" onClick={() => stageRef.current?.resetTransform()} aria-label="Centrar a Watt">
              ⟲
            </button>
          )}
          {!NO_CAM && !inAR && (
            <button
              className="icon-btn"
              onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
              aria-label="Cambiar cámara"
            >
              ⇄
            </button>
          )}
        </div>
      </header>

      <footer className="bottom-bar">
        {showARButton && (
          <button
            className="ar-btn"
            onClick={enterAR}
            disabled={!loaded || (arMode === 'quicklook' && !usdz)}
          >
            {arMode === 'quicklook' && loaded && !usdz ? 'Preparando AR…' : 'Poner a Watt en el piso (AR)'}
          </button>
        )}
        {arMode === 'quicklook' && !inAR && !challenge && (
          <p className="ar-note">En AR, toma la foto con el botón de foto de esa pantalla o con una captura de pantalla.</p>
        )}
        {/* Quick Look abre fuera de la pagina: la foto queda en la galeria y se sube desde ahi. */}
        {arMode === 'quicklook' && !inAR && challenge && (
          <>
            <p className="ar-note">En AR, toma la foto con el botón de esa pantalla. Al volver, súbela desde tu galería.</p>
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) setPhoto({ blob: file, url: URL.createObjectURL(file) })
              }}
            />
            <button className="ar-btn" onClick={() => galleryRef.current.click()}>
              Subir la foto del AR desde la galería
            </button>
          </>
        )}
        <div className="faces" role="group" aria-label="Cara de Watt">
          {FACES.map((f) => (
            <button
              key={f.id}
              className={f.id === face ? 'face active' : 'face'}
              onClick={() => setFace(f.id)}
              disabled={!loaded}
              aria-pressed={f.id === face}
            >
              <span aria-hidden="true">{f.emoji}</span> {f.label}
            </button>
          ))}
        </div>
        <div className="poses">
          {POSES.map((p) => (
            <button
              key={p.clip}
              className={p.clip === pose ? 'pose active' : 'pose'}
              onClick={() => setPose(p.clip)}
              disabled={!loaded}
            >
              {p.label}
            </button>
          ))}
        </div>
        {landscape && <p className="orientation-badge">Foto horizontal</p>}
        <button
          className="shutter"
          onClick={() => setCount(COUNTDOWN)}
          disabled={!canShoot}
          aria-label="Tomar foto en 3 segundos"
        >
          <span>{COUNTDOWN}s</span>
        </button>
      </footer>

      {counting && (
        <div className="countdown" key={count}>
          {count}
        </div>
      )}
      {flashKey > 0 && <div className="flash" key={flashKey} />}
      {processing && <div className="overlay-msg processing">Procesando foto…</div>}

      {exited && (
        <div className="goodbye">
          <p className="goodbye-title">¡Gracias por jugar con Watt!</p>
          <p>Ya puedes cerrar esta pestaña.</p>
          <button className="ar-btn" onClick={() => setExited(false)}>
            Volver a empezar
          </button>
        </div>
      )}

      {photo && (
        <div className="preview">
          <img src={photo.url} alt="Tu foto con Watt" />
          {challenge ? (
            <div className="preview-actions">
              <button className="primary" onClick={submit}>Enviar como evidencia</button>
              <button onClick={closePhoto}>Otra foto</button>
            </div>
          ) : (
            <>
              <p className="preview-hint">Toca Compartir, elige WhatsApp y el grupo de la gincana.</p>
              <div className="preview-actions">
                <button className="primary" onClick={share}>Compartir</button>
                <button onClick={download}>Descargar</button>
                <button onClick={closePhoto}>Otra foto</button>
              </div>
            </>
          )}
        </div>
      )}
    </main>
  )
}
