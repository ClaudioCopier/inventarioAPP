import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient.js'
import { useSesionTrabajador } from '../../lib/useSesionTrabajador.js'
import GateTrabajador from '../../components/GateTrabajador.jsx'

// Trazabilidad de Turnos (2026-08-29) -- mismo espíritu que
// pages/vencimientos/HistorialPage.jsx: "que quede registrado el login y
// quien lo realizó" cada vez que alguien marca o corrige un turno. RLS ya
// limita lo que trae la consulta -- un trabajador ve solo su propio
// rastro, admin ve todo.
const ACCION_LABEL = {
  marcado_entrada: 'Marcó entrada',
  marcado_almuerzo_inicio: 'Salió a almorzar',
  marcado_almuerzo_fin: 'Volvió de almorzar',
  marcado_salida: 'Marcó salida',
  creado_admin: 'Turno creado por admin',
  corregido_trabajador: 'Corrigió su propio turno',
  corregido_admin: 'Corregido por admin',
  cerrado_forzado_admin: 'Cierre forzado por admin',
  calculo_ventas: 'Se calculó venta/comisión',
}

function PantallaHistorial() {
  const { sesion, sesionLista, salir } = useSesionTrabajador()
  const [entradas, setEntradas] = useState(null)
  const [mensaje, setMensaje] = useState('')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    if (!sesion) return
    supabase
      .from('turnos_log')
      .select('id, worker_nombre, accion, creado_en, turnos(fecha)')
      .order('id', { ascending: false })
      .limit(300)
      .then(({ data, error }) => {
        if (error) { setMensaje('No se pudo cargar el historial: ' + error.message); setEntradas([]); return }
        setEntradas(data || [])
      })
  }, [sesion])

  if (!sesionLista) return null
  if (!sesion) return <GateTrabajador onIngresar={() => { window.location.href = '/' }} />

  const termino = busqueda.trim().toLowerCase()
  const visibles = (entradas || []).filter((e) => {
    if (!termino) return true
    return (e.worker_nombre || '').toLowerCase().includes(termino) || (ACCION_LABEL[e.accion] || e.accion).toLowerCase().includes(termino)
  })

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Turnos — {sesion.nombre}</div>
          <h1>Historial</h1>
        </div>
        <div className="row-inline" style={{ gap: 8 }}>
          <a className="btn btn-ghost" href="/turnos">Marcar turno</a>
          {sesion.rol === 'admin' && <a className="btn btn-ghost" href="/turnos/admin">Panel admin</a>}
          <a className="btn btn-ghost" href="/">Inicio</a>
          <button className="btn btn-ghost" onClick={salir}>Salir</button>
        </div>
      </div>

      <p className="hint">
        {sesion.rol === 'admin'
          ? 'Últimos 300 movimientos de todos los trabajadores, más reciente primero.'
          : 'Tus últimos movimientos, más reciente primero.'}
      </p>

      <div className="field" style={{ marginBottom: 12, maxWidth: 360 }}>
        <input type="text" placeholder="Filtrar por persona o acción…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      </div>

      {mensaje && <div className="card"><p className="error-text">{mensaje}</p></div>}

      {entradas === null && <div className="card"><p>Cargando…</p></div>}

      {entradas !== null && visibles.length === 0 && (
        <div className="card empty-state"><p>No hay movimientos para mostrar.</p></div>
      )}

      {entradas !== null && visibles.length > 0 && (
        <div className="tabla-scroll">
          <table className="table-preview">
            <thead>
              <tr><th>Cuándo</th><th>Turno</th><th>Acción</th><th>Quién</th></tr>
            </thead>
            <tbody>
              {visibles.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.creado_en).toLocaleString('es-CL')}</td>
                  <td>{e.turnos?.fecha ?? '—'}</td>
                  <td>{ACCION_LABEL[e.accion] || e.accion}</td>
                  <td>{e.worker_nombre || <span className="hint">motor automático</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default PantallaHistorial
