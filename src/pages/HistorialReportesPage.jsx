import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import ReporteCard from '../components/ReporteCard.jsx'

const ADMIN_CLAVE = import.meta.env.VITE_ADMIN_CLAVE || ''

export default function HistorialReportesPage() {
  const [autenticado, setAutenticado] = useState(false)
  const [claveIngresada, setClaveIngresada] = useState('')
  const [errorClave, setErrorClave] = useState('')
  const [reportes, setReportes] = useState(null) // null = cargando
  const [mensaje, setMensaje] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const clave = params.get('clave')
    if (clave && ADMIN_CLAVE && clave === ADMIN_CLAVE) setAutenticado(true)
  }, [])

  useEffect(() => {
    if (!autenticado) return
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
  }, [autenticado])

  function intentarLogin(e) {
    e.preventDefault()
    if (!ADMIN_CLAVE) {
      setErrorClave('No se configuró VITE_ADMIN_CLAVE en el servidor. Revisa el archivo .env')
      return
    }
    if (claveIngresada === ADMIN_CLAVE) {
      setAutenticado(true)
      setErrorClave('')
    } else {
      setErrorClave('Clave incorrecta')
    }
  }

  if (!autenticado) {
    return (
      <div className="gate">
        <form className="gate-card" onSubmit={intentarLogin}>
          <h2>Acceso administrador</h2>
          <p>Ingresa la clave para ver el historial completo de reportes.</p>
          <div className="field">
            <label htmlFor="clave">Clave</label>
            <input
              id="clave"
              type="password"
              value={claveIngresada}
              onChange={(e) => setClaveIngresada(e.target.value)}
              autoFocus
            />
          </div>
          {errorClave && <div className="error-text">{errorClave}</div>}
          <button className="btn btn-primary" style={{ width: '100%' }} type="submit">Entrar</button>
        </form>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Administrador</div>
          <h1>Historial de inventarios</h1>
        </div>
        <a className="btn btn-ghost" href={`/admin`}>Volver al panel</a>
      </div>

      <p className="hint">Todos los inventarios finalizados, del más reciente al más antiguo. Estos reportes nunca se borran automáticamente.</p>

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
            <ReporteCard key={r.id} reporte={r} onError={setMensaje} />
          ))}
        </>
      )}
    </div>
  )
}
