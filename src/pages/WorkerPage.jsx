import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient.js'

const POLL_MS = 20000
const SAVE_DEBOUNCE_MS = 600
const SESION_KEY = 'trabajador_sesion'

function calcularFaltante(row) {
  const usado = (Number(row.en_tienda) || 0) + (Number(row.en_vitrina) || 0) + (Number(row.en_cajas) || 0)
  return (Number(row.inventario_sistema) || 0) - usado
}

function leerSesion() {
  try {
    const raw = localStorage.getItem(SESION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function GateTrabajador({ onIngresar }) {
  const [modo, setModo] = useState('entrar') // 'entrar' | 'crear'
  const [nombre, setNombre] = useState('')
  const [clave, setClave] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  async function entrar(e) {
    e.preventDefault()
    setError('')
    const nombreLimpio = nombre.trim()
    if (!nombreLimpio || !clave) {
      setError('Completa tu nombre y clave.')
      return
    }
    setCargando(true)
    try {
      const bcrypt = (await import('bcryptjs')).default
      const { data, error: dbError } = await supabase
        .from('trabajadores')
        .select('*')
        .ilike('nombre', nombreLimpio)
        .maybeSingle()
      if (dbError) throw dbError

      if (modo === 'crear') {
        if (data) {
          setError('Ya existe una cuenta con ese nombre. Usa "Iniciar sesión".')
          setCargando(false)
          return
        }
        const claveHash = await bcrypt.hash(clave, 8)
        const { data: nuevo, error: insertError } = await supabase
          .from('trabajadores')
          .insert({ nombre: nombreLimpio, clave_hash: claveHash })
          .select()
          .single()
        if (insertError) throw insertError
        onIngresar({ id: nuevo.id, nombre: nuevo.nombre })
      } else {
        if (!data) {
          setError('No existe una cuenta con ese nombre. Usa "Crear cuenta".')
          setCargando(false)
          return
        }
        const coincide = await bcrypt.compare(clave, data.clave_hash)
        if (!coincide) {
          setError('Clave incorrecta.')
          setCargando(false)
          return
        }
        onIngresar({ id: data.id, nombre: data.nombre })
      }
    } catch (err) {
      setError('Error: ' + err.message)
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={entrar}>
        <h2>{modo === 'entrar' ? 'Iniciar sesión' : 'Crear cuenta'}</h2>
        <p>{modo === 'entrar' ? 'Ingresa tu nombre y clave para contar.' : 'Elige un nombre y una clave para empezar a contar.'}</p>
        <div className="field">
          <label htmlFor="nombre">Nombre</label>
          <input id="nombre" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="clave-trabajador">Clave</label>
          <input id="clave-trabajador" type="password" value={clave} onChange={(e) => setClave(e.target.value)} />
        </div>
        {error && <div className="error-text">{error}</div>}
        <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={cargando}>
          {cargando ? 'Un momento…' : modo === 'entrar' ? 'Entrar' : 'Crear cuenta'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ width: '100%', marginTop: 8 }}
          onClick={() => { setModo(modo === 'entrar' ? 'crear' : 'entrar'); setError('') }}
        >
          {modo === 'entrar' ? 'No tengo cuenta' : 'Ya tengo cuenta'}
        </button>
      </form>
    </div>
  )
}

export default function WorkerPage() {
  const [sesion, setSesion] = useState(leerSesion)
  const [rows, setRows] = useState(null) // null = cargando
  const [filtro, setFiltro] = useState('')
  const [ronda, setRonda] = useState('')
  const [cargando, setCargando] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [finalizando, setFinalizando] = useState(false)
  const [inventarioCerrado, setInventarioCerrado] = useState(false)
  const timers = useRef({})
  const savedFlags = useRef({})
  const pendientes = useRef({}) // ids con ediciones locales aún no confirmadas guardadas
  const [, forceTick] = useState(0)

  function ingresar(datos) {
    localStorage.setItem(SESION_KEY, JSON.stringify(datos))
    setSesion(datos)
  }

  function salir() {
    localStorage.removeItem(SESION_KEY)
    setSesion(null)
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
    if (!sesion) return
    cargarDatos()
    const interval = setInterval(cargarDatos, POLL_MS)
    return () => clearInterval(interval)
  }, [cargarDatos, sesion])

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
              prev.map((r) => (r.id === productId ? { ...r, en_tienda: '', en_vitrina: '', en_cajas: '' } : r))
            )
            return
          }
          const c = payload.new
          setRows((prev) =>
            prev.map((r) =>
              r.id === productId
                ? { ...r, en_tienda: c.en_tienda ?? '', en_vitrina: c.en_vitrina ?? '', en_cajas: c.en_cajas ?? '' }
                : r
            )
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
          localStorage.removeItem(SESION_KEY)
          setSesion(null)
          setInventarioCerrado(true)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [sesion])

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
    const valores = {
      en_tienda: Number(fila.en_tienda) || 0,
      en_vitrina: Number(fila.en_vitrina) || 0,
      en_cajas: Number(fila.en_cajas) || 0,
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
    // (Sin bloquear la UI del trabajador si esto llega a fallar.)
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
          en_vitrina: Number(r.en_vitrina) || 0,
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

      // Limpiar para la siguiente ronda.
      await supabase.from('conteos').delete().neq('id', 0)
      if (idsVisibles.length > 0) {
        await supabase.from('conteo_log').delete().in('product_id', idsVisibles)
      }

      localStorage.removeItem(SESION_KEY)
      setSesion(null)
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

  const resumenChips = (rows || []).reduce(
    (acc, r) => {
      const f = calcularFaltante(r)
      if (f === 0) acc.ok += 1
      else if (f > 0) acc.faltan += 1
      else acc.sobran += 1
      return acc
    },
    { ok: 0, faltan: 0, sobran: 0 }
  )

  if (inventarioCerrado) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h2>Inventario cerrado</h2>
          <p>Esperando nuevo inventario. El administrador avisará cuando haya una nueva ronda para contar.</p>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setInventarioCerrado(false)}>
            Iniciar sesión
          </button>
        </div>
      </div>
    )
  }

  if (!sesion) {
    return <GateTrabajador onIngresar={ingresar} />
  }

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Trabajador — {sesion.nombre}</div>
          <h1>Conteo de inventario</h1>
        </div>
        <div className="row-inline" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={cargarDatos}>Actualizar</button>
          <button className="btn btn-ghost" onClick={salir}>Salir</button>
        </div>
      </div>

      {ronda && <p className="hint">Ronda: <strong>{ronda}</strong></p>}
      {filtro && <p className="hint">Mostrando productos que comienzan con "{filtro}"</p>}

      {errorMsg && <div className="card"><p className="error-text">{errorMsg}</p></div>}

      {!cargando && rows && rows.length > 0 && (
        <div className="summary-row">
          <div className="chip ok"><div className="num">{resumenChips.ok}</div><div className="lbl">Cuadrados</div></div>
          <div className="chip bad"><div className="num">{resumenChips.faltan}</div><div className="lbl">Con faltantes</div></div>
          <div className="chip warn"><div className="num">{resumenChips.sobran}</div><div className="lbl">Con sobrantes</div></div>
        </div>
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
        </>
      )}
    </div>
  )
}
