import {
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  LoadingManager,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PropertyBinding,
  Quaternion,
  RawShaderMaterial,
  Raycaster,
  RingGeometry,
  Scene,
  ShadowMaterial,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { rotateCanvas, toJpeg } from './composePhoto'

const FOV = 35
// Iluminacion (ver constructor). ROUGHNESS: 0 = espejo, 1 = totalmente mate.
export const ROUGHNESS = 0.7
const FILL_LIGHT = 2.3
const KEY_LIGHT = 1.8
// Tamaño de los mosaicos con que se renderiza la foto (ver renderAtSize).
const TILE = 1024
// Para la vista previa basta con x2; la foto se renderiza aparte a su resolucion.
const SCREEN_PIXEL_RATIO = () => Math.min(window.devicePixelRatio, 2)
const CAM_DIST = 3
const HOME = { x: 0, y: 0.08, scale: 0.8, rotY: 0 }
// Altura de Watt en AR, en metros (el modelo mide 1 unidad).
export const AR_HEIGHT = 0.8

// Si no se pasa textura, un pixel blanco: sin textura Watt se ve negro.
const WHITE_PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

/**
 * Escena three.js de Watt. Dos modos:
 *  - pantalla: canvas transparente encima del video de getUserMedia.
 *  - AR (WebXR): Watt apoyado en el piso real, detectado con hit-test.
 * Watt se normaliza a 1 unidad de alto; cada pose se ajusta para que su
 * punto mas bajo toque y=0 (asi "Acostado" queda sobre el piso).
 */
export class WattStage {
  constructor(canvas) {
    this.canvas = canvas
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.renderer.setPixelRatio(SCREEN_PIXEL_RATIO())
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.shadowMap.enabled = true
    // Tone mapping "Neutral" (Khronos PBR Neutral): deja intactos los colores
    // normales y solo suaviza lo que se pasaria de blanco, sin cambiar el tono.
    this.renderer.toneMapping = NeutralToneMapping

    this.scene = new Scene()
    this.camera = new PerspectiveCamera(FOV, 1, 0.05, 50)
    this.roll = 0
    this.applyCamera()
    this.raycaster = new Raycaster()

    // Presupuesto de luz: con luces fisicas, intensidad π ilumina al 100% del
    // color de la textura. FILL_LIGHT/KEY_LIGHT estan calibrados midiendo el
    // render contra la textura: las zonas iluminadas llegan a su color (blanco
    // ~242 de 250) sin pixeles quemados, y los costados quedan en sombra.
    this.scene.add(new HemisphereLight(0xffffff, 0x8f8f9c, FILL_LIGHT))

    // `root` recibe los gestos y la posicion en el mundo; el modelo va en
    // `lift`, que compensa la altura de cada pose.
    this.root = new Group()
    this.lift = new Group()
    this.root.add(this.lift)
    this.scene.add(this.root)

    // La luz y la sombra viajan con Watt: en AR la sombra en el piso es lo
    // que hace que parezca apoyado de verdad.
    const key = new DirectionalLight(0xffffff, KEY_LIGHT)
    key.position.set(1.5, 2.5, 2.5)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    Object.assign(key.shadow.camera, { left: -1, right: 1, top: 1, bottom: -1, near: 0.1, far: 8 })
    key.shadow.bias = -0.002
    this.root.add(key, key.target)
    const floor = new Mesh(new PlaneGeometry(3, 3), new ShadowMaterial({ opacity: 0.3 }))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.root.add(floor)

    this.reticle = new Mesh(
      new RingGeometry(0.1, 0.13, 40).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: 0xffd23f }),
    )
    this.reticle.matrixAutoUpdate = false
    this.reticle.visible = false
    this.scene.add(this.reticle)

    this.resetTransform()

    this.poses = new Map()
    this.poseLift = new Map()
    this.targets = null
    this.targetLift = 0
    this.size = { w: 0, h: 0 }
    this.last = performance.now()
    this.gestureMode = 'screen'
    this.lastMultiTouch = 0
    this.ar = null
    this.renderer.setAnimationLoop((t, f) => this.frame(t, f))

    // iOS puede quitarle la GPU a la pagina (memoria, app en segundo plano).
    // three.js intenta recuperar el contexto; mientras tanto avisamos.
    this.contextLost = false
    this.onContextChange = null
    this.handleLost = () => {
      this.contextLost = true
      this.onContextChange?.(true)
    }
    this.handleRestored = () => {
      this.contextLost = false
      this.size = { w: 0, h: 0 }
      this.onContextChange?.(false)
    }
    canvas.addEventListener('webglcontextlost', this.handleLost)
    canvas.addEventListener('webglcontextrestored', this.handleRestored)
  }

  /**
   * Carga el FBX. La textura no viene embebida: el FBX apunta a una ruta de
   * la PC donde se exporto (C:\Users\...\gatoieeee.png), asi que cualquier
   * imagen que pida se reemplaza por `texture` (la cara inicial).
   */
  async load(url, { texture } = {}) {
    const manager = new LoadingManager()
    manager.setURLModifier((u) => {
      if (u === url || u.startsWith('data:') || u.startsWith('blob:')) return u
      return texture ?? WHITE_PX
    })
    const model = await new FBXLoader(manager).loadAsync(url)

    const box = new Box3().setFromObject(model)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const s = 1 / size.y
    model.scale.setScalar(s)
    model.position.set(-center.x * s, -box.min.y * s, -center.z * s)
    model.traverse((o) => {
      if (o.isMesh) o.castShadow = true
    })
    this.lift.add(model)
    this.model = model
    this.mesh = model.getObjectByProperty('isSkinnedMesh', true)
    // El FBX trae un MeshPhongMaterial "plastico brillante" (especular 0.8,
    // valor por defecto de Blender) con el color base en 0.8. Lo cambiamos por
    // un material PBR mate con color base blanco: la textura se ve tal cual.
    const phong = Array.isArray(this.mesh.material) ? this.mesh.material[0] : this.mesh.material
    this.material = new MeshStandardMaterial({ map: phong.map, roughness: ROUGHNESS, metalness: 0 })
    this.mesh.material = this.material
    phong.dispose()
    this.faceUrl = texture
    this.textures = new Map(texture && this.material.map ? [[texture, this.material.map]] : [])

    // Cada pose es un clip de un solo keyframe: guardamos ese keyframe por
    // hueso y lo interpolamos a mano, sin AnimationMixer.
    for (const clip of model.animations) {
      const pose = extractPose(model, clip)
      this.poses.set(clip.name, pose)
      this.poseLift.set(clip.name, this.measureLift(pose))
    }
    return [...this.poses.keys()]
  }

  /** Cuanto hay que subir/bajar a Watt para que esta pose toque el piso. */
  measureLift(pose) {
    for (const t of pose) t.node[t.prop].copy(t.value)
    return -this.posedBox().min.y
  }

  /** Caja de la malla ya deformada por los huesos, en el espacio de `lift`. */
  posedBox() {
    this.root.updateMatrixWorld(true)
    this.mesh.skeleton.update()
    this.mesh.computeBoundingBox()
    const toLift = new Matrix4().copy(this.lift.matrixWorld).invert().multiply(this.mesh.matrixWorld)
    return this.mesh.boundingBox.clone().applyMatrix4(toLift)
  }

  /** Precarga texturas (caras) para que el cambio sea instantaneo. */
  preloadTextures(urls) {
    return Promise.all(urls.map((u) => this.texture(u)))
  }

  texture(url) {
    if (!this.textures.has(url)) {
      const base = this.material.map
      const promise = new TextureLoader().loadAsync(url).then((tex) => {
        // Mismos ajustes que la textura que creo el FBXLoader (UV, color).
        if (base) {
          tex.flipY = base.flipY
          tex.wrapS = base.wrapS
          tex.wrapT = base.wrapT
          tex.colorSpace = base.colorSpace
        }
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
        this.textures.set(url, tex)
        return tex
      })
      this.textures.set(url, promise)
    }
    return Promise.resolve(this.textures.get(url))
  }

  /** Cambia la cara (la textura completa del modelo). */
  async setFace(url) {
    this.faceUrl = url
    const tex = await this.texture(url)
    if (this.faceUrl !== url) return // se eligio otra cara mientras cargaba
    this.material.map = tex
    this.material.needsUpdate = true
  }

  setPose(name, instant = false) {
    const pose = this.poses.get(name)
    if (!pose) return
    this.targets = pose
    this.poseName = name
    this.targetLift = this.poseLift.get(name) ?? 0
    if (instant) {
      for (const t of pose) t.node[t.prop].copy(t.value)
      this.lift.position.y = this.targetLift
    }
  }

  // --- gestos ---

  /**
   * Gira la camara virtual cuando el telefono esta de lado y la pagina no
   * roto (rotacion automatica desactivada): asi Watt se ve derecho para
   * quien sostiene el telefono. `deg` = giro antihorario del telefono.
   */
  setRoll(deg) {
    if (deg === this.roll) return
    this.roll = deg
    this.applyCamera()
  }

  applyCamera() {
    const cam = this.camera
    cam.position.set(0, 0.5, CAM_DIST)
    cam.lookAt(0, 0.5, 0)
    cam.rotateZ(MathUtils.degToRad(this.roll))
    // De lado, el "alto" para el usuario es el ancho de la pantalla: alejamos
    // la camara para que Watt no ocupe toda la foto horizontal.
    const sideways = this.roll % 180 !== 0
    cam.zoom = sideways ? Math.min(1, cam.aspect * 1.45) : 1
    cam.updateProjectionMatrix()
  }

  /** Punto de la pantalla (px) proyectado sobre el plano vertical de Watt. */
  screenToPlane({ x, y }) {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    const plane = new Plane(new Vector3(0, 0, 1), -this.root.position.z)
    return this.raycaster.ray.intersectPlane(plane, new Vector3())
  }

  /** Mueve a Watt siguiendo el dedo, sea cual sea el giro de la camara. */
  dragBetween(from, to) {
    const a = this.screenToPlane(from)
    const b = this.screenToPlane(to)
    if (!a || !b) return
    this.root.position.x += b.x - a.x
    this.root.position.y += b.y - a.y
  }

  scaleBy(factor) {
    this.root.scale.setScalar(MathUtils.clamp(this.root.scale.x * factor, 0.2, 4))
  }

  rotateBy(rad) {
    this.root.rotation.y += rad
  }

  resetTransform() {
    this.root.position.set(HOME.x, HOME.y, 0)
    this.root.scale.setScalar(HOME.scale)
    this.root.rotation.set(0, HOME.rotY, 0)
  }

  /**
   * Un dedo mueve (solo en modo pantalla; en AR se mueve tocando el piso);
   * dos dedos escalan (pellizco) y giran; la rueda escala.
   * Se ignoran toques que empiezan sobre botones.
   */
  attachGestures(el) {
    const pts = new Map()
    let prev = null

    const measure = () => {
      const list = [...pts.values()]
      if (!list.length) return null
      const mid = {
        x: list.reduce((s, p) => s + p.x, 0) / list.length,
        y: list.reduce((s, p) => s + p.y, 0) / list.length,
      }
      const m = { n: list.length, mid }
      if (list.length >= 2) {
        const [a, b] = list
        m.dist = Math.hypot(b.x - a.x, b.y - a.y)
        m.angle = Math.atan2(b.y - a.y, b.x - a.x)
      }
      return m
    }

    const down = (e) => {
      if (e.target.closest?.('button, .preview, .banner')) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size >= 2) this.lastMultiTouch = performance.now()
      prev = measure()
    }
    const move = (e) => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const cur = measure()
      if (prev && cur.n === prev.n) {
        if (this.gestureMode === 'screen') this.dragBetween(prev.mid, cur.mid)
        if (cur.n >= 2 && prev.dist > 0) {
          this.lastMultiTouch = performance.now()
          this.scaleBy(cur.dist / prev.dist)
          let d = cur.angle - prev.angle
          if (d > Math.PI) d -= 2 * Math.PI
          if (d < -Math.PI) d += 2 * Math.PI
          // En pantalla el eje Y apunta hacia abajo: un giro horario de los
          // dedos da un angulo positivo, y rotation.y positivo gira a Watt en
          // sentido antihorario visto desde arriba. De ahi el signo.
          this.rotateBy(-d)
        }
      }
      prev = cur
    }
    const up = (e) => {
      if (!pts.delete(e.pointerId)) return
      if (pts.size >= 1) this.lastMultiTouch = performance.now()
      prev = measure()
    }
    const wheel = (e) => {
      if (e.target.closest?.('.poses, .preview')) return
      e.preventDefault()
      this.scaleBy(Math.exp(-e.deltaY * 0.001))
    }

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
    }
  }

  // --- AR (WebXR, Android) ---

  /**
   * Arranca la sesion immersive-ar. Hay que llamarlo desde un toque del
   * usuario. `overlayRoot` es el elemento HTML que queda visible encima de
   * la camara (botones).
   */
  async startAR(overlayRoot, { onPlaced, onEnd } = {}) {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'camera-access'],
      domOverlay: { root: overlayRoot },
    })

    this.saved = {
      position: this.root.position.clone(),
      scale: this.root.scale.x,
      rotY: this.root.rotation.y,
    }
    this.root.visible = false
    this.gestureMode = 'world'

    // La foto en AR sale del canvas: a resolucion nativa de la pantalla (no se
    // puede cambiar el tamaño una vez iniciada la sesion).
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.size = { w: 0, h: 0 }
    this.resizeIfNeeded()

    this.renderer.xr.enabled = true
    this.renderer.xr.setReferenceSpaceType('local')
    await this.renderer.xr.setSession(session)

    const viewer = await session.requestReferenceSpace('viewer')
    const hitSource = await session.requestHitTestSource({ space: viewer })
    this.ar = {
      session,
      hitSource,
      cameraAccess: session.enabledFeatures?.includes('camera-access') ?? false,
      placed: false,
      lastHit: null,
      capture: null,
    }

    session.addEventListener('select', () => {
      // Un pellizco tambien dispara `select` al soltar: lo ignoramos.
      if (performance.now() - this.lastMultiTouch < 500) return
      if (!this.ar?.lastHit) return
      this.placeAt(this.ar.lastHit)
      if (!this.ar.placed) {
        this.ar.placed = true
        onPlaced?.()
      }
    })

    session.addEventListener('end', () => {
      hitSource.cancel?.()
      this.ar = null
      this.renderer.xr.enabled = false
      this.reticle.visible = false
      this.gestureMode = 'screen'
      this.root.visible = true
      this.root.position.copy(this.saved.position)
      this.root.scale.setScalar(this.saved.scale)
      this.root.rotation.set(0, this.saved.rotY, 0)
      this.renderer.setPixelRatio(SCREEN_PIXEL_RATIO())
      this.size = { w: 0, h: 0 } // forzar resize al volver a pantalla
      onEnd?.()
    })

    return { cameraAccess: this.ar.cameraAccess }
  }

  endAR() {
    return this.ar?.session.end()
  }

  placeAt(hitMatrix) {
    const pos = new Vector3().setFromMatrixPosition(hitMatrix)
    const cam = this.renderer.xr.getCamera().position
    // Solo la primera vez: tamaño real y mirando hacia el telefono. Al
    // moverlo despues se respetan el tamaño y el giro que le dio la persona.
    if (!this.ar.placed) {
      this.root.scale.setScalar(AR_HEIGHT)
      this.root.rotation.set(0, Math.atan2(cam.x - pos.x, cam.z - pos.z), 0)
    }
    this.root.position.copy(pos)
    this.root.visible = true
  }

  /** Foto dentro de la sesion AR: imagen de la camara + Watt. */
  captureAR(rotation = 0) {
    if (!this.ar) return Promise.reject(new Error('No hay sesión AR'))
    if (!this.ar.cameraAccess) {
      return Promise.reject(
        new Error('Este teléfono no permite capturar la cámara en AR. Usa la captura de pantalla del teléfono.'),
      )
    }
    return new Promise((resolve, reject) => {
      this.ar.capture = { resolve, reject, rotation }
    })
  }

  updateAR(xrFrame) {
    const refSpace = this.renderer.xr.getReferenceSpace()
    const hits = xrFrame.getHitTestResults(this.ar.hitSource)
    const pose = hits[0]?.getPose(refSpace)
    if (pose) {
      this.ar.lastHit = new Matrix4().fromArray(pose.transform.matrix)
      this.reticle.matrix.copy(this.ar.lastHit)
    }
    // El reticulo solo se muestra mientras se busca donde poner a Watt.
    this.reticle.visible = Boolean(pose) && !this.ar.placed
  }

  /**
   * Se ejecuta despues del render normal, dentro del mismo frame XR: la
   * textura de la camara solo es valida durante este callback.
   */
  runARCapture(xrFrame) {
    const { resolve, reject, rotation } = this.ar.capture
    this.ar.capture = null
    const r = this.renderer
    const prevTarget = r.getRenderTarget()
    const prevAutoClear = r.autoClear
    try {
      const view = xrFrame.getViewerPose(r.xr.getReferenceSpace())?.views[0]
      const camTex = view?.camera && r.xr.getCameraTexture(view.camera)
      if (!camTex) throw new Error('La cámara no entregó imagen en este frame. Intenta de nuevo.')

      // Camara normal con la misma proyeccion y posicion que la vista XR.
      const xrCam = r.xr.getCamera().cameras[0]
      const shot = (this.shotCamera ??= new PerspectiveCamera())
      shot.matrixAutoUpdate = false
      shot.matrixWorldAutoUpdate = false
      shot.projectionMatrix.copy(xrCam.projectionMatrix)
      shot.projectionMatrixInverse.copy(xrCam.projectionMatrixInverse)
      shot.matrixWorld.copy(xrCam.matrixWorld)
      shot.matrixWorldInverse.copy(xrCam.matrixWorldInverse)

      // Renderizamos al canvas (no al framebuffer de XR) con XR apagado un
      // instante: fondo = imagen de la camara, encima la escena.
      r.xr.enabled = false
      r.setRenderTarget(null)
      r.autoClear = false
      r.clear()
      const bg = this.cameraQuad()
      bg.material.uniforms.map.value = camTex
      r.render(bg.scene, bg.camera)
      r.render(this.scene, shot)

      const out = document.createElement('canvas')
      out.width = this.canvas.width
      out.height = this.canvas.height
      out.getContext('2d').drawImage(this.canvas, 0, 0)
      toJpeg(rotateCanvas(out, rotation)).then(resolve, reject)
    } catch (e) {
      reject(e)
    } finally {
      r.autoClear = prevAutoClear
      r.xr.enabled = true
      r.setRenderTarget(prevTarget)
    }
  }

  cameraQuad() {
    if (this.bgQuad) return this.bgQuad
    const material = new RawShaderMaterial({
      uniforms: { map: { value: null } },
      depthTest: false,
      depthWrite: false,
      // La imagen de la camara ya viene en sRGB: se copia sin convertir.
      vertexShader: `
        attribute vec3 position;
        varying vec2 vUv;
        void main() {
          vUv = position.xy * 0.5 + 0.5;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: `
        precision mediump float;
        uniform sampler2D map;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(map, vUv); }`,
    })
    const scene = new Scene()
    scene.add(new Mesh(new PlaneGeometry(2, 2), material))
    this.bgQuad = { scene, camera: new OrthographicCamera(), material }
    return this.bgQuad
  }

  // --- render ---

  resizeIfNeeded() {
    if (this.renderer.xr.isPresenting) return
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (!w || !h || (w === this.size.w && h === this.size.h)) return
    this.size = { w, h }
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.applyCamera()
  }

  frame(now, xrFrame) {
    const dt = Math.min((now - this.last) / 1000, 0.1)
    this.last = now

    if (this.targets) {
      const k = 1 - Math.exp(-dt * 10)
      for (const t of this.targets) {
        if (t.prop === 'quaternion') t.node.quaternion.slerp(t.value, k)
        else t.node[t.prop].lerp(t.value, k)
      }
      this.lift.position.y += (this.targetLift - this.lift.position.y) * k
    }

    if (xrFrame && this.ar) {
      this.updateAR(xrFrame)
      this.renderer.render(this.scene, this.camera)
      if (this.ar.capture) this.runARCapture(xrFrame)
      return
    }
    this.renderNow()
  }

  /**
   * Renderiza la escena a w×h pixeles (la resolucion de la foto) y devuelve
   * una copia en un canvas 2D. Mismo encuadre que la pantalla: w/h tiene el
   * aspecto de la vista. Se limita al maximo que soporte la GPU.
   */
  renderAtSize(w, h) {
    const r = this.renderer
    if (this.contextLost || r.getContext().isContextLost()) {
      throw new Error('Se perdió el gráfico 3D (el teléfono liberó memoria). Recarga la página e intenta de nuevo.')
    }
    const W = Math.round(w)
    const H = Math.round(h)

    // Se renderiza por mosaicos de TILE×TILE y se juntan en un canvas 2D. Un
    // canvas WebGL del tamaño completo de la foto (con antialiasing) puede
    // superar la memoria de GPU que iOS le da a la pagina y perder el contexto.
    const out = document.createElement('canvas')
    out.width = W
    out.height = H
    const ctx = out.getContext('2d')

    const prevRatio = r.getPixelRatio()
    r.setPixelRatio(1)
    this.camera.aspect = W / H
    this.applyCamera()
    try {
      for (let y = 0; y < H; y += TILE) {
        for (let x = 0; x < W; x += TILE) {
          const tw = Math.min(TILE, W - x)
          const th = Math.min(TILE, H - y)
          r.setSize(tw, th, false)
          this.camera.setViewOffset(W, H, x, y, tw, th)
          r.render(this.scene, this.camera)
          ctx.drawImage(this.canvas, 0, 0, tw, th, x, y, tw, th)
        }
      }
    } finally {
      // Volver al tamaño de pantalla en la misma tarea: no se ve parpadeo.
      this.camera.clearViewOffset()
      r.setPixelRatio(prevRatio)
      this.size = { w: 0, h: 0 }
      this.renderNow()
    }
    return out
  }

  /**
   * Renderiza y devuelve el canvas. Llamarlo justo antes de drawImage: el
   * buffer de WebGL solo es valido hasta que el navegador compone el frame.
   */
  renderNow() {
    this.resizeIfNeeded()
    this.renderer.render(this.scene, this.camera)
    return this.canvas
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.handleLost)
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored)
    this.renderer.setAnimationLoop(null)
    this.ar?.session.end()
    this.renderer.dispose()
  }
}

function extractPose(root, clip) {
  const out = []
  for (const track of clip.tracks) {
    const { nodeName, propertyName } = PropertyBinding.parseTrackName(track.name)
    const node = PropertyBinding.findNode(root, nodeName)
    if (!node) continue
    const v = track.values
    if (propertyName === 'quaternion') {
      out.push({ node, prop: 'quaternion', value: new Quaternion(v[0], v[1], v[2], v[3]) })
    } else if (propertyName === 'position' || propertyName === 'scale') {
      out.push({ node, prop: propertyName, value: new Vector3(v[0], v[1], v[2]) })
    }
  }
  return out
}
