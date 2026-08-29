import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient.js'
import { useSesionTrabajador } from '../../lib/useSesionTrabajador.js'
import GateTrabajador from '../../components/GateTrabajador.jsx'

const HOY_ISO = () => new Date().toISOString().slice(0, 10)

// Timeout del pedido de cálculo (2026-08-29): esto es 1-2 SELECT livianos
// por turno contra la base de cierre (ver lib/comisiones.js en
// agente-servidor), no una republicación de catálogo completo como
// vencimientos_solicitudes -- 2 min alcanza de sobra (contra los 8 min de
// esa otra, medidos con ~2900 productos).
const TIMEOUT_CALCULO_MS = 120000

async function registrarLog(turnoId, sesion, accion, detalle) {
  await supabase.from('turnos_log').insert({
    turno_id: turnoId, worker_id: sesion.id, worker_nombre: sesion.nombre, accion, detalle,
  })
}

function formatoHora(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}

function formatoMonto(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

function PantallaMarcar() {
  const { sesion, sesionLista, salir } = useSesionTrabajador()
  const [turnoHoy, setTurnoHoy] = useState(null) // null = todavía no se sabe; false = no hay turno hoy
  const [marcando, setMarcando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [mensajeEsError, setMensajeEsError] = useState(false)
  const [propios, setPropios] = useState(null)
  const [calculando, setCalculando] = useState(false)
  const [desdeCalc, setDesdeCalc] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 6)
    return d.toISOString().slice(0, 10)
  })
  const [hastaCalc, setHastaCalc] = useState(HOY_ISO())

  const cargarTurnoHoy = useCallback(async () => {
    if (!sesion) return
    const { data, error } = await supabase
      .from('turnos')
      .select('*')
      .eq('worker_id', sesion.id)
      .eq('fecha', HOY_ISO())
      .maybeSingle()
    if (error) { setMensaje('No se pudo cargar el turno de hoy: ' + error.message); setMensajeEsError(true); return }
    setTurnoHoy(data || false)
  }, [sesion])

  const cargarPropios = useCallback(async () => {
    if (!sesion) return
    const { data, error } = await supabase
      .from('turnos')
      .select('*')
      .eq('worker_id', sesion.id)
      .order('fecha', { ascending: false })
      .limit(14)
    if (error) return
    setPropios(data || [])
  }, [sesion])

  useEffect(() => { cargarTurnoHoy(); cargarPropios() }, [cargarTurnoHoy, cargarPropios])

  async function marcarEntrada() {
    setMarcando(true)
    setMensaje('')
    const ahora = new Date().toISOString()
    const { data, error } = await supabase
      .from('turnos')
      .insert({ worker_id: sesion.id, worker_nombre: sesion.nombre, fecha: HOY_ISO(), hora_entrada: ahora, marcado_por: 'trabajador' })
      .select()
      .single()
    setMarcando(false)
    if (error) { setMensaje('No se pudo marcar entrada: ' + error.message); setMensajeEsError(true); return }
    await registrarLog(data.id, sesion, 'marcado_entrada', { hora: ahora })
    setTurnoHoy(data)
    cargarPropios()
  }

  async function marcarCampo(campo, accion, extra = {}) {
    if (!turnoHoy) return
    setMarcando(true)
    setMensaje('')
    const ahora = new Date().toISOString()
    const payload = { [campo]: ahora, actualizado_por: sesion.nombre, actualizado_en: ahora, ...extra }
    const { error } = await supabase.from('turnos').update(payload).eq('id', turnoHoy.id)
    setMarcando(false)
    if (error) { setMensaje('No se pudo marcar: ' + error.message); setMensajeEsError(true); return }
    await registrarLog(turnoHoy.id, sesion, accion, { hora: ahora })
    setTurnoHoy((prev) => ({ ...prev, ...payload }))
    cargarPropios()
  }

  function marcarAlmuerzoInicio() { marcarCampo('hora_almuerzo_inicio', 'marcado_almuerzo_inicio') }
  function marcarAlmuerzoFin() { marcarCampo('hora_almuerzo_fin', 'marcado_almuerzo_fin') }
  function marcarSalida() { marcarCampo('hora_salida', 'marcado_salida', { estado: 'cerrado' }) }

  // Pedido explícito del usuario: cualquier trabajador puede pedir el
  // cálculo de SUS PROPIOS turnos al toque (ej. alguien que solo trabaja
  // fines de semana, sin depender de que el admin lo calcule) -- mismo
  // patrón insert+poll+timeout que "Actualizar" en Vencimientos.
  async function calcularMiComision() {
    setCalculando(true)
    setMensaje('')
    const { data: solicitud, error } = await supabase
      .from('turnos_solicitudes')
      .insert({ worker_id: sesion.id, desde: desdeCalc, hasta: hastaCalc, solicitado_por: sesion.nombre })
      .select()
      .single()
    if (error) {
      setMensaje('No se pudo pedir el cálculo: ' + error.message)
      setMensajeEsError(true)
      setCalculando(false)
      return
    }

    let resuelto = false
    const terminar = async (row) => {
      if (resuelto) return
      resuelto = true
      supabase.removeChannel(canal)
      clearTimeout(timeoutId)
      setCalculando(false)
      if (row?.status === 'error') {
        setMensaje('El cálculo falló: ' + (row.mensaje || 'error desconocido'))
        setMensajeEsError(true)
      } else {
        setMensaje(row?.mensaje ? `Listo: ${row.mensaje}` : 'Cálculo listo.')
        setMensajeEsError(false)
      }
      await cargarPropios()
    }

    const canal = supabase
      .channel(`turnos-solicitud-${solicitud.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'turnos_solicitudes', filter: `id=eq.${solicitud.id}` },
        (payload) => {
          if (payload.new?.status === 'done' || payload.new?.status === 'error') terminar(payload.new)
        }
      )
      .subscribe()

    const timeoutId = setTimeout(() => {
      if (resuelto) return
      resuelto = true
      supabase.removeChannel(canal)
      setCalculando(false)
      setMensaje('El cálculo está tardando más de lo normal -- probá de nuevo en un momento.')
      setMensajeEsError(true)
      cargarPropios()
    }, TIMEOUT_CALCULO_MS)
  }

  if (!sesionLista) return null
  if (!sesion) return <GateTrabajador onIngresar={() => { window.location.href = '/' }} />

  const sinTurnoHoy = turnoHoy === false
  const conEntrada = turnoHoy && turnoHoy.hora_entrada
  const enAlmuerzo = conEntrada && turnoHoy.hora_almuerzo_inicio && !turnoHoy.hora_almuerzo_fin
  const puedeAlmuerzoInicio = conEntrada && !turnoHoy.hora_almuerzo_inicio && turnoHoy.estado === 'abierto'
  const puedeAlmuerzoFin = enAlmuerzo
  const puedeSalida = conEntrada && turnoHoy.estado === 'abierto' && !enAlmuerzo

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Turnos — {sesion.nombre}</div>
          <h1>Marcar turno</h1>
        </div>
        <div className="row-inline" style={{ gap: 8 }}>
          <a className="btn btn-ghost" href="/turnos/historial">Mi historial</a>
          <a className="btn btn-ghost" href="/">Inicio</a>
          <button className="btn btn-ghost" onClick={salir}>Salir</button>
        </div>
      </div>

      <p className="hint">
        Esto es una herramienta interna para calcular comisiones — no reemplaza el libro de asistencia físico, que sigue siendo el registro oficial.
      </p>

      {mensaje && <div className="card"><p className={mensajeEsError ? 'error-text' : ''}>{mensaje}</p></div>}

      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>Turno de hoy ({HOY_ISO()})</p>

        {turnoHoy === null && <p>Cargando…</p>}

        {sinTurnoHoy && (
          <button className="btn btn-primary" onClick={marcarEntrada} disabled={marcando}>
            {marcando ? 'Marcando…' : 'Marcar entrada'}
          </button>
        )}

        {conEntrada && (
          <>
            <div className="row-inline" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
              <span>Entrada: <strong>{formatoHora(turnoHoy.hora_entrada)}</strong></span>
              <span>Almuerzo: <strong>{formatoHora(turnoHoy.hora_almuerzo_inicio)} – {formatoHora(turnoHoy.hora_almuerzo_fin)}</strong></span>
              <span>Salida: <strong>{formatoHora(turnoHoy.hora_salida)}</strong></span>
              {turnoHoy.estado === 'abierto' && <span className="status-pill warn" style={{ display: 'inline-flex' }}>Turno abierto</span>}
              {turnoHoy.estado === 'cerrado' && <span className="status-pill ok" style={{ display: 'inline-flex' }}>Turno cerrado</span>}
            </div>
            <div className="row-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
              {puedeAlmuerzoInicio && (
                <button className="btn btn-secondary" onClick={marcarAlmuerzoInicio} disabled={marcando}>Salir a almorzar</button>
              )}
              {puedeAlmuerzoFin && (
                <button className="btn btn-secondary" onClick={marcarAlmuerzoFin} disabled={marcando}>Volví de almorzar</button>
              )}
              {puedeSalida && (
                <button className="btn btn-primary" onClick={marcarSalida} disabled={marcando}>Marcar salida</button>
              )}
              {turnoHoy.estado === 'cerrado' && <p className="hint" style={{ margin: 0 }}>Turno ya cerrado por hoy.</p>}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>Calcular mi venta y comisión</p>
        <div className="row-inline" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div className="field">
            <label>Desde</label>
            <input type="date" value={desdeCalc} onChange={(e) => setDesdeCalc(e.target.value)} />
          </div>
          <div className="field">
            <label>Hasta</label>
            <input type="date" value={hastaCalc} onChange={(e) => setHastaCalc(e.target.value)} />
          </div>
        </div>
        <button className="btn btn-primary" onClick={calcularMiComision} disabled={calculando}>
          {calculando ? 'Calculando…' : 'Calcular'}
        </button>
        {calculando && <p className="hint">Puede tardar hasta un par de minutos — podés esperar acá.</p>}
      </div>

      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>Mis últimos turnos</p>
        {propios === null && <p>Cargando…</p>}
        {propios !== null && propios.length === 0 && <p className="hint">Todavía no marcaste ningún turno.</p>}
        {propios !== null && propios.length > 0 && (
          <div className="tabla-scroll">
            <table className="table-preview">
              <thead>
                <tr><th>Fecha</th><th>Entrada</th><th>Salida</th><th>Bruto</th><th>Neto</th><th>Comisión</th></tr>
              </thead>
              <tbody>
                {propios.map((t) => (
                  <tr key={t.id}>
                    <td>{t.fecha}</td>
                    <td>{formatoHora(t.hora_entrada)}</td>
                    <td>{formatoHora(t.hora_salida)}</td>
                    <td>{t.calculado_en ? formatoMonto(t.bruto) : '—'}</td>
                    <td>{t.calculado_en ? formatoMonto(t.neto) : '—'}</td>
                    <td>{t.calculado_en ? formatoMonto(t.comision_monto) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default PantallaMarcar
