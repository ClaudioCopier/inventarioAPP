import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient.js'
import { useSesionTrabajador } from '../../lib/useSesionTrabajador.js'
import GateTrabajador from '../../components/GateTrabajador.jsx'
import CampoFecha from '../../components/CampoFecha.jsx'

const HOY_ISO = () => new Date().toISOString().slice(0, 10)
const EPSILON = 0.001

async function registrarLog(loteId, codigo, sesion, accion, detalle) {
  await supabase.from('lotes_vencimiento_log').insert({
    lote_id: loteId, codigo, worker_id: sesion.id, worker_nombre: sesion.nombre, accion, detalle,
  })
}

// "Juntar lotes" (2026-08-23, pedido explícito del usuario): cuando un lote
// recién agregado termina con la MISMA fecha (y mismo modo) que un lote ya
// existente del mismo producto, no tiene sentido llevarlos separados --
// se suma la cantidad al lote existente y este queda dado de baja (nunca
// se borra, queda el rastro completo en el log).
async function fusionarLotes(loteOrigen, loteDestino, sesion) {
  const nuevaInicial = Number(loteDestino.cantidad_inicial) + Number(loteOrigen.cantidad_restante)
  const nuevaRestante = Number(loteDestino.cantidad_restante) + Number(loteOrigen.cantidad_restante)
  const { error: errDestino } = await supabase
    .from('lotes_vencimiento')
    .update({ cantidad_inicial: nuevaInicial, cantidad_restante: nuevaRestante, actualizado_por: sesion.nombre, actualizado_en: new Date().toISOString() })
    .eq('id', loteDestino.id)
  if (errDestino) throw new Error(errDestino.message)

  const { error: errOrigen } = await supabase
    .from('lotes_vencimiento')
    .update({ estado: 'agotado', cantidad_restante: 0, actualizado_por: sesion.nombre, actualizado_en: new Date().toISOString() })
    .eq('id', loteOrigen.id)
  if (errOrigen) throw new Error(errOrigen.message)

  await registrarLog(loteOrigen.id, loteOrigen.codigo, sesion, 'fusionado_en', { fusionado_en_lote: loteDestino.id, cantidad: loteOrigen.cantidad_restante })
  await registrarLog(loteDestino.id, loteDestino.codigo, sesion, 'recibio_fusion', { fusionado_desde_lote: loteOrigen.id, cantidad: loteOrigen.cantidad_restante })
}

// "Separar" (2026-08-23, pedido explícito del usuario): lo inverso -- un
// lote que en realidad trae unidades con fechas de vencimiento distintas
// (llegó mezclado) se reparte en 2+ lotes nuevos, cada uno con su propia
// cantidad, pendientes de fecha por separado. El original queda dado de
// baja, nunca borrado.
async function separarLote(lote, cantidades, sesion) {
  const { data: hermanos, error: errHermanos } = await supabase.from('lotes_vencimiento').select('numero_lote').eq('codigo', lote.codigo)
  if (errHermanos) throw new Error(errHermanos.message)
  let maxNumero = hermanos && hermanos.length ? Math.max(...hermanos.map((h) => h.numero_lote)) : 0

  const nuevos = []
  for (const cantidad of cantidades) {
    maxNumero += 1
    const { data: nuevo, error } = await supabase
      .from('lotes_vencimiento')
      .insert({
        codigo: lote.codigo, descripcion: lote.descripcion, numero_lote: maxNumero,
        cantidad_inicial: cantidad, cantidad_restante: cantidad, estado: 'activo', creado_por: sesion.nombre,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    nuevos.push({ id: nuevo.id, cantidad })
  }

  const { error: errOrigen } = await supabase
    .from('lotes_vencimiento')
    .update({ estado: 'agotado', cantidad_restante: 0, actualizado_por: sesion.nombre, actualizado_en: new Date().toISOString() })
    .eq('id', lote.id)
  if (errOrigen) throw new Error(errOrigen.message)

  await registrarLog(lote.id, lote.codigo, sesion, 'separado_en', { nuevos_lotes: nuevos.map((n) => n.id), cantidades })
  for (const n of nuevos) {
    await registrarLog(n.id, lote.codigo, sesion, 'creado_por_separacion', { separado_de_lote: lote.id, cantidad: n.cantidad })
  }
}

function repartirParejo(total, n) {
  const base = Math.round((Number(total) / n) * 100) / 100
  const arr = Array(n).fill(base)
  const resto = +(Number(total) - base * n).toFixed(2)
  arr[n - 1] = +(arr[n - 1] + resto).toFixed(2)
  return arr
}

// Formulario para dividir un lote en 2+ lotes con cantidades distintas --
// compartido entre un lote pendiente (antes de ponerle fecha) y uno ya
// registrado (por si la fecha se cargó mal y hay que corregir después).
function PanelSeparar({ lote, sesion, onSeparado, onCancelar }) {
  const [partes, setPartes] = useState(2)
  const [cantidades, setCantidades] = useState(() => repartirParejo(lote.cantidad_restante, 2))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  function cambiarPartes(valor) {
    const n = Math.max(2, Math.min(6, Number(valor) || 2))
    setPartes(n)
    setCantidades(repartirParejo(lote.cantidad_restante, n))
  }

  const suma = cantidades.reduce((acc, c) => acc + (Number(c) || 0), 0)
  const sumaOk = Math.abs(suma - Number(lote.cantidad_restante)) < 0.01

  async function confirmar() {
    if (!sumaOk) { setError(`Las cantidades tienen que sumar ${lote.cantidad_restante} en total.`); return }
    setError('')
    setGuardando(true)
    try {
      await separarLote(lote, cantidades.map(Number), sesion)
      onSeparado()
    } catch (e) {
      setError('No se pudo separar: ' + e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: 8, marginBottom: 12 }}>
      <p className="hint" style={{ marginTop: 0 }}>
        Separar lote {lote.numero_lote} ({lote.cantidad_restante} unidad(es)) en varios lotes con fechas distintas.
      </p>
      <div className="field" style={{ marginBottom: 12, maxWidth: 160 }}>
        <label>¿En cuántas partes?</label>
        <input type="number" min="2" max="6" value={partes} onChange={(e) => cambiarPartes(e.target.value)} />
      </div>
      <div className="row-inline" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {cantidades.map((c, i) => (
          <div className="field" key={i} style={{ width: 120 }}>
            <label>Parte {i + 1}</label>
            <input
              type="number" step="0.01" value={c}
              onChange={(e) => setCantidades((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
            />
          </div>
        ))}
      </div>
      {!sumaOk && <p className="hint">Suma actual: {suma} — tiene que dar {lote.cantidad_restante}.</p>}
      {error && <div className="error-text">{error}</div>}
      <div className="row-inline">
        <button className="btn btn-primary" onClick={confirmar} disabled={guardando || !sumaOk}>
          {guardando ? 'Separando…' : 'Confirmar separación'}
        </button>
        <button className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>Cancelar</button>
      </div>
    </div>
  )
}

// Formulario de un lote pendiente -- elige uno de los 3 modos y guarda.
// "Omitir" vale SOLO para este lote (pedido explícito del usuario): el
// próximo lote del mismo código vuelve a preguntar desde cero, así que acá
// no se guarda ninguna preferencia por producto, solo se actualiza esta fila.
function FormularioLote({ lote, lotesHermanos, sesion, onGuardado, onSepararClick }) {
  const [modo, setModo] = useState('completo')
  const [fechaElaboracion, setFechaElaboracion] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [avisoPrevioValor, setAvisoPrevioValor] = useState(14)
  const [avisoPrevioUnidad, setAvisoPrevioUnidad] = useState('dias')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  // Lote existente del mismo producto con la MISMA fecha (y mismo criterio
  // de aviso, si aplica) que lo que se está por guardar acá -- candidato a
  // juntar en vez de quedar como dos lotes separados con la misma fecha.
  const candidatoFusion = fechaVencimiento
    ? lotesHermanos.find((l) =>
        l.estado === 'activo' &&
        l.modo === modo &&
        l.fecha_vencimiento === fechaVencimiento &&
        (modo !== 'solo_vencimiento' || (Number(l.aviso_previo_valor) === Number(avisoPrevioValor) && l.aviso_previo_unidad === avisoPrevioUnidad))
      )
    : null

  async function juntarConExistente() {
    setError('')
    setGuardando(true)
    try {
      await fusionarLotes(lote, candidatoFusion, sesion)
      onGuardado()
    } catch (e) {
      setError('No se pudo juntar: ' + e.message)
    } finally {
      setGuardando(false)
    }
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
    await registrarLog(lote.id, lote.codigo, sesion, accion, payload)
    onGuardado()
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row-inline" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p className="hint" style={{ margin: 0 }}>
          Lote {lote.numero_lote} · {lote.cantidad_restante} unidad(es) sin fecha registrada
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onSepararClick}>Separar</button>
      </div>

      <div className="row-inline" style={{ marginBottom: 16 }}>
        <button type="button" className={`btn ${modo === 'completo' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModo('completo')}>Completo</button>
        <button type="button" className={`btn ${modo === 'solo_vencimiento' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModo('solo_vencimiento')}>Solo vencimiento</button>
        <button type="button" className={`btn ${modo === 'omitido' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModo('omitido')}>Omitir</button>
      </div>

      {modo === 'completo' && (
        <div className="row-inline">
          <CampoFecha label="Fecha de elaboración" value={fechaElaboracion} onChange={setFechaElaboracion} max={HOY_ISO()} />
          <CampoFecha label="Fecha de vencimiento" value={fechaVencimiento} onChange={setFechaVencimiento} />
        </div>
      )}

      {modo === 'solo_vencimiento' && (
        <div className="row-inline">
          <CampoFecha label="Fecha de vencimiento" value={fechaVencimiento} onChange={setFechaVencimiento} />
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

      {candidatoFusion && (
        <div className="card" style={{ background: 'var(--alert-warn-bg)', marginTop: 12, marginBottom: 0 }}>
          <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
            Ya hay un lote con esta misma fecha (Lote {candidatoFusion.numero_lote}, {candidatoFusion.cantidad_restante} unidad(es)) — ¿los juntamos en uno solo en vez de dejarlos separados?
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={juntarConExistente} disabled={guardando}>
            {guardando ? 'Juntando…' : `Juntar con el Lote ${candidatoFusion.numero_lote}`}
          </button>
        </div>
      )}

      {error && <div className="error-text">{error}</div>}
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={guardar} disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}

// "Últimos agregados" (2026-08-23, pedido explícito del usuario): en la
// pantalla principal, antes de entrar a la lista completa, mostrar los
// últimos lotes que el sistema detectó -- así quien abra la app ve al
// toque si hay algo nuevo sin fecha todavía, sin tener que ir a buscar.
//
// Excluye los lotes cuya creación quedó marcada "creado_reconciliacion" en
// el log -- esa acción es del motor VIEJO (por diferencia neta, reemplazado
// el 22-08 por el evento-por-evento) y ya no se vuelve a generar nunca más.
// Sin este filtro, decenas de lotes que solo capturaron por primera vez
// stock que YA estaba antes del 21-08 (detectados recién el 22 durante
// pruebas internas) aparecían acá como si fueran entradas recientes --
// confirmado por el usuario: "siguen apareciendo muchos productos".
//
// Se agrupa por PRODUCTO, no por lote (2026-08-23, pedido explícito del
// usuario): un mismo código con 2 lotes nuevos (ej.: Sensorial Pu Erh)
// aparecía dos veces en la lista -- ahora aparece una sola vez, con la
// cantidad de lotes pendientes, y al tocarlo entra a la ficha del producto
// donde se ven y cargan todos juntos.
//
// Solo lotes SIN fecha todavía (modo is null) -- pedido explícito del
// usuario: este sector es nada más para avisar qué falta por fechar, así
// que en cuanto alguien le pone fecha a un lote, desaparece de acá (aunque
// el mismo producto tenga otro lote que sí siga pendiente, en cuyo caso
// sigue apareciendo, solo que ya no cuenta el que se completó).
async function traerUltimosAgregados() {
  const { data: candidatos } = await supabase
    .from('lotes_vencimiento')
    .select('id, codigo, descripcion, numero_lote, cantidad_restante, modo, fecha_vencimiento, creado_en')
    .neq('estado', 'agotado')
    .is('modo', null)
    .order('creado_en', { ascending: false })
    .limit(50)
  if (!candidatos || !candidatos.length) return []

  const { data: viejos } = await supabase
    .from('lotes_vencimiento_log')
    .select('lote_id')
    .eq('accion', 'creado_reconciliacion')
    .in('lote_id', candidatos.map((c) => c.id))
  const idsViejos = new Set((viejos || []).map((v) => v.lote_id))
  const recientes = candidatos.filter((c) => !idsViejos.has(c.id))

  const porCodigo = new Map()
  for (const l of recientes) {
    if (!porCodigo.has(l.codigo)) {
      porCodigo.set(l.codigo, { codigo: l.codigo, descripcion: l.descripcion, creado_en: l.creado_en, lotes: [] })
    }
    porCodigo.get(l.codigo).lotes.push(l)
  }

  return [...porCodigo.values()].sort((a, b) => (a.creado_en < b.creado_en ? 1 : -1)).slice(0, 10)
}

function UltimosAgregados() {
  const [items, setItems] = useState(null)

  useEffect(() => {
    let activo = true
    traerUltimosAgregados().then((data) => { if (activo) setItems(data) })
    return () => { activo = false }
  }, [])

  if (!items || items.length === 0) return null

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <p className="hint" style={{ marginTop: 0 }}>Productos nuevos sin fecha de vencimiento todavía:</p>
      <div className="product-list">
        {items.map((p) => {
          return (
            <a
              key={p.codigo}
              className="product-card"
              style={{ textDecoration: 'none', display: 'block' }}
              href={`/vencimientos?buscar=${encodeURIComponent(p.codigo)}`}
            >
              <div className="desc">{p.descripcion}</div>
              <div className="sys">
                Código: {p.codigo} · {p.lotes.length === 1 ? '1 lote nuevo' : `${p.lotes.length} lotes nuevos`}
                {' · '}
                <span className="status-pill warn" style={{ display: 'inline-flex', padding: '2px 10px' }}>Sin fecha todavía</span>
              </div>
            </a>
          )
        })}
      </div>
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
  const [separandoId, setSeparandoId] = useState(null)

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
    setSeparandoId(null)
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
    setSeparandoId(null)
    if (seleccionado) elegirProducto(seleccionado)
  }

  // Llegada desde ListaPage.jsx ("Cargar fecha" en una fila puntual) o desde
  // "Últimos agregados" -- pedido explícito del usuario (2026-08-23): antes
  // esto solo precargaba el término de búsqueda y mostraba la lista de
  // resultados, obligando a tocar el producto una segunda vez para recién
  // ahí ver el formulario. Ahora, como se conoce el código EXACTO, busca por
  // igualdad (no por texto parcial) y entra directo a la ficha del producto,
  // sin ese paso intermedio.
  async function buscarYAbrirDirecto(codigo) {
    setBuscando(true)
    setSeleccionado(null)
    const { data, error } = await supabase
      .from('products')
      .select('codigo, descripcion, inventario_sistema')
      .eq('codigo', codigo)
      .limit(1)
    setBuscando(false)
    if (error) { setMensaje('Error al buscar: ' + error.message); return }
    if (data && data.length) {
      setResultados(data)
      elegirProducto(data[0])
    } else {
      setResultados([])
      setMensaje(`No se encontró el producto con código ${codigo}.`)
    }
  }

  useEffect(() => {
    if (!sesion) return
    const params = new URLSearchParams(window.location.search)
    const codigoPrellenado = params.get('buscar')
    if (!codigoPrellenado) return
    setBusqueda(codigoPrellenado)
    buscarYAbrirDirecto(codigoPrellenado)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion])

  if (!sesionLista) return null
  if (!sesion) return <GateTrabajador onIngresar={() => { window.location.href = '/' }} />

  const pendientes = (lotes || []).filter((l) => !l.modo && l.estado === 'activo')
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
          <a className="btn btn-ghost" href="/vencimientos/historial">Historial</a>
          <a className="btn btn-ghost" href="/">Inicio</a>
          <button className="btn btn-ghost" onClick={salir}>Salir</button>
        </div>
      </div>

      {!seleccionado && <UltimosAgregados />}

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
              <button className="btn btn-ghost" onClick={() => { setSeleccionado(null); setLotes(null); setSeparandoId(null) }}>Volver a buscar</button>
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
            <div key={lote.id}>
              {separandoId === lote.id ? (
                <PanelSeparar lote={lote} sesion={sesion} onSeparado={recargarLotesActual} onCancelar={() => setSeparandoId(null)} />
              ) : (
                <FormularioLote
                  lote={lote}
                  lotesHermanos={(lotes || []).filter((l) => l.id !== lote.id)}
                  sesion={sesion}
                  onGuardado={recargarLotesActual}
                  onSepararClick={() => setSeparandoId(lote.id)}
                />
              )}
            </div>
          ))}

          {yaCargados.length > 0 && (
            <div className="card">
              <p className="hint" style={{ marginTop: 0 }}>Lotes ya registrados de este producto:</p>
              <div className="tabla-scroll">
                <table className="table-preview">
                  <thead>
                    <tr><th>Lote</th><th>Cantidad</th><th>Modo</th><th>Vencimiento</th><th>Estado</th><th></th></tr>
                  </thead>
                  <tbody>
                    {yaCargados.map((l) => (
                      <tr key={l.id}>
                        <td>{l.numero_lote}</td>
                        <td>{l.cantidad_restante}</td>
                        <td>{l.modo === 'completo' ? 'Completo' : l.modo === 'solo_vencimiento' ? 'Solo vencimiento' : 'Omitido'}</td>
                        <td>{l.fecha_vencimiento || '—'}</td>
                        <td>{l.estado === 'agotado' ? 'Agotado' : 'Activo'}</td>
                        <td>
                          {l.estado === 'activo' && Number(l.cantidad_restante) > EPSILON && (
                            separandoId === l.id ? null : (
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSeparandoId(l.id)}>Separar</button>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {separandoId && yaCargados.some((l) => l.id === separandoId) && (
                <PanelSeparar
                  lote={yaCargados.find((l) => l.id === separandoId)}
                  sesion={sesion}
                  onSeparado={recargarLotesActual}
                  onCancelar={() => setSeparandoId(null)}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default PantallaCargar
