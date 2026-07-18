import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient.js'

const POLL_MS = 20000
const SAVE_DEBOUNCE_MS = 600

function calcularFaltante(row) {
  const usado = (Number(row.en_tienda) || 0) + (Number(row.en_vitrina) || 0) + (Number(row.en_cajas) || 0)
  return (Number(row.inventario_sistema) || 0) - usado
}

export default function WorkerPage() {
  const [rows, setRows] = useState(null) // null = cargando
  const [filtro, setFiltro] = useState('')
  const [ronda, setRonda] = useState('')
  const [cargando, setCargando] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const timers = useRef({})
  const savedFlags = useRef({})
  const pendientes = useRef({}) // ids con ediciones locales aún no confirmadas guardadas
  const [, forceTick] = useState(0)

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
        descripcion: p.descripcion,
        inventario_sistema: p.inventario_sistema,
        en_tienda: c?.en_tienda ?? '',
        en_vitrina: c?.en_vitrina ?? '',
        en_cajas: c?.en_cajas ?? '',
      }
    })

    setRows(nuevasRows)
    setCargando(false)
  }, [])

  useEffect(() => {
    cargarDatos()
    const interval = setInterval(cargarDatos, POLL_MS)
    return () => clearInterval(interval)
  }, [cargarDatos])

  function actualizarCampo(id, campo, valor) {
    const v = String(valor).replace('-', '') // no permitir cantidades negativas
    pendientes.current[id] = true
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [campo]: v } : r)))
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
    const { error } = await supabase.from('conteos').upsert(
      {
        product_id: id,
        en_tienda: Number(fila.en_tienda) || 0,
        en_vitrina: Number(fila.en_vitrina) || 0,
        en_cajas: Number(fila.en_cajas) || 0,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: 'product_id' }
    )
    if (error) {
      setErrorMsg('No se pudo guardar un conteo: ' + error.message)
      return
    }
    pendientes.current[id] = false
    savedFlags.current[id] = true
    forceTick((n) => n + 1)
    setTimeout(() => {
      savedFlags.current[id] = false
      forceTick((n) => n + 1)
    }, 1500)
  }

  // keep a ref in sync with rows for use inside debounced saves
  const rowsRef = useRef([])
  useEffect(() => { rowsRef.current = rows || [] }, [rows])

  const resumen = (rows || []).reduce(
    (acc, r) => {
      const f = calcularFaltante(r)
      if (f === 0) acc.ok += 1
      else if (f > 0) acc.faltan += 1
      else acc.sobran += 1
      return acc
    },
    { ok: 0, faltan: 0, sobran: 0 }
  )

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Trabajador</div>
          <h1>Conteo de inventario</h1>
        </div>
        <button className="btn btn-ghost" onClick={cargarDatos}>Actualizar</button>
      </div>

      {ronda && <p className="hint">Ronda: <strong>{ronda}</strong></p>}
      {filtro && <p className="hint">Mostrando productos que comienzan con "{filtro}"</p>}

      {errorMsg && <div className="card"><p className="error-text">{errorMsg}</p></div>}

      {!cargando && rows && rows.length > 0 && (
        <div className="summary-row">
          <div className="chip ok"><div className="num">{resumen.ok}</div><div className="lbl">Cuadrados</div></div>
          <div className="chip bad"><div className="num">{resumen.faltan}</div><div className="lbl">Con faltantes</div></div>
          <div className="chip warn"><div className="num">{resumen.sobran}</div><div className="lbl">Con sobrantes</div></div>
        </div>
      )}

      {cargando && <div className="card"><p>Cargando productos…</p></div>}

      {!cargando && rows && rows.length === 0 && (
        <div className="card empty-state">
          <p>No hay productos para mostrar todavía. Pídele al administrador que suba el Excel y publique el filtro.</p>
        </div>
      )}

      {!cargando && rows && rows.length > 0 && (
        <div className="product-list">
          {rows.map((r) => {
            const faltante = calcularFaltante(r)
            let claseEstado = 'ok'
            let texto = 'Cuadrado'
            if (faltante > 0) { claseEstado = 'bad'; texto = `Faltan ${faltante} productos` }
            else if (faltante < 0) { claseEstado = 'warn'; texto = `Sobran ${Math.abs(faltante)} productos` }

            return (
              <div className="product-card" key={r.id}>
                <div className="desc">{r.descripcion}</div>
                <div className="sys">Inventario sistema: {r.inventario_sistema}</div>
                <div className="inputs-grid">
                  <div className="mini-field">
                    <label>En tienda</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={r.en_tienda}
                      onChange={(e) => actualizarCampo(r.id, 'en_tienda', e.target.value)}
                      onBlur={() => guardarFila(r.id)}
                    />
                  </div>
                  <div className="mini-field">
                    <label>En vitrina</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={r.en_vitrina}
                      onChange={(e) => actualizarCampo(r.id, 'en_vitrina', e.target.value)}
                      onBlur={() => guardarFila(r.id)}
                    />
                  </div>
                  <div className="mini-field">
                    <label>En cajas</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={r.en_cajas}
                      onChange={(e) => actualizarCampo(r.id, 'en_cajas', e.target.value)}
                      onBlur={() => guardarFila(r.id)}
                    />
                  </div>
                </div>
                <div className={`status-pill ${claseEstado}`}>
                  <span>{texto}</span>
                  <span className={`saved-tick ${savedFlags.current[r.id] ? 'show' : ''}`}>Guardado ✓</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
