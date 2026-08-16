import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient.js'
import { useSesionTrabajador } from '../../lib/useSesionTrabajador.js'
import GateTrabajador from '../../components/GateTrabajador.jsx'
import { traerTodasLasFilas } from '../../lib/traerTodasLasFilas.js'
import { clasificarLote, calcularAlerta } from '../../lib/vencimientosReglas.js'

const FILTROS = [
  { clave: 'pendiente', label: 'Pendientes de fecha' },
  { clave: 'vencido', label: 'Vencidos' },
  { clave: 'proximo', label: 'Próximos a vencer' },
  { clave: 'todo', label: 'Todo' },
]

function PantallaLista() {
  const { sesion, sesionLista, salir } = useSesionTrabajador()
  const [lotes, setLotes] = useState(null) // null = cargando
  const [filtro, setFiltro] = useState('pendiente')
  const [omitiendo, setOmitiendo] = useState({}) // id -> bool
  const [mensaje, setMensaje] = useState('')

  const cargar = useCallback(async () => {
    setLotes(null)
    try {
      const data = await traerTodasLasFilas('lotes_vencimiento', '*', (q) => q.neq('estado', 'agotado'))
      setLotes(data)
    } catch (err) {
      setMensaje('No se pudo cargar: ' + err.message)
      setLotes([])
    }
  }, [])

  useEffect(() => {
    if (sesion) cargar()
  }, [sesion, cargar])

  async function omitir(lote) {
    setOmitiendo((prev) => ({ ...prev, [lote.id]: true }))
    const payload = {
      modo: 'omitido',
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
    }
    setOmitiendo((prev) => ({ ...prev, [lote.id]: false }))
  }

  if (!sesionLista) return null
  if (!sesion) return <GateTrabajador onIngresar={() => {}} />

  const hoy = new Date()
  const clasificados = (lotes || []).map((l) => ({ ...l, _clase: clasificarLote(l, hoy), _alerta: calcularAlerta(l, hoy) }))
  const visibles = filtro === 'todo' ? clasificados.filter((l) => l._clase !== 'omitido') : clasificados.filter((l) => l._clase === filtro)
  const conteos = FILTROS.reduce((acc, f) => {
    acc[f.clave] = f.clave === 'todo' ? clasificados.filter((l) => l._clase !== 'omitido').length : clasificados.filter((l) => l._clase === f.clave).length
    return acc
  }, {})

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Vencimientos — {sesion.nombre}</div>
          <h1>Lista completa</h1>
        </div>
        <div className="row-inline" style={{ gap: 8 }}>
          <a className="btn btn-ghost" href="/vencimientos">Cargar producto</a>
          <button className="btn btn-ghost" onClick={cargar}>Actualizar</button>
          <button className="btn btn-ghost" onClick={salir}>Salir</button>
        </div>
      </div>

      <p className="hint">Los pendientes son los que hay que revisar primero — usá "Omitir" para los que no importan (velas, envases, etc.) y avanzar rápido.</p>

      {mensaje && <div className="card"><p className="error-text">{mensaje}</p></div>}

      <div className="row-inline" style={{ marginBottom: 20 }}>
        {FILTROS.map((f) => (
          <button key={f.clave} type="button" className={`btn ${filtro === f.clave ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFiltro(f.clave)}>
            {f.label} ({conteos[f.clave] ?? 0})
          </button>
        ))}
      </div>

      {lotes === null && <div className="card"><p>Cargando…</p></div>}

      {lotes !== null && visibles.length === 0 && (
        <div className="card empty-state"><p>No hay nada en esta lista por ahora.</p></div>
      )}

      {lotes !== null && visibles.length > 0 && (
        <div className="product-list">
          {visibles.map((l) => (
            <div className="product-card" key={l.id}>
              <div className="desc">{l.descripcion}</div>
              <div className="sys">
                Código: {l.codigo} · Lote {l.numero_lote} · {l.cantidad_restante} unidad(es)
                {l._alerta.diasRestantes != null && (l._clase === 'vencido' || l._clase === 'proximo') && (
                  <> · {l._clase === 'vencido' ? `venció hace ${Math.abs(l._alerta.diasRestantes)} día(s)` : `vence en ${l._alerta.diasRestantes} día(s)`}</>
                )}
              </div>
              <div className="row-inline" style={{ marginTop: 12, justifyContent: 'space-between', alignItems: 'center' }}>
                <span className={`status-pill ${l._clase === 'vencido' ? 'bad' : l._clase === 'proximo' ? 'warn' : 'ok'}`} style={{ display: 'inline-flex' }}>
                  {l._clase === 'pendiente' ? 'Sin fecha' : l._clase === 'vencido' ? 'Vencido' : l._clase === 'proximo' ? 'Próximo a vencer' : 'Con fecha'}
                </span>
                <div className="row-inline" style={{ gap: 8 }}>
                  <a className="btn btn-ghost btn-sm" href={`/vencimientos?buscar=${encodeURIComponent(l.codigo)}`}>Cargar fecha</a>
                  {l._clase !== 'omitido' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => omitir(l)} disabled={omitiendo[l.id]}>
                      {omitiendo[l.id] ? 'Omitiendo…' : 'Omitir'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default PantallaLista
