import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient.js'
import { useSesionTrabajador } from '../../lib/useSesionTrabajador.js'
import GateTrabajador from '../../components/GateTrabajador.jsx'
import { traerTodasLasFilas } from '../../lib/traerTodasLasFilas.js'
import { clasificarLote, calcularAlerta, diasEntre } from '../../lib/vencimientosReglas.js'

const FILTROS = [
  { clave: 'pendiente', label: 'Pendientes de fecha' },
  { clave: 'vencido', label: 'Vencidos' },
  { clave: 'proximo', label: 'Próximos a vencer' },
  { clave: 'todo', label: 'Todo' },
  { clave: 'omitido', label: 'Omitidos' },
]

// Días sin fecha antes de avisar que un pendiente lleva demasiado tiempo sin
// decidirse (2026-08-23, pedido explícito del usuario) -- no cambia el
// orden alfabético que ya se pidió, solo lo marca para que no se pierda
// entre los demás.
const DIAS_PENDIENTE_VIEJO = 7

// "Omitir" solo tiene sentido en lotes que todavía no tienen (o dejaron de
// tener validez) una fecha real asignada por alguien -- ofrecerlo también en
// lotes "con fecha" (ok) arriesgaba descartar de un click un seguimiento ya
// cargado a mano, sin avisar ni limpiar la fecha vieja (pedido explícito del
// usuario tras revisar la app, 2026-08-23).
function puedeOmitir(clase) {
  return clase === 'pendiente' || clase === 'vencido' || clase === 'proximo'
}

// Agrupar por producto, no por lote (2026-09-05, pedido explícito del
// usuario: un producto con 2+ lotes en la misma pestaña aparecía como
// tarjetas separadas y sueltas, sin forma de verlos ni accionarlos juntos).
// Dentro de una pestaña ya filtrada todos los lotes de un mismo grupo
// suelen compartir clase -- la excepción es "Todo" (mezcla ok/vencido/
// próximo/pendiente) -- por eso la urgencia se calcula por lote, y el lote
// más urgente del grupo es el que decide qué pastilla/fecha mostrar en la
// tarjeta. "Omitir" en la tarjeta solo toca los lotes que de verdad se
// pueden omitir dentro del grupo (nunca uno con fecha real "ok", aunque
// esté mezclado ahí por la pestaña "Todo").
const ORDEN_URGENCIA = { vencido: 0, proximo: 1, pendiente: 2, ok: 3, omitido: 4 }
function loteMasUrgente(lotes) {
  return [...lotes].sort((a, b) => (ORDEN_URGENCIA[a._clase] ?? 9) - (ORDEN_URGENCIA[b._clase] ?? 9))[0]
}
function agruparPorProducto(lotesClasificados) {
  const porCodigo = new Map()
  for (const l of lotesClasificados) {
    if (!porCodigo.has(l.codigo)) porCodigo.set(l.codigo, { codigo: l.codigo, descripcion: l.descripcion, lotes: [] })
    porCodigo.get(l.codigo).lotes.push(l)
  }
  return [...porCodigo.values()].map((g) => ({
    ...g,
    representante: loteMasUrgente(g.lotes),
    seleccionables: g.lotes.filter((l) => puedeOmitir(l._clase)),
  }))
}

function PantallaLista() {
  const { sesion, sesionLista } = useSesionTrabajador()
  const [lotes, setLotes] = useState(null) // null = cargando
  const [filtro, setFiltro] = useState('pendiente')
  const [busqueda, setBusqueda] = useState('')
  const [omitiendo, setOmitiendo] = useState({}) // id -> bool
  const [omitiendoVarios, setOmitiendoVarios] = useState(false)
  const [seleccionados, setSeleccionados] = useState(() => new Set())
  const [mensaje, setMensaje] = useState('')
  const [mensajeEsError, setMensajeEsError] = useState(false)

  const cargar = useCallback(async () => {
    setLotes(null)
    try {
      const data = await traerTodasLasFilas('lotes_vencimiento', '*', (q) => q.neq('estado', 'agotado'))
      setLotes(data)
    } catch (err) {
      setMensaje('No se pudo cargar: ' + err.message)
      setMensajeEsError(true)
      setLotes([])
    }
  }, [])

  useEffect(() => {
    if (sesion) cargar()
  }, [sesion, cargar])

  // "Actualizar" se movió a la pantalla principal (CargarPage, /vencimientos)
  // -- pedido explícito del usuario (2026-08-29): que esté siempre en un
  // solo lugar en vez de repetido en cada pantalla de Vencimientos.

  // Omitir el grupo entero de una (2026-09-05, pedido explícito del usuario):
  // un click en la tarjeta de un producto con 2+ lotes omite TODOS sus
  // lotes de un saque, no uno por uno -- pero solo los que de verdad se
  // pueden omitir (grupo.seleccionables ya excluye los "ok" que puedan
  // colarse mezclados en la pestaña "Todo").
  async function omitirGrupo(grupo) {
    const ids = grupo.seleccionables.map((l) => l.id)
    if (!ids.length) return
    setOmitiendo((prev) => ({ ...prev, [grupo.codigo]: true }))
    const payload = {
      modo: 'omitido',
      // Limpia cualquier fecha que el lote ya tuviera (2026-08-23, pedido
      // explícito del usuario) -- "Omitir" ahora también puede aplicarse a
      // un vencido/próximo con fecha real cargada; sin esto esa fecha
      // quedaba huérfana en la fila (nunca se mostraba, pero tampoco se
      // borraba de verdad).
      fecha_elaboracion: null, fecha_vencimiento: null, aviso_previo_valor: null, aviso_previo_unidad: null,
      omitido_por: sesion.nombre,
      omitido_en: new Date().toISOString(),
      actualizado_por: sesion.nombre,
      actualizado_en: new Date().toISOString(),
    }
    const { error } = await supabase.from('lotes_vencimiento').update(payload).in('id', ids)
    if (!error) {
      await supabase.from('lotes_vencimiento_log').insert(
        ids.map((id) => ({ lote_id: id, codigo: grupo.codigo, worker_id: sesion.id, worker_nombre: sesion.nombre, accion: 'omitido', detalle: payload }))
      )
      setLotes((prev) => prev.map((l) => (ids.includes(l.id) ? { ...l, ...payload } : l)))
    } else {
      setMensaje('No se pudo omitir: ' + error.message)
      setMensajeEsError(true)
    }
    setOmitiendo((prev) => ({ ...prev, [grupo.codigo]: false }))
  }

  // Selección múltiple por grupo: marcar/desmarcar la tarjeta agrega o
  // saca del set TODOS los ids seleccionables del producto de una vez.
  function alternarSeleccionGrupo(grupo) {
    setSeleccionados((prev) => {
      const copia = new Set(prev)
      const ids = grupo.seleccionables.map((l) => l.id)
      const todosMarcados = ids.length > 0 && ids.every((id) => copia.has(id))
      if (todosMarcados) ids.forEach((id) => copia.delete(id))
      else ids.forEach((id) => copia.add(id))
      return copia
    })
  }

  // Omitir varios de una (2026-08-23, pedido explícito del usuario): mismo
  // criterio que omitir() individual, solo que en un solo update por los
  // ids elegidos -- para no esperar 1 por 1 cuando hay varios que no
  // importan (velas, envases, etc.) revisados de una pasada.
  async function omitirSeleccionados() {
    const ids = [...seleccionados]
    if (!ids.length) return
    setOmitiendoVarios(true)
    const payload = {
      modo: 'omitido',
      fecha_elaboracion: null, fecha_vencimiento: null, aviso_previo_valor: null, aviso_previo_unidad: null,
      omitido_por: sesion.nombre,
      omitido_en: new Date().toISOString(),
      actualizado_por: sesion.nombre,
      actualizado_en: new Date().toISOString(),
    }
    const { error } = await supabase.from('lotes_vencimiento').update(payload).in('id', ids)
    if (!error) {
      const lotesPorId = new Map((lotes || []).map((l) => [l.id, l]))
      await supabase.from('lotes_vencimiento_log').insert(
        ids.map((id) => ({
          lote_id: id, codigo: lotesPorId.get(id)?.codigo, worker_id: sesion.id, worker_nombre: sesion.nombre,
          accion: 'omitido', detalle: payload,
        }))
      )
      setLotes((prev) => prev.map((l) => (seleccionados.has(l.id) ? { ...l, ...payload } : l)))
      setSeleccionados(new Set())
      setMensaje(`${ids.length} producto(s) omitido(s).`)
      setMensajeEsError(false)
    } else {
      setMensaje('No se pudo omitir la selección: ' + error.message)
      setMensajeEsError(true)
    }
    setOmitiendoVarios(false)
  }

  // Deshacer un "omitido" (2026-08-23, pedido explícito del usuario): antes
  // no había forma de verlos ni de corregir un click de más -- vuelve a
  // modo pendiente, como un lote recién detectado, para que se le pueda
  // asignar fecha de nuevo desde cero. Agrupado por producto (2026-09-05):
  // en la pestaña Omitidos todos los lotes del grupo comparten esa clase,
  // así que reactivar la tarjeta reactiva el grupo entero.
  async function reactivarGrupo(grupo) {
    const ids = grupo.lotes.map((l) => l.id)
    setOmitiendo((prev) => ({ ...prev, [grupo.codigo]: true }))
    const payload = { modo: null, omitido_por: null, omitido_en: null, actualizado_por: sesion.nombre, actualizado_en: new Date().toISOString() }
    const { error } = await supabase.from('lotes_vencimiento').update(payload).in('id', ids)
    if (!error) {
      await supabase.from('lotes_vencimiento_log').insert(
        ids.map((id) => ({ lote_id: id, codigo: grupo.codigo, worker_id: sesion.id, worker_nombre: sesion.nombre, accion: 'reactivado', detalle: {} }))
      )
      setLotes((prev) => prev.map((l) => (ids.includes(l.id) ? { ...l, ...payload } : l)))
    } else {
      setMensaje('No se pudo reactivar: ' + error.message)
      setMensajeEsError(true)
    }
    setOmitiendo((prev) => ({ ...prev, [grupo.codigo]: false }))
  }

  if (!sesionLista) return null
  if (!sesion) return <GateTrabajador onIngresar={() => { window.location.href = '/' }} />

  const hoy = new Date()
  const clasificados = (lotes || []).map((l) => ({ ...l, _clase: clasificarLote(l, hoy), _alerta: calcularAlerta(l, hoy) }))
  const porFiltro = filtro === 'todo' ? clasificados.filter((l) => l._clase !== 'omitido') : clasificados.filter((l) => l._clase === filtro)
  // El trim() de acá es SOLO para decidir si hay algo escrito -- el término
  // que de verdad se compara conserva los espacios tal cual se tipearon
  // (pedido explícito del usuario, 2026-08-23): "st" solo, sin espacio,
  // trae cualquier producto que tenga "st" en cualquier parte (COSTA,
  // ESTUFA, etc.); "st " CON el espacio final acota a que "st" termine ahí
  // -- por ejemplo el prefijo de marca "ST " de Stanley. Antes el .trim()
  // se comía ese espacio final y hacía imposible escribirlo.
  const hayBusqueda = busqueda.trim() !== ''
  const terminoBusqueda = busqueda.toLowerCase()
  const porBusqueda = hayBusqueda
    ? porFiltro.filter((l) => l.descripcion.toLowerCase().includes(terminoBusqueda) || l.codigo.toLowerCase().includes(terminoBusqueda))
    : porFiltro
  // Orden alfabético (2026-08-23, pedido explícito del usuario) -- antes
  // salían en el orden en que se cargaron de la base, sin ningún criterio
  // útil para revisar una lista larga. Agrupado por producto (2026-09-05,
  // pedido explícito del usuario): un mismo código con 2+ lotes en esta
  // pestaña aparecía como tarjetas sueltas -- ahora es una sola tarjeta,
  // que al tocarla lleva al detalle completo del producto (mismo criterio
  // que "Últimos agregados" en la pantalla principal).
  const grupos = agruparPorProducto(porBusqueda).sort((a, b) => a.descripcion.localeCompare(b.descripcion, 'es'))
  const conteos = FILTROS.reduce((acc, f) => {
    acc[f.clave] = f.clave === 'todo' ? clasificados.filter((l) => l._clase !== 'omitido').length : clasificados.filter((l) => l._clase === f.clave).length
    return acc
  }, {})
  const seleccionablesVisibles = grupos.flatMap((g) => g.seleccionables)

  return (
    <div className="page venc-page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Vencimientos — {sesion.nombre}</div>
          <h1>Lista completa</h1>
        </div>
        <div className="row-inline topbar-acciones" style={{ gap: 8 }}>
          <a className="btn btn-ghost" href="/vencimientos">Inicio</a>
          <a className="btn btn-ghost" href="/vencimientos/historial">Historial</a>
          <a className="btn btn-ghost" href="/">Salir</a>
        </div>
      </div>

      <p className="hint">Los pendientes son los que hay que revisar primero — usá "Omitir" para los que no importan (velas, envases, etc.) y avanzar rápido.</p>

      {mensaje && <div className="card"><p className={mensajeEsError ? 'error-text' : ''}>{mensaje}</p></div>}

      <div className="row-inline filtros-row" style={{ marginBottom: 12 }}>
        {FILTROS.map((f) => (
          <button
            key={f.clave} type="button" className={`btn ${filtro === f.clave ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setFiltro(f.clave); setSeleccionados(new Set()) }}
          >
            {f.label} ({conteos[f.clave] ?? 0})
          </button>
        ))}
      </div>

      <div className="field" style={{ marginBottom: 12, maxWidth: 360 }}>
        <input
          type="text" placeholder="Filtrar por nombre o código…" value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      {seleccionablesVisibles.length > 0 && (
        <div className="row-inline seleccion-row" style={{ marginBottom: 12, alignItems: 'center', gap: 12 }}>
          <label className="row-inline" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={seleccionablesVisibles.length > 0 && seleccionablesVisibles.every((l) => seleccionados.has(l.id))}
              onChange={(e) => {
                setSeleccionados((prev) => {
                  const copia = new Set(prev)
                  if (e.target.checked) seleccionablesVisibles.forEach((l) => copia.add(l.id))
                  else seleccionablesVisibles.forEach((l) => copia.delete(l.id))
                  return copia
                })
              }}
            />
            Seleccionar todos los visibles
          </label>
          {seleccionados.size > 0 && (
            <>
              <span className="hint" style={{ margin: 0 }}>{seleccionados.size} seleccionado(s)</span>
              <button className="btn btn-primary btn-sm" onClick={omitirSeleccionados} disabled={omitiendoVarios}>
                {omitiendoVarios ? 'Omitiendo…' : `Omitir seleccionados (${seleccionados.size})`}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSeleccionados(new Set())} disabled={omitiendoVarios}>
                Cancelar selección
              </button>
            </>
          )}
        </div>
      )}

      {lotes === null && <div className="card"><p>Cargando…</p></div>}

      {lotes !== null && grupos.length === 0 && (
        <div className="card empty-state"><p>No hay nada en esta lista por ahora.</p></div>
      )}

      {lotes !== null && grupos.length > 0 && (
        <div className="product-list">
          {grupos.map((grupo) => {
            const r = grupo.representante
            const seleccionable = grupo.seleccionables.length > 0
            const lotesPendientes = grupo.lotes.filter((l) => l._clase === 'pendiente')
            const diasSinFecha = r._clase === 'pendiente' && lotesPendientes.length
              ? Math.max(...lotesPendientes.map((l) => diasEntre(new Date(l.creado_en), hoy)))
              : null
            const esViejo = diasSinFecha != null && diasSinFecha >= DIAS_PENDIENTE_VIEJO
            const cantidadTotal = grupo.lotes.reduce((sum, l) => sum + Number(l.cantidad_restante), 0)
            const marcado = seleccionable && grupo.seleccionables.every((l) => seleccionados.has(l.id))
            const etiquetaAccion = grupo.lotes.length > 1 ? `Ver ${grupo.lotes.length} lotes` : (r._clase === 'pendiente' ? 'Poner fecha' : 'Revisar')
            return (
              <div
                className="product-card"
                key={grupo.codigo}
                onClick={seleccionable ? () => alternarSeleccionGrupo(grupo) : undefined}
                style={seleccionable ? { cursor: 'pointer' } : undefined}
              >
                <div className="desc">
                  {seleccionable && (
                    <input
                      type="checkbox" checked={marcado} onChange={() => alternarSeleccionGrupo(grupo)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginRight: 10 }}
                    />
                  )}
                  {grupo.descripcion}{grupo.lotes.some((l) => l.en_vivo) && <span className="hint" style={{ marginLeft: 6 }}>(hoy, sin confirmar)</span>}
                </div>
                <div className="sys">
                  Código: {grupo.codigo} · {grupo.lotes.length === 1 ? `Lote ${grupo.lotes[0].numero_lote}` : `${grupo.lotes.length} lotes`} · {cantidadTotal} unidad(es)
                  {r._alerta.diasRestantes != null && (r._clase === 'vencido' || r._clase === 'proximo') && (
                    <> · {r._clase === 'vencido' ? `venció hace ${Math.abs(r._alerta.diasRestantes)} día(s)` : `vence en ${r._alerta.diasRestantes} día(s)`}</>
                  )}
                  {esViejo && <> · <span style={{ color: 'var(--alert-warn)' }}>hace {diasSinFecha} día(s) sin fecha</span></>}
                </div>
                <div className="row-inline lote-footer" style={{ marginTop: 12, justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className={`status-pill ${r._clase === 'vencido' ? 'bad' : r._clase === 'proximo' || r._clase === 'pendiente' ? 'warn' : 'ok'}`} style={{ display: 'inline-flex' }}>
                    {r._clase === 'pendiente' ? 'Sin fecha' : r._clase === 'vencido' ? 'Vencido' : r._clase === 'proximo' ? 'Próximo a vencer' : r._clase === 'omitido' ? 'Omitido' : 'Con fecha'}
                  </span>
                  <div className="row-inline lote-acciones" style={{ gap: 8 }}>
                    {r._clase !== 'omitido' && (
                      <a className="btn btn-ghost btn-sm" href={`/vencimientos?buscar=${encodeURIComponent(grupo.codigo)}`} onClick={(e) => e.stopPropagation()}>
                        {etiquetaAccion}
                      </a>
                    )}
                    {seleccionable && (
                      <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); omitirGrupo(grupo) }} disabled={omitiendo[grupo.codigo]}>
                        {omitiendo[grupo.codigo] ? 'Omitiendo…' : grupo.seleccionables.length > 1 ? `Omitir (${grupo.seleccionables.length})` : 'Omitir'}
                      </button>
                    )}
                    {r._clase === 'omitido' && (
                      <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); reactivarGrupo(grupo) }} disabled={omitiendo[grupo.codigo]}>
                        {omitiendo[grupo.codigo] ? 'Quitando…' : grupo.lotes.length > 1 ? `Quitar ${grupo.lotes.length} de omitidos` : 'Quitar de omitidos'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default PantallaLista
