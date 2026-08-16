import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient.js'
import { useSesionTrabajador } from '../../lib/useSesionTrabajador.js'
import GateTrabajador from '../../components/GateTrabajador.jsx'

const HOY_ISO = () => new Date().toISOString().slice(0, 10)

// Formulario de un lote pendiente -- elige uno de los 3 modos y guarda.
// "Omitir" vale SOLO para este lote (pedido explícito del usuario): el
// próximo lote del mismo código vuelve a preguntar desde cero, así que acá
// no se guarda ninguna preferencia por producto, solo se actualiza esta fila.
function FormularioLote({ lote, sesion, onGuardado }) {
  const [modo, setModo] = useState('completo')
  const [fechaElaboracion, setFechaElaboracion] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [avisoPrevioValor, setAvisoPrevioValor] = useState(14)
  const [avisoPrevioUnidad, setAvisoPrevioUnidad] = useState('dias')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function registrarLog(loteId, accion, detalle) {
    await supabase.from('lotes_vencimiento_log').insert({
      lote_id: loteId,
      codigo: lote.codigo,
      worker_id: sesion.id,
      worker_nombre: sesion.nombre,
      accion,
      detalle,
    })
  }

  async function guardar() {
    setError('')
    let payload = { actualizado_por: sesion.nombre, actualizado_en: new Date().toISOString() }
    let accion = 'cargado'

    if (modo === 'completo') {
      if (!fechaElaboracion || !fechaVencimiento) { setError('Completa las dos fechas.'); return }
      if (fechaVencimiento <= fechaElaboracion) { setError('El vencimiento tiene que ser después de la elaboración.'); return }
      payload = { ...payload, modo: 'completo', fecha_elaboracion: fechaElaboracion, fecha_vencimiento: fechaVencimiento, aviso_previo_valor: null, aviso_previo_unidad: null }
    } else if (modo === 'solo_vencimiento') {
      if (!fechaVencimiento) { setError('Completa la fecha de vencimiento.'); return }
      if (!avisoPrevioValor || Number(avisoPrevioValor) <= 0) { setError('Indica con cuánto tiempo de anticipación avisar.'); return }
      payload = { ...payload, modo: 'solo_vencimiento', fecha_elaboracion: null, fecha_vencimiento: fechaVencimiento, aviso_previo_valor: Number(avisoPrevioValor), aviso_previo_unidad: avisoPrevioUnidad }
    } else {
      payload = { ...payload, modo: 'omitido', omitido_por: sesion.nombre, omitido_en: new Date().toISOString(), fecha_elaboracion: null, fecha_vencimiento: null, aviso_previo_valor: null, aviso_previo_unidad: null }
      accion = 'omitido'
    }

    setGuardando(true)
    const { error: errUpdate } = await supabase.from('lotes_vencimiento').update(payload).eq('id', lote.id)
    setGuardando(false)
    if (errUpdate) { setError('No se pudo guardar: ' + errUpdate.message); return }
    await registrarLog(lote.id, accion, payload)
    onGuardado()
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <p className="hint" style={{ margin: '0 0 12px' }}>
        Lote {lote.numero_lote} · {lote.cantidad_restante} unidad(es) sin fecha registrada
      </p>

      <div className="row-inline" style={{ marginBottom: 16 }}>
        <button type="button" className={`btn ${modo === 'completo' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModo('completo')}>Completo</button>
        <button type="button" className={`btn ${modo === 'solo_vencimiento' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModo('solo_vencimiento')}>Solo vencimiento</button>
        <button type="button" className={`btn ${modo === 'omitido' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModo('omitido')}>Omitir</button>
      </div>

      {modo === 'completo' && (
        <div className="row-inline">
          <div className="field">
            <label>Fecha de elaboración</label>
            <input type="date" max={HOY_ISO()} value={fechaElaboracion} onChange={(e) => setFechaElaboracion(e.target.value)} />
          </div>
          <div className="field">
            <label>Fecha de vencimiento</label>
            <input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} />
          </div>
        </div>
      )}

      {modo === 'solo_vencimiento' && (
        <div className="row-inline">
          <div className="field">
            <label>Fecha de vencimiento</label>
            <input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} />
          </div>
          <div className="field">
            <label>Avisar con anticipación</label>
            <div className="row-inline" style={{ gap: 8 }}>
              <input type="number" min="1" style={{ width: 80 }} value={avisoPrevioValor} onChange={(e) => setAvisoPrevioValor(e.target.value)} />
              <select value={avisoPrevioUnidad} onChange={(e) => setAvisoPrevioUnidad(e.target.value)}>
                <option value="dias">día(s)</option>
                <option value="semanas">semana(s)</option>
                <option value="meses">mes(es)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {modo === 'omitido' && (
        <p className="hint">No se le va a hacer seguimiento a este lote. La próxima vez que llegue stock nuevo de este producto, se vuelve a preguntar.</p>
      )}

      {error && <div className="error-text">{error}</div>}
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={guardar} disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}

function PantallaCargar() {
  const { sesion, sesionLista, salir } = useSesionTrabajador()
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState(null) // null = sin buscar todavía
  const [buscando, setBuscando] = useState(false)
  const [seleccionado, setSeleccionado] = useState(null)
  const [lotes, setLotes] = useState(null)
  const [cargandoLotes, setCargandoLotes] = useState(false)
  const [mensaje, setMensaje] = useState('')

  async function buscar(e, terminoForzado) {
    e?.preventDefault()
    const termino = (terminoForzado ?? busqueda).trim()
    if (!termino) return
    setBuscando(true)
    setSeleccionado(null)
    const { data, error } = await supabase
      .from('products')
      .select('codigo, descripcion, inventario_sistema')
      .or(`codigo.ilike.%${termino}%,descripcion.ilike.%${termino}%`)
      .order('descripcion', { ascending: true })
      .limit(25)
    setBuscando(false)
    if (error) { setMensaje('Error al buscar: ' + error.message); return }
    setResultados(data || [])
  }

  async function elegirProducto(producto) {
    setSeleccionado(producto)
    setMensaje('')
    setCargandoLotes(true)
    const { data, error } = await supabase
      .from('lotes_vencimiento')
      .select('*')
      .eq('codigo', producto.codigo)
      .order('numero_lote', { ascending: true })
    setCargandoLotes(false)
    if (error) { setMensaje('Error al cargar lotes: ' + error.message); return }
    setLotes(data || [])
  }

  function recargarLotesActual() {
    if (seleccionado) elegirProducto(seleccionado)
  }

  // Llegada desde ListaPage.jsx ("Cargar fecha" en una fila puntual) --
  // busca directo el código sin que el trabajador tenga que tipearlo nuevo.
  useEffect(() => {
    if (!sesion) return
    const params = new URLSearchParams(window.location.search)
    const codigoPrellenado = params.get('buscar')
    if (!codigoPrellenado) return
    setBusqueda(codigoPrellenado)
    buscar(null, codigoPrellenado)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion])

  if (!sesionLista) return null
  if (!sesion) return <GateTrabajador onIngresar={() => {}} />

  const pendientes = (lotes || []).filter((l) => !l.modo)
  const yaCargados = (lotes || []).filter((l) => l.modo)

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Vencimientos — {sesion.nombre}</div>
          <h1>Cargar producto</h1>
        </div>
        <div className="row-inline" style={{ gap: 8 }}>
          <a className="btn btn-ghost" href="/vencimientos/lista">Ver lista completa</a>
          <a className="btn btn-ghost" href="/">Inicio</a>
          <button className="btn btn-ghost" onClick={salir}>Salir</button>
        </div>
      </div>

      <form className="card" onSubmit={buscar}>
        <div className="field" style={{ marginBottom: 12 }}>
          <label htmlFor="busqueda">Buscar por código o nombre</label>
          <input id="busqueda" type="text" autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Ej: 7801234567890 o ASHWAGANDHA" />
        </div>
        <button className="btn btn-primary" type="submit" disabled={buscando}>{buscando ? 'Buscando…' : 'Buscar'}</button>
      </form>

      {mensaje && <div className="card"><p className="error-text">{mensaje}</p></div>}

      {resultados && resultados.length === 0 && (
        <div className="card empty-state"><p>No se encontró ningún producto con ese código o nombre.</p></div>
      )}

      {resultados && resultados.length > 0 && !seleccionado && (
        <div className="card">
          <p className="hint" style={{ marginTop: 0 }}>{resultados.length} resultado(s) — tocá uno para ver sus lotes.</p>
          <div className="product-list">
            {resultados.map((p) => (
              <button key={p.codigo} type="button" className="product-card" style={{ textAlign: 'left', cursor: 'pointer', border: 'none', width: '100%' }} onClick={() => elegirProducto(p)}>
                <div className="desc">{p.descripcion}</div>
                <div className="sys">Código: {p.codigo} · Existencia: {p.inventario_sistema}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {seleccionado && (
        <>
          <div className="card">
            <div className="row-inline" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{seleccionado.descripcion}</strong>
                <p className="hint" style={{ margin: 0 }}>Código: {seleccionado.codigo} · Existencia actual: {seleccionado.inventario_sistema}</p>
              </div>
              <button className="btn btn-ghost" onClick={() => { setSeleccionado(null); setLotes(null) }}>Volver a buscar</button>
            </div>
          </div>

          {cargandoLotes && <div className="card"><p>Cargando lotes…</p></div>}

          {!cargandoLotes && lotes && lotes.length === 0 && (
            <div className="card empty-state"><p>Este producto todavía no tiene ningún lote registrado. Se crea solo cuando el sistema detecta stock nuevo.</p></div>
          )}

          {!cargandoLotes && pendientes.length === 0 && lotes && lotes.length > 0 && (
            <div className="card empty-state"><p>No hay ningún lote pendiente de fecha para este producto ahora mismo.</p></div>
          )}

          {pendientes.map((lote) => (
            <FormularioLote key={lote.id} lote={lote} sesion={sesion} onGuardado={recargarLotesActual} />
          ))}

          {yaCargados.length > 0 && (
            <div className="card">
              <p className="hint" style={{ marginTop: 0 }}>Lotes ya registrados de este producto:</p>
              <div className="tabla-scroll">
                <table className="table-preview">
                  <thead>
                    <tr><th>Lote</th><th>Cantidad</th><th>Modo</th><th>Vencimiento</th></tr>
                  </thead>
                  <tbody>
                    {yaCargados.map((l) => (
                      <tr key={l.id}>
                        <td>{l.numero_lote}</td>
                        <td>{l.cantidad_restante}</td>
                        <td>{l.modo === 'completo' ? 'Completo' : l.modo === 'solo_vencimiento' ? 'Solo vencimiento' : 'Omitido'}</td>
                        <td>{l.fecha_vencimiento || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default PantallaCargar
