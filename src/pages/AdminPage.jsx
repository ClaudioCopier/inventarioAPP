import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient.js'
import ReporteCard from '../components/ReporteCard.jsx'

const ADMIN_CLAVE = import.meta.env.VITE_ADMIN_CLAVE || ''

// Algunos sistemas de punto de venta antiguos exportan las cantidades como un
// entero "sin decimales" (300) y le aplican un formato de celda en Excel que
// lo muestra correctamente (3,00). Si leemos el valor crudo de la celda nos
// queda todo multiplicado por 100. Por eso parseamos el texto tal como
// Excel lo muestra (coma o punto decimal, según corresponda) en vez del
// número crudo.
function parseNumeroLocal(valor) {
  if (typeof valor === 'number') return valor
  const texto = String(valor ?? '').trim()
  if (texto === '') return 0
  let limpio = texto.replace(/[^0-9.,-]/g, '')
  const ultimaComa = limpio.lastIndexOf(',')
  const ultimoPunto = limpio.lastIndexOf('.')
  if (ultimaComa > -1 && ultimoPunto > -1) {
    // Trae ambos separadores: el último es el decimal, el otro es de miles.
    limpio = ultimaComa > ultimoPunto
      ? limpio.replace(/\./g, '').replace(',', '.')
      : limpio.replace(/,/g, '')
  } else if (ultimaComa > -1) {
    limpio = limpio.replace(',', '.')
  }
  const n = Number(limpio)
  return Number.isNaN(n) ? 0 : n
}

export default function AdminPage() {
  const [autenticado, setAutenticado] = useState(false)
  const [claveIngresada, setClaveIngresada] = useState('')
  const [errorClave, setErrorClave] = useState('')

  // Excel parsing state
  const [headers, setHeaders] = useState([])
  const [filas, setFilas] = useState([])
  const [colDescripcion, setColDescripcion] = useState('')
  const [colInventario, setColInventario] = useState('')
  const [nombreArchivo, setNombreArchivo] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const subiendoRef = useRef(false)
  const [mensaje, setMensaje] = useState('')
  const [vaciando, setVaciando] = useState(false)

  // Current state from DB
  const [totalProductos, setTotalProductos] = useState(0)
  const [filtroActual, setFiltroActual] = useState('')
  const [filtroInput, setFiltroInput] = useState('')
  const [ronda, setRonda] = useState('')

  // Sincronización directa con el POS
  const [syncRequest, setSyncRequest] = useState(null) // última solicitud (o en curso)
  const [pidiendoSync, setPidiendoSync] = useState(false)

  // Reportes de inventarios finalizados (solo los últimos 5 acá; el
  // historial completo vive en /admin/historial y nunca se borra).
  const [reportes, setReportes] = useState([])

  useEffect(() => {
    if (autenticado) {
      cargarEstado()
      cargarUltimaSync()
      cargarReportes()
    }
  }, [autenticado])

  useEffect(() => {
    if (!autenticado) return
    const canal = supabase
      .channel('reportes-admin')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'reportes_inventario' },
        () => { cargarReportes(); cargarEstado() }
      )
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [autenticado])

  async function cargarReportes() {
    const { data } = await supabase
      .from('reportes_inventario')
      .select('*')
      .order('cerrado_en', { ascending: false })
      .limit(5)
    setReportes(data || [])
  }

  useEffect(() => {
    if (!autenticado) return
    const canal = supabase
      .channel('sync-requests-admin')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sync_requests' },
        (payload) => {
          setSyncRequest((prev) => {
            if (prev && payload.new && payload.new.id !== prev.id) return prev
            return payload.new
          })
          if (payload.new?.status === 'done') cargarEstado()
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [autenticado])

  async function cargarUltimaSync() {
    const { data } = await supabase
      .from('sync_requests')
      .select('*')
      .order('solicitado_en', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) setSyncRequest(data)
  }

  async function pedirSincronizacion() {
    setPidiendoSync(true)
    const { data, error } = await supabase
      .from('sync_requests')
      .insert({ status: 'pending' })
      .select()
      .single()
    setPidiendoSync(false)
    if (error) {
      setMensaje('No se pudo pedir la sincronización: ' + error.message)
      return
    }
    setSyncRequest(data)
  }

  async function cargarEstado() {
    const { count, error: countError } = await supabase.from('products').select('*', { count: 'exact', head: true })
    if (countError) {
      setMensaje('No se pudo cargar el estado: ' + countError.message)
      return
    }
    setTotalProductos(count || 0)
    const { data, error: configError } = await supabase.from('config').select('*').eq('id', 1).single()
    if (configError) {
      setMensaje('No se pudo cargar la configuración: ' + configError.message)
      return
    }
    if (data) {
      setFiltroActual(data.filtro_prefijo || '')
      setFiltroInput(data.filtro_prefijo || '')
      setRonda(data.ronda || '')
    }
  }

  function intentarLogin(e) {
    e.preventDefault()
    if (!ADMIN_CLAVE) {
      setErrorClave('No se configuró VITE_ADMIN_CLAVE en el servidor. Revisa el archivo .env')
      return
    }
    if (claveIngresada === ADMIN_CLAVE) {
      setAutenticado(true)
      setErrorClave('')
    } else {
      setErrorClave('Clave incorrecta')
    }
  }

  function manejarArchivo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setNombreArchivo(file.name)
    setMensaje('Leyendo archivo…')
    const reader = new FileReader()
    reader.onload = async (evt) => {
      // Carga diferida: xlsx pesa bastante y solo lo necesita el admin,
      // no tiene sentido incluirlo en el bundle que descargan los trabajadores.
      const XLSX = await import('xlsx')
      const wb = XLSX.read(evt.target.result, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      // raw: false hace que cada celda venga como Excel la muestra (respetando
      // el formato numérico), no como el número crudo guardado internamente.
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
      if (json.length === 0) {
        setMensaje('El archivo no tiene filas de datos.')
        return
      }
      const cols = Object.keys(json[0])
      setHeaders(cols)
      setFilas(json)
      // Adivinar columnas por nombre
      const guessDesc = cols.find((c) => /descrip/i.test(c)) || cols[0]
      const guessInv = cols.find((c) => /inventar|stock|existenc/i.test(c)) || cols[1] || cols[0]
      setColDescripcion(guessDesc)
      setColInventario(guessInv)
      setMensaje('')
    }
    reader.readAsArrayBuffer(file)
  }

  async function confirmarCarga() {
    if (!colDescripcion || !colInventario) {
      setMensaje('Selecciona la columna de descripción y la de inventario.')
      return
    }
    // Guarda extra contra doble clic o doble envío: setSubiendo(true) es
    // asíncrono (React lo aplica en el próximo render), así que si el botón
    // no alcanza a deshabilitarse a tiempo, dos subidas podían correr en
    // paralelo y las dos sobrevivían (cada una borraba solo la foto de
    // productos que había ANTES de sí misma, no la del otro envío).
    if (subiendoRef.current) return
    subiendoRef.current = true
    setSubiendo(true)
    setMensaje('')
    try {
      const registros = filas
        .map((f) => ({
          descripcion: String(f[colDescripcion] ?? '').trim(),
          inventario_sistema: parseNumeroLocal(f[colInventario]),
        }))
        .filter((r) => r.descripcion.length > 0)

      if (registros.length === 0) {
        setMensaje('No se encontraron filas válidas con esa columna de descripción.')
        setSubiendo(false)
        return
      }

      // Guardamos los ids que había ANTES de subir el nuevo Excel.
      // Insertamos primero los nuevos y recién al final borramos los viejos:
      // así, si la subida falla a la mitad, no nos quedamos sin productos.
      const { data: existentes, error: existentesError } = await supabase.from('products').select('id')
      if (existentesError) throw existentesError
      const idsAnteriores = (existentes || []).map((p) => p.id)

      const tam = 500
      for (let i = 0; i < registros.length; i += tam) {
        const tanda = registros.slice(i, i + tam)
        const { error } = await supabase.from('products').insert(tanda)
        if (error) throw error
      }

      for (let i = 0; i < idsAnteriores.length; i += tam) {
        const lote = idsAnteriores.slice(i, i + tam)
        const { error: deleteError } = await supabase.from('products').delete().in('id', lote)
        if (deleteError) throw deleteError
      }

      setMensaje(`Se cargaron ${registros.length} productos correctamente.`)
      setHeaders([])
      setFilas([])
      setNombreArchivo('')
      cargarEstado()
    } catch (err) {
      setMensaje('Error al subir: ' + err.message + '. Tus productos anteriores siguen intactos, puedes intentarlo de nuevo.')
    } finally {
      subiendoRef.current = false
      setSubiendo(false)
    }
  }

  async function publicarFiltro() {
    const { error } = await supabase
      .from('config')
      .update({ filtro_prefijo: filtroInput, ronda, actualizado_en: new Date().toISOString() })
      .eq('id', 1)
    if (error) {
      setMensaje('Error al publicar el filtro: ' + error.message)
      return
    }
    setFiltroActual(filtroInput)
    setMensaje('Filtro publicado. Los trabajadores lo verán al refrescar.')
  }

  async function vaciarProductos() {
    if (!confirm('¿Vaciar TODOS los productos cargados? Esto borra también sus conteos. No se puede deshacer.')) return
    setVaciando(true)
    const { error } = await supabase.from('products').delete().neq('id', 0)
    setVaciando(false)
    if (error) {
      setMensaje('Error al vaciar productos: ' + error.message)
      return
    }
    setMensaje('Productos vaciados.')
    cargarEstado()
  }

  async function reiniciarConteos() {
    if (!confirm('¿Reiniciar todos los conteos de los trabajadores a cero? Esta acción no se puede deshacer.')) return
    const { error } = await supabase.from('conteos').delete().neq('id', 0)
    if (error) {
      setMensaje('Error al reiniciar conteos: ' + error.message)
      return
    }
    setMensaje('Conteos reiniciados.')
  }

  if (!autenticado) {
    return (
      <div className="gate">
        <form className="gate-card" onSubmit={intentarLogin}>
          <h2>Acceso administrador</h2>
          <p>Ingresa la clave para entrar al panel.</p>
          <div className="field">
            <label htmlFor="clave">Clave</label>
            <input
              id="clave"
              type="password"
              value={claveIngresada}
              onChange={(e) => setClaveIngresada(e.target.value)}
              autoFocus
            />
          </div>
          {errorClave && <div className="error-text">{errorClave}</div>}
          <button className="btn btn-primary" style={{ width: '100%' }} type="submit">Entrar</button>
        </form>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Administrador</div>
          <h1>Panel de inventario</h1>
        </div>
      </div>

      <div className="card">
        <h3>1. Actualizar inventario desde el sistema POS</h3>
        <p>
          Pide al sistema de la tienda que envíe el inventario actual directo a esta app. Actualiza cada
          producto por su código, así los conteos que los trabajadores ya hicieron no se pierden.
        </p>
        <button className="btn btn-primary" onClick={pedirSincronizacion} disabled={pidiendoSync || syncRequest?.status === 'pending' || syncRequest?.status === 'running'}>
          {pidiendoSync ? 'Enviando solicitud…' : 'Actualizar inventario desde el sistema POS'}
        </button>
        {syncRequest && (
          <p className="hint" style={{ marginTop: 10 }}>
            {syncRequest.status === 'pending' && 'Esperando a que la computadora de la tienda tome la solicitud…'}
            {syncRequest.status === 'running' && 'Sincronizando con el sistema POS…'}
            {syncRequest.status === 'done' && `Última sincronización: ${syncRequest.mensaje || 'completada'}`}
            {syncRequest.status === 'error' && `Error en la última sincronización: ${syncRequest.mensaje}`}
          </p>
        )}
      </div>

      <div className="card">
        <h3>2. O subir un Excel a mano</h3>
        <p>Alternativa si la computadora de la tienda está apagada. Esto reemplaza la lista actual y reinicia los conteos.</p>
        <div className="field">
          <label>Archivo Excel (.xlsx, .xls, .csv)</label>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={manejarArchivo} />
        </div>

        {headers.length > 0 && (
          <>
            <div className="row-inline">
              <div className="field">
                <label>Columna con la descripción del producto</label>
                <select value={colDescripcion} onChange={(e) => setColDescripcion(e.target.value)}>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Columna con el inventario del sistema</label>
                <select value={colInventario} onChange={(e) => setColInventario(e.target.value)}>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>

            <table className="table-preview">
              <thead>
                <tr>
                  <th>{colDescripcion || 'Descripción'}</th>
                  <th>{colInventario || 'Inventario'}</th>
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, 5).map((f, i) => (
                  <tr key={i}>
                    <td>{String(f[colDescripcion] ?? '')}</td>
                    <td>{String(f[colInventario] ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">Mostrando {Math.min(5, filas.length)} de {filas.length} filas de "{nombreArchivo}".</p>

            <button className="btn btn-primary" onClick={confirmarCarga} disabled={subiendo}>
              {subiendo ? 'Subiendo…' : `Confirmar y cargar ${filas.length} productos`}
            </button>
          </>
        )}
      </div>

      <div className="card">
        <h3>3. Qué ve el trabajador</h3>
        <p>Actualmente hay <strong>{totalProductos}</strong> productos cargados en el sistema.</p>
        <div className="row-inline">
          <div className="field">
            <label>Filtrar descripción que comienza por</label>
            <input
              type="text"
              placeholder='Ej: "COCA" para mostrar solo esa marca'
              value={filtroInput}
              onChange={(e) => setFiltroInput(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Nombre de esta ronda (opcional)</label>
            <input
              type="text"
              placeholder="Ej: Conteo semana 1"
              value={ronda}
              onChange={(e) => setRonda(e.target.value)}
            />
          </div>
        </div>
        <button className="btn btn-primary" onClick={publicarFiltro}>Publicar filtro para trabajadores</button>
        <p className="hint" style={{ marginTop: 10 }}>
          Filtro actualmente publicado: <strong>{filtroActual ? `"${filtroActual}"` : '(sin filtro, se muestran todos)'}</strong>
        </p>
      </div>

      <div className="card">
        <h3>4. Reportes de inventarios finalizados</h3>
        {reportes.length === 0 && <p className="hint">Todavía no se ha finalizado ningún inventario.</p>}
        {reportes.map((r) => (
          <ReporteCard key={r.id} reporte={r} onError={setMensaje} />
        ))}
        {reportes.length > 0 && (
          <a
            className="btn btn-secondary"
            href={`/admin/historial?clave=${encodeURIComponent(ADMIN_CLAVE)}`}
            target="_blank"
            rel="noreferrer"
          >
            Ver todos los reportes
          </a>
        )}
      </div>

      <div className="card">
        <h3>5. Herramientas</h3>
        <div className="row-inline" style={{ marginBottom: 10 }}>
          <button className="btn btn-danger" onClick={reiniciarConteos}>Reiniciar conteos de trabajadores</button>
          <button className="btn btn-danger" onClick={vaciarProductos} disabled={vaciando}>
            {vaciando ? 'Vaciando…' : 'Vaciar productos'}
          </button>
          <a
            className="btn btn-secondary"
            href={`/trabajador?admin=${encodeURIComponent(ADMIN_CLAVE)}`}
            target="_blank"
            rel="noreferrer"
          >
            Ver como trabajador
          </a>
        </div>
        <p className="hint" style={{ marginTop: -4, marginBottom: 10 }}>
          "Vaciar productos" borra todo lo cargado (por Excel o por el POS) — útil si una subida se duplicó o quieres empezar de cero.
        </p>
        <p className="hint">Comparte este enlace con los trabajadores:</p>
        <div className="link-block">{typeof window !== 'undefined' ? window.location.origin + '/trabajador' : '/trabajador'}</div>
      </div>

      {mensaje && <div className="card"><p style={{ color: 'var(--ink)' }}>{mensaje}</p></div>}
    </div>
  )
}
