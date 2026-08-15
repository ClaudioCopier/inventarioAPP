import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import ReporteCard from '../components/ReporteCard.jsx'

// Historial de inventarios para el trabajador (2026-08-10) -- pedido
// explícito del usuario: poder corroborar contra rondas anteriores mientras
// cuenta, o cuando no hay ninguna ronda activa. Se abre en una pestaña
// nueva desde el botón de WorkerPage.jsx, así no se pierde el conteo en
// curso. Reusa la sesión de trabajador ya activa (reportes_inventario ya
// permite "select" a cualquier logueado, ver supabase_rls_migration.sql) --
// no hace falta la clave de admin, y es explícitamente de solo lectura
// (ReporteCard se renderiza con soloLectura, sin botón de Eliminar).
export default function WorkerHistorialPage() {
  const [sesionLista, setSesionLista] = useState(false)
  const [haySesion, setHaySesion] = useState(false)
  const [reportes, setReportes] = useState(null) // null = cargando
  const [mensaje, setMensaje] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHaySesion(!!session)
      setSesionLista(true)
    })
  }, [])

  useEffect(() => {
    if (!haySesion) return
    supabase
      .from('reportes_inventario')
      .select('*')
      .order('cerrado_en', { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (error) {
          setMensaje('No se pudo cargar el historial: ' + error.message)
          setReportes([])
          return
        }
        setReportes(data || [])
      })
  }, [haySesion])

  if (!sesionLista) return null

  if (!haySesion) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h2>Iniciá sesión primero</h2>
          <p>Para ver el historial de inventarios anteriores, primero tenés que iniciar sesión como trabajador.</p>
          <a className="btn btn-primary" style={{ width: '100%' }} href="/trabajador">Ir a iniciar sesión</a>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Trabajador</div>
          <h1>Inventarios anteriores</h1>
        </div>
      </div>

      <p className="hint">Solo lectura -- para corroborar información con rondas ya cerradas. Del más reciente al más antiguo.</p>

      {mensaje && <div className="card"><p className="error-text">{mensaje}</p></div>}

      {reportes === null && <div className="card"><p>Cargando…</p></div>}

      {reportes && reportes.length === 0 && (
        <div className="card empty-state">
          <p>Todavía no se ha finalizado ningún inventario.</p>
        </div>
      )}

      {reportes && reportes.length > 0 && (
        <>
          <p className="hint">{reportes.length} reporte{reportes.length === 1 ? '' : 's'} en total.</p>
          {reportes.map((r) => (
            <ReporteCard key={r.id} reporte={r} onError={setMensaje} soloLectura />
          ))}
        </>
      )}
    </div>
  )
}
