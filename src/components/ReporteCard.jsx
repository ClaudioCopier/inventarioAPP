import { useState } from 'react'
import { supabase } from '../supabaseClient.js'
import { exportarReporteExcel } from '../lib/exportarReporteExcel.js'

export default function ReporteCard({ reporte: r, onError, onEliminado, soloLectura = false }) {
  const [abierto, setAbierto] = useState(false)
  // Por defecto se muestran los descuadres -- es lo que de verdad hay que
  // revisar al abrir un reporte, "Todo" sigue disponible a un clic.
  const [filtroDetalle, setFiltroDetalle] = useState('descuadrados') // todo | falta | sobra | descuadrados
  const [exportando, setExportando] = useState(false)
  const [eliminando, setEliminando] = useState(false)

  // Pedido explícito del usuario (2026-08-09) -- limpiar reportes duplicados
  // o que salieron mal (ver caso real "HUASCO 08-08" x2, uno de los dos
  // sobra). Antes no había forma de borrar un reporte finalizado desde la
  // app, solo a mano en Supabase.
  async function eliminar() {
    if (!confirm(`¿Eliminar el reporte "${r.ronda || '(sin nombre)'}" del ${new Date(r.cerrado_en).toLocaleDateString('es-CL')}? Esta acción no se puede deshacer.`)) return
    setEliminando(true)
    const { error } = await supabase.from('reportes_inventario').delete().eq('id', r.id)
    setEliminando(false)
    if (error) {
      onError?.('No se pudo eliminar el reporte: ' + error.message)
      return
    }
    onEliminado?.(r.id)
  }

  const cuadrados = (r.resumen || []).filter((f) => f.estado === 'Cuadrado').length
  const faltantes = (r.resumen || []).filter((f) => f.estado.startsWith('Faltan')).length
  const sobrantes = (r.resumen || []).filter((f) => f.estado.startsWith('Sobran')).length
  const filasFiltradas = (r.resumen || []).filter((f) => {
    if (filtroDetalle === 'falta') return f.estado.startsWith('Faltan')
    if (filtroDetalle === 'sobra') return f.estado.startsWith('Sobran')
    if (filtroDetalle === 'descuadrados') return f.estado !== 'Cuadrado'
    return true
  })

  function alternar() {
    setAbierto((prev) => !prev)
    setFiltroDetalle('descuadrados')
  }

  async function exportar() {
    setExportando(true)
    try {
      await exportarReporteExcel(r)
    } catch (err) {
      onError?.('Error al exportar: ' + err.message)
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="row-inline" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <strong>{r.ronda || '(sin nombre)'}</strong>
          <p className="hint" style={{ margin: 0 }}>
            Cerrado por {r.cerrado_por} el {new Date(r.cerrado_en).toLocaleString('es-CL')} · {r.resumen?.length || 0} productos ·{' '}
            {cuadrados} cuadrados, {faltantes} con faltantes, {sobrantes} con sobrantes
          </p>
          <p className="hint" style={{ margin: 0 }}>Participantes: {(r.participantes || []).join(', ') || '—'}</p>
        </div>
        <div className="row-inline" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={alternar}>
            {abierto ? 'Ocultar' : 'Ver detalle'}
          </button>
          {!soloLectura && (
            <button className="btn btn-secondary" onClick={exportar} disabled={exportando}>
              {exportando ? 'Exportando…' : 'Exportar a Excel'}
            </button>
          )}
          {!soloLectura && (
            <button className="btn btn-danger" onClick={eliminar} disabled={eliminando}>
              {eliminando ? 'Eliminando…' : 'Eliminar'}
            </button>
          )}
        </div>
      </div>
      {abierto && (
        <>
          <div className="row-inline" style={{ marginTop: 12, marginBottom: 10 }}>
            <button className={`btn ${filtroDetalle === 'todo' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFiltroDetalle('todo')}>
              Todo ({r.resumen?.length || 0})
            </button>
            <button className={`btn ${filtroDetalle === 'falta' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFiltroDetalle('falta')}>
              Faltan ({faltantes})
            </button>
            <button className={`btn ${filtroDetalle === 'sobra' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFiltroDetalle('sobra')}>
              Sobran ({sobrantes})
            </button>
            <button className={`btn ${filtroDetalle === 'descuadrados' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFiltroDetalle('descuadrados')}>
              Descuadrados ({faltantes + sobrantes})
            </button>
          </div>
          {/* Vista rápida para análisis en pantalla: solo lo esencial.
              El detalle completo (sistema/tienda/cajas/vitrina) sigue
              disponible en el Excel exportado. */}
          <div className="tabla-scroll">
            <table className="table-preview">
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th>Descuadre</th>
                  <th>Cajas extra</th>
                  <th>Observación</th>
                  <th>Trabajadores a cargo</th>
                </tr>
              </thead>
              <tbody>
                {filasFiltradas.map((f, i) => (
                  <tr key={i}>
                    <td>{f.descripcion}</td>
                    <td>{f.estado}</td>
                    <td>{(f.cajas_extra || []).length > 0 ? f.cajas_extra.join(' + ') : '—'}</td>
                    <td>{f.observacion || '—'}</td>
                    <td>{(f.trabajadores || []).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
