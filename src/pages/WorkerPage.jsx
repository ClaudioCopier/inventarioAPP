import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import GateTrabajador from '../components/GateTrabajador.jsx'
import { useSesionTrabajador } from '../lib/useSesionTrabajador.js'
import { traerTodasLasFilas } from '../lib/traerTodasLasFilas.js'
import { clasificarLote } from '../lib/vencimientosReglas.js'

const POLL_MS = 20000
const SAVE_DEBOUNCE_MS = 600

function sumaCajasExtra(cajasExtra) {
  return (cajasExtra || []).reduce((acc, v) => acc + (Number(v) || 0), 0)
}

function calcularFaltante(row) {
  const usado = (Number(row.en_tienda) || 0) + (Number(row.en_vitrina) || 0) + (Number(row.en_cajas) || 0) + sumaCajasExtra(row.cajas_extra)
  return (Number(row.inventario_sistema) || 0) - usado
}

export default function WorkerPage() {
  const { sesion, sesionLista, salir } = useSesionTrabajador()
  const [rows, setRows] = useState(null) // null = cargando
  const [filtro, setFiltro] = useState('')
  const [ronda, setRonda] = useState('')
  const [cargando, setCargando] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [finalizando, setFinalizando] = useState(false)
  const [inventarioCerrado, setInventarioCerrado] = useState(false)
  const [filtrosActivos, setFiltrosActivos] = useState({ ok: true, bad: true, warn: true })
  const [busqueda, setBusqueda] = useState('')
  const [observacionesAbiertas, setObservacionesAbiertas] = useState({})
  const [alertasVencimiento, setAlertasVencimiento] = useState(new Map())
  const timers = useRef({})
  const savedFlags = useRef({})
  const pendientes = useRef({}) // ids con ediciones locales aún no confirmadas guardadas
  const [, forceTick] = useState(0)

  function ingresar() {
    // Bug real encontrado en producción (2026-08-16): sin esto, entrar por
    // /trabajador te dejaba directo en el conteo -- nunca pasabas por el
    // portal para elegir entre Conteo, Vencimientos o Reporte de ventas.
    window.location.href = '/'
  }

  const cargarDatos = useCallback(async () => {
    setErrorMsg('')
    const { data: configData, error: configError } = await supabase
      .from('config')
      .select('*')
      .eq('id', 1)
      .single()

    if (configError) {
      setErrorMsg('No se pudo conectar. Revisa tu conexión a internet.')
      setCargando(false)
      return
    }

    // Bug real encontrado en producción (2026-08-16): sin esta comprobación,
    // un trabajador que entra mientras no hay ninguna ronda activa
    // (config.activo=false, filtro_prefijo vacío) veía el catálogo COMPLETO
    // sin filtrar -- el filtro solo se aplicaba "si prefijo", y con el string
    // vacío la consulta a products no filtraba nada. El gate de "Inventario
    // cerrado" antes solo se disparaba de forma reactiva (evento en vivo de
    // reportes_inventario cuando OTRO trabajador finaliza), nunca se chequeó
    // al entrar de cero.
    if (configData?.activo === false) {
      setInventarioCerrado(true)
      setCargando(false)
      return
    }

    const prefijo = configData?.filtro_prefijo || ''
    setFiltro(prefijo)
    setRonda(configData?.ronda || '')

    let query = supabase.from('products').select('*').order('descripcion', { ascending: true })
    if (prefijo) query = query.ilike('descripcion', `${prefijo}%`)
    const { data: productos, error: prodError } = await query

    if (prodError) {
      setErrorMsg('Error al cargar productos: ' + prodError.message)
      setCargando(false)
      return
    }

    const ids = (productos || []).map((p) => p.id)
    let conteosPorId = {}
    if (ids.length > 0) {
      const { data: conteos } = await supabase.from('conteos').select('*').in('product_id', ids)
      for (const c of conteos || []) conteosPorId[c.product_id] = c
    }

    const nuevasRows = (productos || []).map((p) => {
      // Si el trabajador está editando esta fila ahora mismo (aún no se guardó),
      // no la pisamos con lo que venga del servidor: se perdería lo que escribió.
      if (pendientes.current[p.id]) {
        const filaLocal = rowsRef.current.find((r) => r.id === p.id)
        if (filaLocal) return filaLocal
      }
      const c = conteosPorId[p.id]
      return {
        id: p.id,
        codigo: p.codigo,
        descripcion: p.descripcion,
        inventario_sistema: p.inventario_sistema,
        en_tienda: c?.en_tienda ?? '',
        en_vitrina: c?.en_vitrina ?? '',
        en_cajas: c?.en_cajas ?? '',
        cajas_extra: (c?.cajas_extra ?? []).map(String),
        observacion: c?.observacion ?? '',
      }
    })

    setRows(nuevasRows)
    setCargando(false)
  }, [])

  useEffect(() => {
    if (!sesion) return
    cargarDatos()
    const interval = setInterval(cargarDatos, POLL_MS)
    return () => clearInterval(interval)
  }, [cargarDatos, sesion])

  // Etiqueta "próximo a vencer" (2026-08-16) -- deliberadamente aislada: un
  // fallo acá (sin internet, lo que sea) nunca debe frenar el conteo, que es
  // lo importante de esta pantalla. Se carga una vez al entrar, no en el
  // poll de cada 20s -- el vencimiento no cambia tan seguido como para
  // justificar reconsultar la tabla completa todo el rato.
  useEffect(() => {
    if (!sesion) return
    let activo = true
    traerTodasLasFilas('lotes_vencimiento', 'codigo, modo, estado, fecha_elaboracion, fecha_vencimiento, aviso_previo_valor, aviso_previo_unidad', (q) => q.eq('estado', 'activo'))
      .then((lotes) => {
        if (!activo) return
        const hoy = new Date()
        const porCodigo = new Map()
        for (const l of lotes) {
          const clase = clasificarLote(l, hoy)
          if (clase === 'vencido' || clase === 'proximo') {
            const actual = porCodigo.get(l.codigo)
            if (!actual || (clase === 'vencido' && actual !== 'vencido')) porCodigo.set(l.codigo, clase)
          }
        }
        setAlertasVencimiento(porCodigo)
      })
      .catch((e) => console.error('No se pudo cargar el estado de vencimientos (no afecta el conteo):', e.message))
    return () => { activo = false }
  }, [sesion])

  // Sincroniza en vivo: si otro trabajador guarda un conteo, se refleja al
  // instante en esta pantalla (sin esperar el poll de 20s). Si esta misma
  // fila se está editando localmente ahora mismo, no la pisamos.
  useEffect(() => {
    if (!sesion) return
    const canal = supabase
      .channel('conteos-en-vivo')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conteos' },
        (payload) => {
          const productId = payload.new?.product_id ?? payload.old?.product_id
          if (productId == null || pendientes.current[productId]) return
          if (payload.eventType === 'DELETE') {
            setRows((prev) =>
              prev.map((r) => (r.id === productId ? { ...r, en_tienda: '', en_vitrina: '', en_cajas: '', cajas_extra: [], observacion: '' } : r))
            )
            return
          }
          const c = payload.new
          setRows((prev) =>
            prev.map((r) =>
              r.id === productId
                ? {
                    ...r,
                    en_tienda: c.en_tienda ?? '',
                    en_vitrina: c.en_vitrina ?? '',
                    en_cajas: c.en_cajas ?? '',
                    cajas_extra: (c.cajas_extra ?? []).map(String),
                    observacion: c.observacion ?? '',
                  }
                : r
            )
          )
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [sesion])

  // Existencia del sistema en vivo (2026-08-01): mientras hay una ronda
  // activa, agente-servidor sube a `products.inventario_sistema` lo que
  // cambia cada ~30s (ver SERVIDOR.md, "inventario en vivo" -- lee
  // debug.nfo, nunca toca el POS en vivo). Esto lo refleja al instante en
  // pantalla en vez de esperar el poll de POLL_MS, así "Faltan/Sobran" se
  // recalcula solo apenas se vende algo mientras están contando.
  useEffect(() => {
    if (!sesion) return
    const canal = supabase
      .channel('products-en-vivo')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'products' },
        (payload) => {
          const productId = payload.new?.id
          if (productId == null) return
          setRows((prev) =>
            prev.map((r) => (r.id === productId ? { ...r, inventario_sistema: payload.new.inventario_sistema } : r))
          )
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [sesion])

  // Si cualquier trabajador presiona "Finalizar inventario", todos los que
  // estén conectados se enteran al instante y su sesión se cierra sola.
  useEffect(() => {
    if (!sesion) return
    const canal = supabase
      .channel('cierre-inventario')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'reportes_inventario' },
        () => {
          salir()
          setInventarioCerrado(true)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [sesion])

  function actualizarCampo(id, campo, valor) {
    const v = String(valor).replace(/[^0-9]/g, '') // solo dígitos, nada de letras/signos
    pendientes.current[id] = true
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [campo]: v } : r)))
    if (timers.current[id]) clearTimeout(timers.current[id])
    timers.current[id] = setTimeout(() => guardarFila(id), SAVE_DEBOUNCE_MS)
  }

  // Casillas extra "en cajas" (2026-08-10) -- pedido explícito del usuario:
  // algunos productos están guardados en más de 1 caja, y esto tiene que
  // poder decidirse producto por producto (no todos están separados así).
  // Cada fila guarda su propio arreglo cajas_extra, independiente del resto.
  function agregarCajaExtra(id) {
    pendientes.current[id] = true
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, cajas_extra: [...r.cajas_extra, ''] } : r)))
  }

  function quitarCajaExtra(id, indice) {
    pendientes.current[id] = true
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, cajas_extra: r.cajas_extra.filter((_, i) => i !== indice) } : r))
    )
    if (timers.current[id]) clearTimeout(timers.current[id])
    timers.current[id] = setTimeout(() => guardarFila(id), SAVE_DEBOUNCE_MS)
  }

  function actualizarCajaExtra(id, indice, valor) {
    const v = String(valor).replace(/[^0-9]/g, '')
    pendientes.current[id] = true
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, cajas_extra: r.cajas_extra.map((c, i) => (i === indice ? v : c)) } : r
      )
    )
    if (timers.current[id]) clearTimeout(timers.current[id])
    timers.current[id] = setTimeout(() => guardarFila(id), SAVE_DEBOUNCE_MS)
  }

  // Observaciones por producto (2026-08-10) -- para dejar registrado el
  // motivo de un descuadre, visible después en el reporte final.
  function actualizarObservacion(id, valor) {
    pendientes.current[id] = true
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, observacion: valor } : r)))
    if (timers.current[id]) clearTimeout(timers.current[id])
    timers.current[id] = setTimeout(() => guardarFila(id), SAVE_DEBOUNCE_MS)
  }

  async function guardarFila(id) {
    if (timers.current[id]) {
      clearTimeout(timers.current[id])
      delete timers.current[id]
    }
    const fila = rowsRef.current.find((r) => r.id === id)
    if (!fila) return
    const valores = {
      en_tienda: Number(fila.en_tienda) || 0,
      en_vitrina: Number(fila.en_vitrina) || 0,
      en_cajas: Number(fila.en_cajas) || 0,
      cajas_extra: (fila.cajas_extra || []).map((v) => Number(v) || 0),
      observacion: fila.observacion || '',
    }
    const { error } = await supabase.from('conteos').upsert(
      { product_id: id, ...valores, actualizado_en: new Date().toISOString() },
      { onConflict: 'product_id' }
    )
    if (error) {
      setErrorMsg('No se pudo guardar un conteo: ' + error.message)
      return
    }
    // Registro de quién tocó este producto, para el reporte final.
    await supabase.from('conteo_log').insert({ product_id: id, trabajador_nombre: sesion.nombre, ...valores })

    pendientes.current[id] = false
    savedFlags.current[id] = true
    forceTick((n) => n + 1)
    setTimeout(() => {
      savedFlags.current[id] = false
      forceTick((n) => n + 1)
    }, 1500)
  }

  async function finalizarInventario() {
    if (!confirm('¿Finalizar este inventario? Se genera el reporte final y se cierra la sesión de todos los trabajadores conectados.')) return
    setFinalizando(true)
    setErrorMsg('')
    try {
      const idsVisibles = rowsRef.current.map((r) => r.id)
      const { data: logs, error: logsError } = await supabase
        .from('conteo_log')
        .select('product_id, trabajador_nombre')
        .in('product_id', idsVisibles.length > 0 ? idsVisibles : [-1])
      if (logsError) throw logsError

      const trabajadoresPorProducto = {}
      const participantesSet = new Set()
      for (const l of logs || []) {
        participantesSet.add(l.trabajador_nombre)
        if (!trabajadoresPorProducto[l.product_id]) trabajadoresPorProducto[l.product_id] = new Set()
        trabajadoresPorProducto[l.product_id].add(l.trabajador_nombre)
      }

      const resumen = rowsRef.current.map((r) => {
        const faltante = calcularFaltante(r)
        const estado = faltante === 0 ? 'Cuadrado' : faltante > 0 ? `Faltan ${faltante}` : `Sobran ${Math.abs(faltante)}`
        return {
          descripcion: r.descripcion,
          inventario_sistema: r.inventario_sistema,
          en_tienda: Number(r.en_tienda) || 0,
          en_cajas: Number(r.en_cajas) || 0,
          cajas_extra: (r.cajas_extra || []).map((v) => Number(v) || 0),
          en_vitrina: Number(r.en_vitrina) || 0,
          observacion: r.observacion || '',
          estado,
          trabajadores: [...(trabajadoresPorProducto[r.id] || [])],
        }
      })

      const { error: reporteError } = await supabase.from('reportes_inventario').insert({
        ronda,
        cerrado_por: sesion.nombre,
        participantes: [...participantesSet],
        resumen,
      })
      if (reporteError) throw reporteError

      // activo:false + ronda/filtro_prefijo vacíos (2026-08-01 / 09-08) --
      // le avisa a agente-servidor que la ronda terminó (deja de
      // sincronizar existencia en vivo) y limpia el nombre para que la
      // próxima ronda no arranque con el rótulo de la anterior (ver
      // AdminPage.jsx::publicarFiltro, que lo prende/nombra al arrancar).
      //
      // Bug real encontrado el 2026-08-09: un UPDATE directo acá quedaba
      // bloqueado en SILENCIO por la policy "config: solo admin actualiza"
      // cada vez que finalizaba un trabajador normal (el caso de uso
      // principal de este botón) -- RLS no tira error al bloquear filas,
      // simplemente no las toca, así que el reporte se guardaba bien pero
      // config nunca se actualizaba. Arreglado con una función
      // SECURITY DEFINER (finalizar_ronda(), ver
      // supabase_migration_finalizar_ronda.sql) que cualquier usuario
      // logueado puede llamar, pero que SOLO puede apagar la ronda actual
      // y limpiar su nombre -- no da permiso general para editar config.
      const { error: configError } = await supabase.rpc('finalizar_ronda')
      if (configError) throw configError

      // Limpiar para la siguiente ronda.
      await supabase.from('conteos').delete().neq('id', 0)
      if (idsVisibles.length > 0) {
        await supabase.from('conteo_log').delete().in('product_id', idsVisibles)
      }

      salir()
      setInventarioCerrado(true)
    } catch (err) {
      setErrorMsg('No se pudo finalizar el inventario: ' + err.message)
    } finally {
      setFinalizando(false)
    }
  }

  // keep a ref in sync with rows for use inside debounced saves
  const rowsRef = useRef([])
  useEffect(() => { rowsRef.current = rows || [] }, [rows])

  function categoria(row) {
    const f = calcularFaltante(row)
    if (f === 0) return 'ok'
    if (f > 0) return 'bad'
    return 'warn'
  }

  const resumenChips = (rows || []).reduce(
    (acc, r) => {
      acc[categoria(r)] += 1
      return acc
    },
    { ok: 0, bad: 0, warn: 0 }
  )

  function alternarFiltro(cat) {
    setFiltrosActivos((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  const busquedaNormalizada = busqueda.trim().toLowerCase()
  const rowsVisibles = (rows || []).filter((r) => {
    if (!filtrosActivos[categoria(r)]) return false
    if (busquedaNormalizada && !r.descripcion.toLowerCase().includes(busquedaNormalizada)) return false
    return true
  })

  if (!sesionLista) {
    return null
  }

  if (inventarioCerrado) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h2>Inventario cerrado</h2>
          <p>Esperando nuevo inventario. El administrador avisará cuando haya una nueva ronda para contar.</p>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setInventarioCerrado(false)}>
            Iniciar sesión
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: '100%', marginTop: 8 }}
            onClick={() => window.open('/trabajador/historial', '_blank')}
          >
            Ver inventarios anteriores
          </button>
        </div>
      </div>
    )
  }

  if (!sesion) {
    return <GateTrabajador onIngresar={ingresar} />
  }

  return (
    <div className="page page-trabajador">
      <div className="topbar">
        <div>
          <div className="eyebrow">Trabajador — {sesion.nombre}</div>
          <h1>Conteo de inventario</h1>
        </div>
        <div className="row-inline" style={{ gap: 8 }}>
          <a className="btn btn-ghost" href="/">Inicio</a>
          <button className="btn btn-ghost" onClick={cargarDatos}>Actualizar</button>
          <button className="btn btn-ghost" onClick={() => window.open('/trabajador/historial', '_blank')}>
            Inventarios anteriores
          </button>
          <button className="btn btn-ghost" onClick={salir}>Salir</button>
        </div>
      </div>

      {ronda && <p className="hint">Ronda: <strong>{ronda}</strong></p>}
      {filtro && <p className="hint">Mostrando productos que comienzan con "{filtro}"</p>}

      {errorMsg && <div className="card"><p className="error-text">{errorMsg}</p></div>}

      {!cargando && rows && rows.length > 0 && (
        <div className="summary-row">
          <button className={`chip ok chip-filtro ${filtrosActivos.ok ? '' : 'apagado'}`} onClick={() => alternarFiltro('ok')}>
            <div className="num">{resumenChips.ok}</div><div className="lbl">Cuadrados</div>
          </button>
          <button className={`chip bad chip-filtro ${filtrosActivos.bad ? '' : 'apagado'}`} onClick={() => alternarFiltro('bad')}>
            <div className="num">{resumenChips.bad}</div><div className="lbl">Con faltantes</div>
          </button>
          <button className={`chip warn chip-filtro ${filtrosActivos.warn ? '' : 'apagado'}`} onClick={() => alternarFiltro('warn')}>
            <div className="num">{resumenChips.warn}</div><div className="lbl">Con sobrantes</div>
          </button>
        </div>
      )}
      {!cargando && rows && rows.length > 0 && (
        <p className="hint" style={{ marginTop: -8 }}>Toca un bloque para ocultar/mostrar esa categoría.</p>
      )}

      {cargando && <div className="card"><p>Cargando productos…</p></div>}

      {!cargando && rows && rows.length === 0 && (
        <div className="card empty-state">
          <p>No hay productos para mostrar todavía. Pídele al administrador que suba el Excel y publique el filtro.</p>
        </div>
      )}

      {!cargando && rows && rows.length > 0 && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <button className="btn btn-danger" onClick={finalizarInventario} disabled={finalizando} style={{ width: '100%' }}>
              {finalizando ? 'Finalizando…' : 'Finalizar inventario'}
            </button>
            <p className="hint" style={{ marginTop: 8 }}>
              Cierra esta ronda para todos, genera el reporte final y limpia los conteos para la siguiente.
            </p>
          </div>

          {rowsVisibles.length === 0 && (
            <div className="card empty-state">
              <p>No hay productos que coincidan con el filtro o la búsqueda actual.</p>
            </div>
          )}

          <div className="product-list product-list-con-buscador">
            {rowsVisibles.map((r) => {
              const faltante = calcularFaltante(r)
              let claseEstado = 'ok'
              let texto = 'Cuadrado'
              if (faltante > 0) { claseEstado = 'bad'; texto = `Faltan ${faltante} productos` }
              else if (faltante < 0) { claseEstado = 'warn'; texto = `Sobran ${Math.abs(faltante)} productos` }

              const claseVencimiento = alertasVencimiento.get(r.codigo)

              return (
                <div className="product-card" key={r.id}>
                  <div className="desc">
                    {r.descripcion}
                    {claseVencimiento && (
                      <span className={`badge-vencimiento ${claseVencimiento}`}>
                        {claseVencimiento === 'vencido' ? '⚠ Vencido' : '⚠ Próximo a vencer'}
                      </span>
                    )}
                  </div>
                  <div className="sys">Inventario sistema: {r.inventario_sistema}</div>
                  <div className="inputs-grid">
                    <div className="mini-field">
                      <label>En tienda</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={r.en_tienda}
                        onChange={(e) => actualizarCampo(r.id, 'en_tienda', e.target.value)}
                        onBlur={() => guardarFila(r.id)}
                      />
                    </div>
                    <div className="mini-field">
                      <label>En vitrina</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={r.en_vitrina}
                        onChange={(e) => actualizarCampo(r.id, 'en_vitrina', e.target.value)}
                        onBlur={() => guardarFila(r.id)}
                      />
                    </div>
                    <div className="mini-field">
                      <label>En cajas</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={r.en_cajas}
                        onChange={(e) => actualizarCampo(r.id, 'en_cajas', e.target.value)}
                        onBlur={() => guardarFila(r.id)}
                      />
                    </div>
                    {r.cajas_extra.map((valor, indice) => (
                      <div className="mini-field mini-field-extra" key={indice}>
                        <label>Caja {indice + 2}</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={valor}
                          onChange={(e) => actualizarCajaExtra(r.id, indice, e.target.value)}
                          onBlur={() => guardarFila(r.id)}
                        />
                        <button
                          type="button"
                          className="btn-quitar-caja"
                          aria-label="Quitar esta caja"
                          onClick={() => quitarCajaExtra(r.id, indice)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  <button type="button" className="btn btn-ghost btn-sm btn-agregar-caja" onClick={() => agregarCajaExtra(r.id)}>
                    + Producto guardado en otra caja
                  </button>

                  <button
                    type="button"
                    className={`btn btn-ghost btn-sm btn-observacion ${r.observacion ? 'tiene-observacion' : ''}`}
                    onClick={() => setObservacionesAbiertas((prev) => ({ ...prev, [r.id]: !prev[r.id] }))}
                  >
                    📝 Observaciones{r.observacion ? ' ✓' : ''}
                  </button>
                  {observacionesAbiertas[r.id] && (
                    <textarea
                      className="textarea-observacion"
                      placeholder="Ej: faltan 2 porque se encontraron rotos, o sobran porque había una caja sin contar antes…"
                      value={r.observacion}
                      onChange={(e) => actualizarObservacion(r.id, e.target.value)}
                      onBlur={() => guardarFila(r.id)}
                    />
                  )}

                  <div className={`status-pill ${claseEstado}`}>
                    <span>{texto}</span>
                    <span className={`saved-tick ${savedFlags.current[r.id] ? 'show' : ''}`}>Guardado ✓</span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="buscador-fijo">
            <input
              type="text"
              placeholder="Buscar producto por nombre…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        </>
      )}
    </div>
  )
}
