import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import AdminPage from './pages/AdminPage.jsx'
import WorkerPage from './pages/WorkerPage.jsx'
import HistorialReportesPage from './pages/HistorialReportesPage.jsx'
import WorkerHistorialPage from './pages/WorkerHistorialPage.jsx'
import CargarPage from './pages/vencimientos/CargarPage.jsx'
import ListaPage from './pages/vencimientos/ListaPage.jsx'
import HistorialPage from './pages/vencimientos/HistorialPage.jsx'
import MarcarPage from './pages/turnos/MarcarPage.jsx'
import TurnosAdminPage from './pages/turnos/AdminPage.jsx'
import TurnosHistorialPage from './pages/turnos/HistorialPage.jsx'
import { useSesionTrabajador } from './lib/useSesionTrabajador.js'

// Portal (2026-08-16) -- pedido explícito del usuario: "separar e integrar".
// Un solo login de trabajador/admin, y desde acá se elige a qué pantalla ir
// -- Conteo de inventario y Vencimientos quedan como apps separadas en el
// uso diario, pero comparten sesión porque viven en el mismo proyecto.
// Sin sesión activa, se ve el selector de siempre (admin/trabajador).
function Home() {
  const { sesion, sesionLista, salir } = useSesionTrabajador()

  if (!sesionLista) return null

  if (!sesion) {
    return (
      <div className="home">
        <div className="home-card">
          <div className="home-mark">◆</div>
          <h1>PuntoVerdeAPP</h1>
          <p>Elige cómo quieres entrar.</p>
          <div className="home-links">
            <Link className="btn btn-primary" to="/admin">Soy administrador</Link>
            <Link className="btn btn-secondary" to="/trabajador">Soy trabajador</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="home">
      <div className="home-card">
        <div className="home-mark">◆</div>
        <h1>PuntoVerdeAPP</h1>
        <p>Hola, {sesion.nombre} — elige qué hacer.</p>
        <div className="home-links">
          <Link className="btn btn-primary" to="/trabajador">Inventario</Link>
          <Link className="btn btn-primary" to="/vencimientos">Vencimientos</Link>
          <Link className="btn btn-primary" to="/turnos">Turnos</Link>
          {sesion.rol === 'admin' && <a className="btn btn-primary" href="/reportes/">Reportes</a>}
          {sesion.rol === 'admin' && <Link className="btn btn-secondary" to="/turnos/admin">Turnos (admin)</Link>}
          {sesion.rol === 'admin' && <Link className="btn btn-secondary" to="/admin">Panel admin</Link>}
          <button type="button" className="btn btn-ghost" onClick={salir}>Salir</button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/historial" element={<HistorialReportesPage />} />
        <Route path="/trabajador" element={<WorkerPage />} />
        <Route path="/trabajador/historial" element={<WorkerHistorialPage />} />
        <Route path="/vencimientos" element={<CargarPage />} />
        <Route path="/vencimientos/lista" element={<ListaPage />} />
        <Route path="/vencimientos/historial" element={<HistorialPage />} />
        <Route path="/turnos" element={<MarcarPage />} />
        <Route path="/turnos/admin" element={<TurnosAdminPage />} />
        <Route path="/turnos/historial" element={<TurnosHistorialPage />} />
      </Routes>
    </BrowserRouter>
  )
}
