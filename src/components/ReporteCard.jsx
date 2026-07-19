import { useState } from 'react'
import { exportarReporteExcel } from '../lib/exportarReporteExcel.js'

export default function ReporteCard({ reporte: r, onError }) {
  const [abierto, setAbierto] = useState(false)
  const [filtroDetalle, setFiltroDetalle] = useState('todo') // todo | falta | sobra | descuadrados
  const [exportando, setExportando] = useState(false)

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
    setFiltroDetalle('todo')
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
          <button className="btn btn-secondary" onClick={exportar} disabled={exportando}>
            {exportando ? 'Exportando…' : 'Exportar a Excel'}
          </button>
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
          <div className="tabla-scroll">
            <table className="table-preview">
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th>Sistema</th>
                  <th>Tienda</th>
                  <th>Cajas</th>
                  <th>Vitrina</th>
                  <th>Estado</th>
                  <th>Trabajadores</th>
                </tr>
              </thead>
              <tbody>
                {filasFiltradas.map((f, i) => (
                  <tr key={i}>
                    <td>{f.descripcion}</td>
                    <td>{f.inventario_sistema}</td>
                    <td>{f.en_tienda}</td>
                    <td>{f.en_cajas}</td>
                    <td>{f.en_vitrina}</td>
                    <td>{f.estado}</td>
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
