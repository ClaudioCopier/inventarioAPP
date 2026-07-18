import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import AdminPage from './pages/AdminPage.jsx'
import WorkerPage from './pages/WorkerPage.jsx'

function Home() {
  return (
    <div className="home">
      <div className="home-card">
        <div className="home-mark">◆</div>
        <h1>Inventario</h1>
        <p>Elige cómo quieres entrar.</p>
        <div className="home-links">
          <Link className="btn btn-primary" to="/admin">Soy administrador</Link>
          <Link className="btn btn-secondary" to="/trabajador">Soy trabajador</Link>
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
        <Route path="/trabajador" element={<WorkerPage />} />
      </Routes>
    </BrowserRouter>
  )
}
