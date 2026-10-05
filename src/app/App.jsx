import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes, useNavigate, useParams } from 'react-router'

// Cada parte se descarga solo cuando se abre: el booth trae three.js y el
// FBX de Watt (~1.5 MB), el panel no lo necesita ningun participante.
const WattBooth = lazy(() => import('../features/booth/WattBooth'))
const EventApp = lazy(() => import('../features/quest/EventApp'))
const EnterCode = lazy(() => import('../features/quest/EnterCode'))
const AdminApp = lazy(() => import('../features/admin/AdminApp'))

const loading = <div className="overlay-msg">Cargando…</div>

/** Booth libre dentro de un evento: "Salir" vuelve a los retos. */
function EventBooth() {
  const { slug } = useParams()
  const navigate = useNavigate()
  return <WattBooth onExit={() => navigate(`/e/${slug}/perfil`)} />
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={loading}>
        <Routes>
          {/* La raiz pide el codigo del evento; /entrar sigue en carteles y guias. */}
          <Route path="/" element={<EnterCode />} />
          <Route path="/entrar" element={<EnterCode />} />
          {/* El booth suelto (sin evento) queda en /watt. */}
          <Route path="/watt" element={<WattBooth />} />
          <Route path="/e/:slug/watt" element={<EventBooth />} />
          <Route path="/e/:slug/*" element={<EventApp />} />
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="*" element={<EnterCode />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
