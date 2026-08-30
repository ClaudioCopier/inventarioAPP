import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient.js'
import { useSesionTrabajador } from '../../lib/useSesionTrabajador.js'
import GateTrabajador from '../../components/GateTrabajador.jsx'
import CampoHora from '../../components/CampoHora.jsx'
import CalendarioTurnos from '../../components/CalendarioTurnos.jsx'
import { useAvanceHoras } from '../../lib/useAvanceHoras.js'

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
  const avance = useAvanceHoras({ setHoraAlmuerzoInicio, setHoraAlmuerzoFin })

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
      // estado es columna generada a partir de hora_salida (2026-08-30,
      // ver supabase_migration_turnos_estado_generado.sql) -- arregla de
      // raíz un bug real: este formulario corregía hora_salida pero nunca
      // tocaba estado, y el turno quedaba "abierto" para siempre. Ahora
      // Postgres lo calcula solo, no se puede volver a olvidar.
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
        <CampoHora ref={avance.refEntrada} label="Entrada" value={horaEntrada} onChange={setHoraEntrada} fecha={turno.fecha} onCompleto={avance.alCompletarEntrada} />
        <CampoHora ref={avance.refAlmuerzoInicio} label="Colación (salida)" value={horaAlmuerzoInicio} onChange={setHoraAlmuerzoInicio} fecha={turno.fecha} onCompleto={avance.alCompletarAlmuerzoInicio} />
        <CampoHora ref={avance.refAlmuerzoFin} label="Colación (vuelta)" value={horaAlmuerzoFin} onChange={setHoraAlmuerzoFin} fecha={turno.fecha} onCompleto={avance.alCompletarAlmuerzoFin} />
        <CampoHora ref={avance.refSalida} label="Salida" value={horaSalida} onChange={setHoraSalida} fecha={turno.fecha} onCompleto={avance.alCompletarSalida} />
      </div>
      <p className="hint" style={{ marginTop: 0 }}>Tip: escribiendo "0000" en "Colación (salida)" se salta directo a Salida — queda registrado como que no tuvo colación.</p>
      {error && <div className="error-text">{error}</div>}
      <div className="row-inline" style={{ marginTop: 12 }}>
        <button ref={avance.refGuardar} className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar corrección'}</button>
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
  const [editandoDia, setEditandoDia] = useState(null) // turno del calendario en corrección, o null
  const [refrescarTick, setRefrescarTick] = useState(0)

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

  useEffect(() => { cargarTurnoHoy() }, [cargarTurnoHoy])

  function refrescarCalendario() { setRefrescarTick((n) => n + 1) }

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
    refrescarCalendario()
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
    refrescarCalendario()
  }

  function marcarAlmuerzoInicio() { marcarCampo('hora_almuerzo_inicio', 'marcado_almuerzo_inicio') }
  function marcarAlmuerzoFin() { marcarCampo('hora_almuerzo_fin', 'marcado_almuerzo_fin') }
  function marcarSalida() { marcarCampo('hora_salida', 'marcado_salida') } // estado es columna generada

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
            onGuardado={() => { setEditandoHoy(false); cargarTurnoHoy(); refrescarCalendario() }}
            onCancelar={() => setEditandoHoy(false)}
          />
        )}
      </div>

      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>Mis días asistidos</p>
        {editandoDia ? (
          <EdicionHoras
            turno={editandoDia}
            sesion={sesion}
            onGuardado={() => { setEditandoDia(null); cargarTurnoHoy(); refrescarCalendario() }}
            onCancelar={() => setEditandoDia(null)}
          />
        ) : (
          <CalendarioTurnos
            workerId={sesion.id}
            refrescarTick={refrescarTick}
            onEditarTurno={(t) => setEditandoDia(t)}
          />
        )}
      </div>
    </div>
  )
}

export default PantallaMarcar
