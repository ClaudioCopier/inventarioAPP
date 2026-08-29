import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient.js'
import { useSesionTrabajador } from '../../lib/useSesionTrabajador.js'
import GateTrabajador from '../../components/GateTrabajador.jsx'
import CampoHora from '../../components/CampoHora.jsx'

const HOY_ISO = () => new Date().toISOString().slice(0, 10)

async function registrarLog(turnoId, sesion, accion, detalle) {
  await supabase.from('turnos_log').insert({
    turno_id: turnoId, worker_id: sesion.id, worker_nombre: sesion.nombre, accion, detalle,
  })
}

function formatoHora(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}

// Corregir una hora ya marcada (2026-08-29, pedido explícito del usuario):
// el trabajador puede editar cualquiera de sus propias horas después de
// marcarlas (por si se equivocó al tocar el botón), pero cada corrección
// queda en turnos_log con su propio accion ('corregido_trabajador'),
// distinto de 'corregido_admin' -- nunca es una edición silenciosa.
function EdicionHoras({ turno, sesion, onGuardado, onCancelar }) {
  const [horaEntrada, setHoraEntrada] = useState(turno.hora_entrada || '')
  const [horaAlmuerzoInicio, setHoraAlmuerzoInicio] = useState(turno.hora_almuerzo_inicio || '')
  const [horaAlmuerzoFin, setHoraAlmuerzoFin] = useState(turno.hora_almuerzo_fin || '')
  const [horaSalida, setHoraSalida] = useState(turno.hora_salida || '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function guardar() {
    if (!horaEntrada) { setError('La hora de entrada no puede quedar vacía.'); return }
    setError('')
    setGuardando(true)
    const ahora = new Date().toISOString()
    const payload = {
      hora_entrada: horaEntrada,
      hora_almuerzo_inicio: horaAlmuerzoInicio || null,
      hora_almuerzo_fin: horaAlmuerzoFin || null,
      hora_salida: horaSalida || null,
    }
    const { error: errUpdate } = await supabase
      .from('turnos')
      .update({ ...payload, corregido: true, actualizado_por: sesion.nombre, actualizado_en: ahora })
      .eq('id', turno.id)
    setGuardando(false)
    if (errUpdate) { setError('No se pudo guardar: ' + errUpdate.message); return }
    await registrarLog(turno.id, sesion, 'corregido_trabajador', payload)
    onGuardado()
  }

  return (
    <div className="card" style={{ background: 'var(--alert-warn-bg)' }}>
      <p className="hint" style={{ marginTop: 0 }}>Corregir horas del {turno.fecha}</p>
      <div className="row-inline" style={{ gap: 16, flexWrap: 'wrap' }}>
        <CampoHora label="Entrada" value={horaEntrada} onChange={setHoraEntrada} fecha={turno.fecha} />
        <CampoHora label="Colación (salida)" value={horaAlmuerzoInicio} onChange={setHoraAlmuerzoInicio} fecha={turno.fecha} />
        <CampoHora label="Colación (vuelta)" value={horaAlmuerzoFin} onChange={setHoraAlmuerzoFin} fecha={turno.fecha} />
        <CampoHora label="Salida" value={horaSalida} onChange={setHoraSalida} fecha={turno.fecha} />
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="row-inline" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar corrección'}</button>
        <button className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>Cancelar</button>
      </div>
    </div>
  )
}

function PantallaMarcar() {
  const { sesion, sesionLista, salir } = useSesionTrabajador()
  const [turnoHoy, setTurnoHoy] = useState(null) // null = todavía no se sabe; false = no hay turno hoy
  const [marcando, setMarcando] = useState(false)
  const [editandoHoy, setEditandoHoy] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [mensajeEsError, setMensajeEsError] = useState(false)
  const [propios, setPropios] = useState(null)
  const [editandoId, setEditandoId] = useState(null)

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

  // "Días asistidos" (2026-08-29, pedido explícito del usuario): el
  // trabajador ve solo su asistencia (fecha + horas), nunca bruto/neto/
  // comisión -- esos datos ya ni siquiera viven en esta tabla (ver
  // supabase_migration_turnos_comision_privada.sql), así que no hace
  // falta filtrar columnas acá, no existen del lado del trabajador.
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
        Esto es una herramienta interna de asistencia — no reemplaza el libro físico, que sigue siendo el registro oficial.
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

        {conEntrada && !editandoHoy && (
          <>
            <div className="row-inline" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
              <span>Entrada: <strong>{formatoHora(turnoHoy.hora_entrada)}</strong></span>
              <span>Colación: <strong>{formatoHora(turnoHoy.hora_almuerzo_inicio)} – {formatoHora(turnoHoy.hora_almuerzo_fin)}</strong></span>
              <span>Salida: <strong>{formatoHora(turnoHoy.hora_salida)}</strong></span>
              {turnoHoy.estado === 'abierto' && <span className="status-pill warn" style={{ display: 'inline-flex' }}>Turno abierto</span>}
              {turnoHoy.estado === 'cerrado' && <span className="status-pill ok" style={{ display: 'inline-flex' }}>Turno cerrado</span>}
            </div>
            <div className="row-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
              {puedeAlmuerzoInicio && (
                <button className="btn btn-secondary" onClick={marcarAlmuerzoInicio} disabled={marcando}>Salir a colación</button>
              )}
              {puedeAlmuerzoFin && (
                <button className="btn btn-secondary" onClick={marcarAlmuerzoFin} disabled={marcando}>Volví de colación</button>
              )}
              {puedeSalida && (
                <button className="btn btn-primary" onClick={marcarSalida} disabled={marcando}>Marcar salida</button>
              )}
              <button className="btn btn-ghost" onClick={() => setEditandoHoy(true)}>Corregir una hora</button>
            </div>
          </>
        )}

        {conEntrada && editandoHoy && (
          <EdicionHoras
            turno={turnoHoy}
            sesion={sesion}
            onGuardado={() => { setEditandoHoy(false); cargarTurnoHoy(); cargarPropios() }}
            onCancelar={() => setEditandoHoy(false)}
          />
        )}
      </div>

      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>Mis días asistidos</p>
        {propios === null && <p>Cargando…</p>}
        {propios !== null && propios.length === 0 && <p className="hint">Todavía no marcaste ningún turno.</p>}
        {propios !== null && propios.length > 0 && (
          <div className="tabla-scroll">
            <table className="table-preview">
              <thead>
                <tr><th>Fecha</th><th>Entrada</th><th>Colación</th><th>Salida</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {propios.map((t) => (
                  <tr key={t.id}>
                    {editandoId === t.id ? (
                      <td colSpan={6} style={{ padding: 0 }}>
                        <div style={{ padding: '12px 0' }}>
                          <EdicionHoras
                            turno={t}
                            sesion={sesion}
                            onGuardado={() => { setEditandoId(null); cargarPropios(); cargarTurnoHoy() }}
                            onCancelar={() => setEditandoId(null)}
                          />
                        </div>
                      </td>
                    ) : (
                      <>
                        <td>{t.fecha}</td>
                        <td>{formatoHora(t.hora_entrada)}</td>
                        <td>{formatoHora(t.hora_almuerzo_inicio)}–{formatoHora(t.hora_almuerzo_fin)}</td>
                        <td>{formatoHora(t.hora_salida)}</td>
                        <td>{t.estado === 'abierto' ? 'Abierto' : 'Cerrado'}{t.corregido ? ' (corregido)' : ''}</td>
                        <td><button className="btn btn-ghost btn-sm" onClick={() => setEditandoId(t.id)}>Corregir</button></td>
                      </>
                    )}
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
