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

function PantallaLista() {
  const { sesion, sesionLista, salir } = useSesionTrabajador()
  const [lotes, setLotes] = useState(null) // null = cargando
  const [filtro, setFiltro] = useState('pendiente')
  const [busqueda, setBusqueda] = useState('')
  const [omitiendo, setOmitiendo] = useState({}) // id -> bool
  const [omitiendoVarios, setOmitiendoVarios] = useState(false)
  const [seleccionados, setSeleccionados] = useState(() => new Set())
  const [mensaje, setMensaje] = useState('')
  const [mensajeEsError, setMensajeEsError] = useState(false)
  const [actualizando, setActualizando] = useState(false)

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

  // "Actualizar" (2026-08-22) -- antes solo releía lotes_vencimiento tal
  // cual estaba guardado, sin pedirle nada nuevo al agente. Ahora inserta
  // una fila en vencimientos_solicitudes; el agente-servidor la escucha por
  // Realtime, dispara una lectura nueva de respaldo+log (mismo mecanismo
  // que "Sincronizar catálogo" de admin) y recién con eso fresco corre la
  // reconciliación (compara contra la suma de lotes -- crea lotes nuevos,
  // descuenta lo vendido) y recién ahí se vuelve a cargar la lista.
  // Timeout generoso (8 min) -- medido en producción el 2026-08-22 con
  // ~2900 productos: ~1 min largo la lectura de respaldo+log, ~4 min más la
  // reconciliación (recorre TODO el catálogo, no solo lo que cambió). Nada
  // instantáneo, a diferencia de la reconciliación sola de antes.
  async function actualizar() {
    setActualizando(true)
    setMensaje('')
    setMensajeEsError(false)
    const { data: solicitud, error } = await supabase
      .from('vencimientos_solicitudes')
      .insert({ status: 'pending', solicitado_por: sesion.nombre })
      .select()
      .single()
    if (error) {
      setMensaje('No se pudo pedir la actualización: ' + error.message)
      setMensajeEsError(true)
      setActualizando(false)
      return
    }

    let resuelto = false
    const terminar = async (row) => {
      if (resuelto) return
      resuelto = true
      supabase.removeChannel(canal)
      clearTimeout(timeoutId)
      setActualizando(false)
      if (row?.status === 'error') {
        setMensaje('La actualización falló: ' + (row.mensaje || 'error desconocido'))
        setMensajeEsError(true)
      } else {
        setMensaje(row?.mensaje ? `Actualizado: ${row.mensaje}` : 'Actualizado.')
        setMensajeEsError(false)
      }
      await cargar()
    }

    const canal = supabase
      .channel(`vencimientos-solicitud-${solicitud.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'vencimientos_solicitudes', filter: `id=eq.${solicitud.id}` },
        (payload) => {
          if (payload.new?.status === 'done' || payload.new?.status === 'error') terminar(payload.new)
        }
      )
      .subscribe()

    const timeoutId = setTimeout(() => {
      if (resuelto) return
      resuelto = true
      supabase.removeChannel(canal)
      setActualizando(false)
      setMensaje('La actualización está tardando más de lo normal -- probá de nuevo en un momento.')
      setMensajeEsError(true)
      cargar()
    }, 480000)
  }

  async function omitir(lote) {
    setOmitiendo((prev) => ({ ...prev, [lote.id]: true }))
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
    const { error } = await supabase.from('lotes_vencimiento').update(payload).eq('id', lote.id)
    if (!error) {
      await supabase.from('lotes_vencimiento_log').insert({
        lote_id: lote.id, codigo: lote.codigo, worker_id: sesion.id, worker_nombre: sesion.nombre,
        accion: 'omitido', detalle: payload,
      })
      setLotes((prev) => prev.map((l) => (l.id === lote.id ? { ...l, ...payload } : l)))
    } else {
      setMensaje('No se pudo omitir: ' + error.message)
      setMensajeEsError(true)
    }
    setOmitiendo((prev) => ({ ...prev, [lote.id]: false }))
  }

  function alternarSeleccion(id) {
    setSeleccionados((prev) => {
      const copia = new Set(prev)
      if (copia.has(id)) copia.delete(id)
      else copia.add(id)
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
  // asignar fecha de nuevo desde cero.
  async function reactivar(lote) {
    setOmitiendo((prev) => ({ ...prev, [lote.id]: true }))
    const payload = { modo: null, omitido_por: null, omitido_en: null, actualizado_por: sesion.nombre, actualizado_en: new Date().toISOString() }
    const { error } = await supabase.from('lotes_vencimiento').update(payload).eq('id', lote.id)
    if (!error) {
      await supabase.from('lotes_vencimiento_log').insert({
        lote_id: lote.id, codigo: lote.codigo, worker_id: sesion.id, worker_nombre: sesion.nombre,
        accion: 'reactivado', detalle: {},
      })
      setLotes((prev) => prev.map((l) => (l.id === lote.id ? { ...l, ...payload } : l)))
    } else {
      setMensaje('No se pudo reactivar: ' + error.message)
      setMensajeEsError(true)
    }
    setOmitiendo((prev) => ({ ...prev, [lote.id]: false }))
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
  // útil para revisar una lista larga.
  const visibles = [...porBusqueda].sort((a, b) => a.descripcion.localeCompare(b.descripcion, 'es'))
  const conteos = FILTROS.reduce((acc, f) => {
    acc[f.clave] = f.clave === 'todo' ? clasificados.filter((l) => l._clase !== 'omitido').length : clasificados.filter((l) => l._clase === f.clave).length
    return acc
  }, {})
  const seleccionablesVisibles = visibles.filter((l) => puedeOmitir(l._clase))

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Vencimientos — {sesion.nombre}</div>
          <h1>Lista completa</h1>
        </div>
        <div className="row-inline" style={{ gap: 8 }}>
          <a className="btn btn-ghost" href="/vencimientos">Cargar producto</a>
          <a className="btn btn-ghost" href="/vencimientos/historial">Historial</a>
          <button className="btn btn-ghost" onClick={actualizar} disabled={actualizando}>
            {actualizando ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button className="btn btn-ghost" onClick={salir}>Salir</button>
        </div>
      </div>

      <p className="hint">Los pendientes son los que hay que revisar primero — usá "Omitir" para los que no importan (velas, envases, etc.) y avanzar rápido.</p>

      {actualizando && <p className="hint">Actualizando inventario y lotes contra la tienda — puede tardar varios minutos, podés esperar acá.</p>}

      {mensaje && <div className="card"><p className={mensajeEsError ? 'error-text' : ''}>{mensaje}</p></div>}

      <div className="row-inline" style={{ marginBottom: 12 }}>
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
        <div className="row-inline" style={{ marginBottom: 12, alignItems: 'center', gap: 12 }}>
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

      {lotes !== null && visibles.length === 0 && (
        <div className="card empty-state"><p>No hay nada en esta lista por ahora.</p></div>
      )}

      {lotes !== null && visibles.length > 0 && (
        <div className="product-list">
          {visibles.map((l) => {
            const seleccionable = puedeOmitir(l._clase)
            const diasSinFecha = l._clase === 'pendiente' ? diasEntre(new Date(l.creado_en), hoy) : null
            const esViejo = diasSinFecha != null && diasSinFecha >= DIAS_PENDIENTE_VIEJO
            return (
              <div
                className="product-card"
                key={l.id}
                onClick={seleccionable ? () => alternarSeleccion(l.id) : undefined}
                style={seleccionable ? { cursor: 'pointer' } : undefined}
              >
                <div className="desc">
                  {seleccionable && (
                    <input
                      type="checkbox" checked={seleccionados.has(l.id)} onChange={() => alternarSeleccion(l.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginRight: 10 }}
                    />
                  )}
                  {l.descripcion}{l.en_vivo && <span className="hint" style={{ marginLeft: 6 }}>(hoy, sin confirmar)</span>}
                </div>
                <div className="sys">
                  Código: {l.codigo} · Lote {l.numero_lote} · {l.cantidad_restante} unidad(es)
                  {l._alerta.diasRestantes != null && (l._clase === 'vencido' || l._clase === 'proximo') && (
                    <> · {l._clase === 'vencido' ? `venció hace ${Math.abs(l._alerta.diasRestantes)} día(s)` : `vence en ${l._alerta.diasRestantes} día(s)`}</>
                  )}
                  {esViejo && <> · <span style={{ color: 'var(--alert-warn)' }}>hace {diasSinFecha} día(s) sin fecha</span></>}
                </div>
                <div className="row-inline" style={{ marginTop: 12, justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className={`status-pill ${l._clase === 'vencido' ? 'bad' : l._clase === 'proximo' || l._clase === 'pendiente' ? 'warn' : 'ok'}`} style={{ display: 'inline-flex' }}>
                    {l._clase === 'pendiente' ? 'Sin fecha' : l._clase === 'vencido' ? 'Vencido' : l._clase === 'proximo' ? 'Próximo a vencer' : l._clase === 'omitido' ? 'Omitido' : 'Con fecha'}
                  </span>
                  <div className="row-inline" style={{ gap: 8 }}>
                    {l._clase !== 'omitido' && (
                      <a className="btn btn-ghost btn-sm" href={`/vencimientos?buscar=${encodeURIComponent(l.codigo)}`} onClick={(e) => e.stopPropagation()}>
                        {l._clase === 'pendiente' ? 'Poner fecha' : 'Revisar'}
                      </a>
                    )}
                    {seleccionable && (
                      <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); omitir(l) }} disabled={omitiendo[l.id]}>
                        {omitiendo[l.id] ? 'Omitiendo…' : 'Omitir'}
                      </button>
                    )}
                    {l._clase === 'omitido' && (
                      <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); reactivar(l) }} disabled={omitiendo[l.id]}>
                        {omitiendo[l.id] ? 'Quitando…' : 'Quitar de omitidos'}
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
