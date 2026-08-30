import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient.js'
import { useSesionTrabajador } from '../../lib/useSesionTrabajador.js'
import GateTrabajador from '../../components/GateTrabajador.jsx'

// Trazabilidad de Vencimientos (2026-08-23, pedido explícito del usuario
// desde el principio de esta feature: "que quede registrado el login y
// quien lo realizó"). Hasta ahora el rastro solo se podía revisar
// consultando lotes_vencimiento_log directo en la base -- esta pantalla lo
// hace visible para cualquiera con sesión, igual que el resto de
// Vencimientos (trabajador o admin).
const ACCION_LABEL = {
  cargado: 'Cargó fecha',
  omitido: 'Omitió',
  reactivado: 'Quitó de omitidos',
  creado_entrada: 'Entrada detectada (cierre)',
  creado_devolucion: 'Devolución detectada (cierre)',
  creado_ajuste: 'Ajuste detectado (cierre)',
  creado_en_vivo: 'Entrada detectada (hoy, sin confirmar)',
  creado_reconciliacion: 'Detectado (motor anterior)',
  consumido_venta: 'Venta descontada (cierre)',
  consumido_ajuste: 'Ajuste descontado (cierre)',
  superado_por_historico: 'Reemplazado por el cierre real',
  confirmado_por_historico: 'Confirmado por el cierre real',
  fusionado_en: 'Fusionado en otro lote',
  recibio_fusion: 'Recibió una fusión',
  separado_en: 'Separado en varios lotes',
  creado_por_separacion: 'Creado al separar otro lote',
  corregido_manual: 'Corrección manual',
}

function PantallaHistorial() {
  const { sesion, sesionLista } = useSesionTrabajador()
  const [entradas, setEntradas] = useState(null)
  const [mensaje, setMensaje] = useState('')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    if (!sesion) return
    supabase
      .from('lotes_vencimiento_log')
      .select('id, codigo, worker_nombre, accion, creado_en, lotes_vencimiento(numero_lote, descripcion)')
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
    const descripcion = e.lotes_vencimiento?.descripcion || ''
    return e.codigo?.toLowerCase().includes(termino) || descripcion.toLowerCase().includes(termino) || (e.worker_nombre || '').toLowerCase().includes(termino)
  })

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Vencimientos — {sesion.nombre}</div>
          <h1>Historial</h1>
        </div>
        <div className="row-inline" style={{ gap: 8 }}>
          <a className="btn btn-ghost" href="/vencimientos">Inicio</a>
          <a className="btn btn-ghost" href="/vencimientos/lista">Ver lista</a>
          <a className="btn btn-ghost" href="/">Salir</a>
        </div>
      </div>

      <p className="hint">Últimos 300 movimientos, más reciente primero — quién cargó qué fecha, qué se omitió, y qué detectó el sistema solo.</p>

      <div className="field" style={{ marginBottom: 12, maxWidth: 360 }}>
        <input type="text" placeholder="Filtrar por producto, código o persona…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
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
              <tr><th>Cuándo</th><th>Producto</th><th>Lote</th><th>Acción</th><th>Quién</th></tr>
            </thead>
            <tbody>
              {visibles.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.creado_en).toLocaleString('es-CL')}</td>
                  <td>{e.lotes_vencimiento?.descripcion || e.codigo}</td>
                  <td>{e.lotes_vencimiento?.numero_lote ?? '—'}</td>
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
