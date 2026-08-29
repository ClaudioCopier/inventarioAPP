import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient.js'
import { ADMIN_EMAIL } from '../../lib/constantes.js'
import CampoHora from '../../components/CampoHora.jsx'

const HOY_ISO = () => new Date().toISOString().slice(0, 10)
function hace(dias) {
  const d = new Date(); d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

// Mismo criterio de timeout que MarcarPage.jsx -- 1-2 SELECT livianos por
// turno, no una republicación de catálogo completo.
const TIMEOUT_CALCULO_MS = 120000

function formatoHora(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}

function formatoMonto(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

async function registrarLog(turnoId, sesion, accion, detalle) {
  await supabase.from('turnos_log').insert({
    turno_id: turnoId, worker_id: sesion.id, worker_nombre: sesion.nombre, accion, detalle,
  })
}

// Formulario de horas de un turno -- compartido entre "editar/corregir" un
// turno existente y "crear" uno nuevo (backfill desde el libro físico).
// Si se completa hora_salida acá, el turno queda cerrado al guardar --
// mismo mecanismo que usa un admin para "forzar el cierre" de un turno que
// quedó abierto, sin un botón aparte.
function FormularioTurno({ turno, sesion, onGuardado, onCancelar }) {
  const [fecha, setFecha] = useState(turno?.fecha || HOY_ISO())
  const [horaEntrada, setHoraEntrada] = useState(turno?.hora_entrada || '')
  const [horaAlmuerzoInicio, setHoraAlmuerzoInicio] = useState(turno?.hora_almuerzo_inicio || '')
  const [horaAlmuerzoFin, setHoraAlmuerzoFin] = useState(turno?.hora_almuerzo_fin || '')
  const [horaSalida, setHoraSalida] = useState(turno?.hora_salida || '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function guardar() {
    if (!horaEntrada) { setError('Falta la hora de entrada.'); return }
    setError('')
    setGuardando(true)
    const ahora = new Date().toISOString()
    const payload = {
      fecha,
      hora_entrada: horaEntrada,
      hora_almuerzo_inicio: horaAlmuerzoInicio || null,
      hora_almuerzo_fin: horaAlmuerzoFin || null,
      hora_salida: horaSalida || null,
      estado: horaSalida ? 'cerrado' : 'abierto',
    }

    const seEstaCerrando = turno.estado === 'abierto' && horaSalida
    const { error: errUpdate } = await supabase
      .from('turnos')
      .update({ ...payload, corregido: true, marcado_por: 'admin', actualizado_por: sesion.nombre, actualizado_en: ahora })
      .eq('id', turno.id)
    setGuardando(false)
    if (errUpdate) { setError('No se pudo guardar: ' + errUpdate.message); return }
    await registrarLog(turno.id, sesion, seEstaCerrando ? 'cerrado_forzado_admin' : 'corregido_admin', payload)
    onGuardado()
  }

  return (
    <div className="card" style={{ background: 'var(--alert-warn-bg)' }}>
      <div className="field" style={{ maxWidth: 220, marginBottom: 12 }}>
        <label>Fecha</label>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} max={HOY_ISO()} />
      </div>
      <div className="row-inline" style={{ gap: 16, flexWrap: 'wrap' }}>
        <CampoHora label="Entrada" value={horaEntrada} onChange={setHoraEntrada} fecha={fecha} />
        <CampoHora label="Almuerzo (salida)" value={horaAlmuerzoInicio} onChange={setHoraAlmuerzoInicio} fecha={fecha} />
        <CampoHora label="Almuerzo (vuelta)" value={horaAlmuerzoFin} onChange={setHoraAlmuerzoFin} fecha={fecha} />
        <CampoHora label="Salida" value={horaSalida} onChange={setHoraSalida} fecha={fecha} />
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="row-inline" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        <button className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>Cancelar</button>
      </div>
    </div>
  )
}

// Crear un turno nuevo para backfill del libro físico -- mismo formulario
// de horas + un selector de trabajador (obligatorio, a diferencia de
// editar uno existente). `workerIdInicial`/`fechaInicial` (2026-08-29):
// al crear desde un día del calendario ya se sabe de qué trabajador y qué
// fecha se trata -- el selector de trabajador queda fijo (no editable) y
// la fecha viene precargada, en vez de pedirlos de nuevo.
function FormularioTurnoNuevo({ workers, sesion, workerIdInicial, fechaInicial, onCreado, onCancelar }) {
  const [workerId, setWorkerId] = useState(workerIdInicial || '')
  const [fecha, setFecha] = useState(fechaInicial || HOY_ISO())
  const [horaEntrada, setHoraEntrada] = useState('')
  const [horaAlmuerzoInicio, setHoraAlmuerzoInicio] = useState('')
  const [horaAlmuerzoFin, setHoraAlmuerzoFin] = useState('')
  const [horaSalida, setHoraSalida] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function guardar() {
    if (!workerId) { setError('Elegí el trabajador.'); return }
    if (!horaEntrada) { setError('Falta la hora de entrada.'); return }
    setError('')
    setGuardando(true)
    const worker = workers.find((w) => w.id === workerId)
    const { data, error: errInsert } = await supabase
      .from('turnos')
      .insert({
        worker_id: workerId,
        worker_nombre: worker?.nombre || '',
        fecha,
        hora_entrada: horaEntrada,
        hora_almuerzo_inicio: horaAlmuerzoInicio || null,
        hora_almuerzo_fin: horaAlmuerzoFin || null,
        hora_salida: horaSalida || null,
        estado: horaSalida ? 'cerrado' : 'abierto',
        marcado_por: 'admin',
        creado_por: sesion.nombre,
      })
      .select()
      .single()
    setGuardando(false)
    if (errInsert) { setError('No se pudo crear: ' + errInsert.message); return }
    await registrarLog(data.id, sesion, 'creado_admin', { fecha, hora_entrada: horaEntrada, hora_salida: horaSalida || null })
    onCreado()
  }

  return (
    <div className="card">
      <p className="hint" style={{ marginTop: 0 }}>Crear turno (backfill desde el libro físico)</p>
      <div className="row-inline" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="field" style={{ minWidth: 200 }}>
          <label>Trabajador</label>
          {workerIdInicial ? (
            <p style={{ margin: '6px 0 0' }}><strong>{workers.find((w) => w.id === workerIdInicial)?.nombre}</strong></p>
          ) : (
            <select value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
              <option value="">Elegir…</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.nombre}</option>)}
            </select>
          )}
        </div>
        <div className="field" style={{ maxWidth: 220 }}>
          <label>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} max={HOY_ISO()} disabled={!!fechaInicial} />
        </div>
      </div>
      <div className="row-inline" style={{ gap: 16, flexWrap: 'wrap' }}>
        <CampoHora label="Entrada" value={horaEntrada} onChange={setHoraEntrada} fecha={fecha} />
        <CampoHora label="Almuerzo (salida)" value={horaAlmuerzoInicio} onChange={setHoraAlmuerzoInicio} fecha={fecha} />
        <CampoHora label="Almuerzo (vuelta)" value={horaAlmuerzoFin} onChange={setHoraAlmuerzoFin} fecha={fecha} />
        <CampoHora label="Salida" value={horaSalida} onChange={setHoraSalida} fecha={fecha} />
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="row-inline" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Creando…' : 'Crear turno'}</button>
        <button className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>Cancelar</button>
      </div>
    </div>
  )
}

const DIAS_SEMANA_CORTO = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function inicioDeMes(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function sumarMeses(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1) }
function fechaISO(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Grid de 6 semanas (42 días) empezando en lunes, con los días del mes
// anterior/siguiente que completan la primera/última semana -- mismo
// layout que el calendario nativo de Windows.
function construirGrid(mes) {
  const primero = inicioDeMes(mes)
  const diaSemana = (primero.getDay() + 6) % 7 // lunes=0 ... domingo=6
  const inicio = new Date(primero)
  inicio.setDate(inicio.getDate() - diaSemana)
  const celdas = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(inicio)
    d.setDate(d.getDate() + i)
    celdas.push(d)
  }
  return celdas
}

// Vista de calendario de un trabajador (2026-08-29, pedido explícito del
// usuario): en vez de una lista, un mes con los días trabajados
// resaltados -- verde si el turno quedó cerrado, ámbar si sigue abierto.
// Tocar un día CON turno abre el mismo formulario de edición que la
// lista; tocar un día SIN turno crea uno nuevo directo para ese
// trabajador y esa fecha (sin tener que abrir el formulario genérico y
// volver a elegir a mano).
function CalendarioTurnos({ workerId, sesion, refrescarTick, onEditarTurno, onCrearTurno }) {
  const [mes, setMes] = useState(() => inicioDeMes(new Date()))
  const [turnos, setTurnos] = useState(null)

  const cargar = useCallback(async () => {
    setTurnos(null)
    const celdas = construirGrid(mes)
    const { data, error } = await supabase
      .from('turnos')
      .select('*')
      .eq('worker_id', workerId)
      .gte('fecha', fechaISO(celdas[0]))
      .lte('fecha', fechaISO(celdas[celdas.length - 1]))
    if (error) { setTurnos([]); return }
    setTurnos(data || [])
  }, [workerId, mes, refrescarTick])

  useEffect(() => { cargar() }, [cargar])

  const porFecha = new Map((turnos || []).map((t) => [t.fecha, t]))
  const celdas = construirGrid(mes)
  const hoyIso = fechaISO(new Date())

  return (
    <div>
      <div className="row-inline" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, maxWidth: 400 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setMes((m) => sumarMeses(m, -1))} aria-label="Mes anterior">‹</button>
        <strong style={{ textTransform: 'capitalize' }}>{MESES[mes.getMonth()]} de {mes.getFullYear()}</strong>
        <button className="btn btn-ghost btn-sm" onClick={() => setMes((m) => sumarMeses(m, 1))} aria-label="Mes siguiente">›</button>
      </div>

      {turnos === null ? (
        <p>Cargando…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, maxWidth: 400 }}>
            {DIAS_SEMANA_CORTO.map((d) => (
              <div key={d} style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-soft, #666)', padding: '2px 0' }}>{d}</div>
            ))}
            {celdas.map((d) => {
              const iso = fechaISO(d)
              const enMes = d.getMonth() === mes.getMonth()
              const turno = porFecha.get(iso)
              const esHoy = iso === hoyIso
              let fondo = 'transparent'
              if (turno) fondo = turno.estado === 'cerrado' ? '#c7ecd1' : '#fbe6b0'
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => (turno ? onEditarTurno(turno) : onCrearTurno(iso))}
                  title={turno ? (turno.estado === 'cerrado' ? 'Turno cerrado -- tocar para editar' : 'Turno abierto -- tocar para editar') : 'Sin turno -- tocar para crear uno'}
                  style={{
                    aspectRatio: '1', border: esHoy ? '2px solid #2c5f4a' : '1px solid #ddd',
                    borderRadius: 6, background: fondo, opacity: enMes ? 1 : 0.35,
                    cursor: 'pointer', fontSize: 13, padding: 0,
                  }}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>
          <div className="row-inline" style={{ gap: 16, marginTop: 12, fontSize: 13, flexWrap: 'wrap' }}>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#c7ecd1', borderRadius: 3, marginRight: 6, verticalAlign: 'middle' }} />Turno cerrado</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#fbe6b0', borderRadius: 3, marginRight: 6, verticalAlign: 'middle' }} />Turno abierto</span>
            <span className="hint" style={{ margin: 0 }}>Tocá cualquier día para editar o crear un turno.</span>
          </div>
        </>
      )}
    </div>
  )
}

function SeccionTurnos({ workers, sesion }) {
  const [filtroWorker, setFiltroWorker] = useState('')
  const [desde, setDesde] = useState(hace(13))
  const [hasta, setHasta] = useState(HOY_ISO())
  const [turnos, setTurnos] = useState(null)
  const [editando, setEditando] = useState(null) // turno completo (objeto), o null
  const [creando, setCreando] = useState(false) // "+ Crear turno" genérico (modo Todos)
  const [creandoParaFecha, setCreandoParaFecha] = useState(null) // fecha clickeada en el calendario (modo un trabajador)
  const [refrescarTick, setRefrescarTick] = useState(0)
  const [mensaje, setMensaje] = useState('')

  // Lista (modo "Todos") -- el calendario (modo un trabajador puntual)
  // trae sus propios datos, ver CalendarioTurnos.
  const cargarLista = useCallback(async () => {
    if (filtroWorker) return
    setTurnos(null)
    // turnos_comision embebido vía PostgREST -- la comisión ya no vive en
    // "turnos" (ver supabase_migration_turnos_comision_privada.sql), solo
    // admin puede leer esa tabla.
    const { data, error } = await supabase
      .from('turnos')
      .select('*, turnos_comision(bruto, neto, ganancia, comision_porcentaje, comision_monto, calculado_en)')
      .gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false })
    if (error) { setMensaje('No se pudo cargar: ' + error.message); setTurnos([]); return }
    setTurnos(data || [])
  }, [filtroWorker, desde, hasta])

  useEffect(() => { cargarLista() }, [cargarLista])

  function recargarTodo() {
    setEditando(null)
    setCreando(false)
    setCreandoParaFecha(null)
    setRefrescarTick((n) => n + 1)
    cargarLista()
  }

  const trabajadorSeleccionado = workers.find((w) => w.id === filtroWorker)

  return (
    <div className="card">
      <p className="hint" style={{ marginTop: 0 }}>Turnos</p>
      <div className="row-inline" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="field" style={{ minWidth: 180 }}>
          <label>Trabajador</label>
          <select value={filtroWorker} onChange={(e) => { setFiltroWorker(e.target.value); setEditando(null); setCreando(false); setCreandoParaFecha(null) }}>
            <option value="">Todos</option>
            {workers.map((w) => <option key={w.id} value={w.id}>{w.nombre}</option>)}
          </select>
        </div>
        {!filtroWorker && (
          <>
            <div className="field"><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
            <div className="field"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          </>
        )}
      </div>

      {mensaje && <p className="error-text">{mensaje}</p>}

      {editando && (
        <div style={{ marginBottom: 16 }}>
          <FormularioTurno turno={editando} sesion={sesion} onGuardado={recargarTodo} onCancelar={() => setEditando(null)} />
        </div>
      )}

      {creandoParaFecha && (
        <div style={{ marginBottom: 16 }}>
          <FormularioTurnoNuevo
            workers={workers}
            sesion={sesion}
            workerIdInicial={filtroWorker}
            fechaInicial={creandoParaFecha}
            onCreado={recargarTodo}
            onCancelar={() => setCreandoParaFecha(null)}
          />
        </div>
      )}

      {filtroWorker ? (
        // Modo "un trabajador" -- calendario mensual con los días
        // trabajados resaltados (pedido explícito del usuario), en vez de
        // una lista. Tocar un día crea o edita directo.
        !editando && !creandoParaFecha && (
          <CalendarioTurnos
            workerId={filtroWorker}
            sesion={sesion}
            refrescarTick={refrescarTick}
            onEditarTurno={(t) => setEditando(t)}
            onCrearTurno={(fecha) => setCreandoParaFecha(fecha)}
          />
        )
      ) : (
        // Modo "Todos" -- la lista de siempre, por rango de fechas.
        <>
          <button className="btn btn-secondary" style={{ marginBottom: 16 }} onClick={() => setCreando((v) => !v)}>
            {creando ? 'Cancelar creación' : '+ Crear turno'}
          </button>

          {creando && (
            <div style={{ marginBottom: 16 }}>
              <FormularioTurnoNuevo workers={workers} sesion={sesion} onCreado={recargarTodo} onCancelar={() => setCreando(false)} />
            </div>
          )}

          {turnos === null && <p>Cargando…</p>}
          {turnos !== null && turnos.length === 0 && <p className="hint">No hay turnos en este rango.</p>}

          {turnos !== null && turnos.map((t) => {
            const comision = Array.isArray(t.turnos_comision) ? t.turnos_comision[0] : t.turnos_comision
            return (
              <div key={t.id} style={{ marginBottom: 12 }}>
                {editando?.id === t.id ? null : (
                  <div className="card" style={{ marginBottom: 0 }}>
                    <div className="row-inline" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <strong>{t.worker_nombre}</strong> — {t.fecha}
                        <p className="hint" style={{ margin: 0 }}>
                          Entrada {formatoHora(t.hora_entrada)} · Almuerzo {formatoHora(t.hora_almuerzo_inicio)}–{formatoHora(t.hora_almuerzo_fin)} · Salida {formatoHora(t.hora_salida)}
                          {' · '}
                          {t.estado === 'abierto' ? <span className="status-pill warn" style={{ display: 'inline-flex' }}>Abierto</span> : <span className="status-pill ok" style={{ display: 'inline-flex' }}>Cerrado</span>}
                          {t.corregido && ' · corregido'}
                        </p>
                        {comision?.calculado_en && (
                          <p className="hint" style={{ margin: '4px 0 0' }}>
                            Bruto {formatoMonto(comision.bruto)} · Neto {formatoMonto(comision.neto)} · Ganancia {formatoMonto(comision.ganancia)} · Comisión ({comision.comision_porcentaje}%) {formatoMonto(comision.comision_monto)}
                          </p>
                        )}
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditando(t)}>Editar</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

function SeccionComisiones({ workers, sesion }) {
  const [config, setConfig] = useState(null) // Map worker_id -> última fila
  const [editandoWorker, setEditandoWorker] = useState(null)
  const [nuevoPct, setNuevoPct] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState('')

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('comisiones_config').select('*').order('vigente_desde', { ascending: false })
    if (error) { setMensaje('No se pudo cargar: ' + error.message); return }
    const porWorker = new Map()
    for (const c of data || []) {
      if (!porWorker.has(c.worker_id)) porWorker.set(c.worker_id, c)
    }
    setConfig(porWorker)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function guardar(workerId) {
    const pct = Number(nuevoPct)
    if (Number.isNaN(pct) || pct < 0 || pct > 100) { setMensaje('El % tiene que estar entre 0 y 100.'); return }
    setGuardando(true)
    const { error } = await supabase.from('comisiones_config').insert({ worker_id: workerId, porcentaje: pct, creado_por: sesion.nombre })
    setGuardando(false)
    if (error) { setMensaje('No se pudo guardar: ' + error.message); return }
    setEditandoWorker(null)
    setNuevoPct('')
    cargar()
  }

  return (
    <div className="card">
      <p className="hint" style={{ marginTop: 0 }}>Comisión por trabajador</p>
      <p className="hint">
        Cambiar el % acá agrega una fila nueva (nunca pisa la anterior) — un turno ya calculado conserva el % con el que se calculó; solo un turno nuevo usa el % actualizado.
      </p>
      {mensaje && <p className="error-text">{mensaje}</p>}
      {config === null && <p>Cargando…</p>}
      {config !== null && (
        <div className="tabla-scroll">
          <table className="table-preview">
            <thead><tr><th>Trabajador</th><th>% vigente</th><th>Desde</th><th></th></tr></thead>
            <tbody>
              {workers.map((w) => {
                const actual = config.get(w.id)
                return (
                  <tr key={w.id}>
                    <td>{w.nombre}</td>
                    <td>{actual ? `${actual.porcentaje}%` : 'Sin definir'}</td>
                    <td>{actual ? new Date(actual.vigente_desde).toLocaleDateString('es-CL') : '—'}</td>
                    <td>
                      {editandoWorker === w.id ? (
                        <div className="row-inline" style={{ gap: 6 }}>
                          <input type="number" min="0" max="100" step="0.1" style={{ width: 80 }} value={nuevoPct} onChange={(e) => setNuevoPct(e.target.value)} />
                          <button className="btn btn-primary btn-sm" onClick={() => guardar(w.id)} disabled={guardando}>Guardar</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditandoWorker(null)} disabled={guardando}>Cancelar</button>
                        </div>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => { setEditandoWorker(w.id); setNuevoPct(actual ? String(actual.porcentaje) : '') }}>Editar</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SeccionCalcular({ workers, sesion }) {
  const [workerId, setWorkerId] = useState('')
  const [desde, setDesde] = useState(hace(13))
  const [hasta, setHasta] = useState(HOY_ISO())
  const [calculando, setCalculando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [mensajeEsError, setMensajeEsError] = useState(false)
  const [resultado, setResultado] = useState(null)

  async function calcular() {
    setCalculando(true)
    setMensaje('')
    setResultado(null)
    const { data: solicitud, error } = await supabase
      .from('turnos_solicitudes')
      .insert({ worker_id: workerId || null, desde, hasta, solicitado_por: sesion.nombre })
      .select()
      .single()
    if (error) {
      setMensaje('No se pudo pedir el cálculo: ' + error.message)
      setMensajeEsError(true)
      setCalculando(false)
      return
    }

    let resuelto = false
    const terminar = (row) => {
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
        setResultado(row?.resultado || null)
      }
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
    }, TIMEOUT_CALCULO_MS)
  }

  return (
    <div className="card">
      <p className="hint" style={{ marginTop: 0 }}>Calcular ventas y comisión</p>
      <p className="hint">Solo suma turnos ya cerrados dentro del rango — un turno todavía abierto no tiene una ventana completa para calcular.</p>
      <div className="row-inline" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="field" style={{ minWidth: 180 }}>
          <label>Trabajador</label>
          <select value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
            <option value="">Todos</option>
            {workers.map((w) => <option key={w.id} value={w.id}>{w.nombre}</option>)}
          </select>
        </div>
        <div className="field"><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="field"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
      </div>
      <button className="btn btn-primary" onClick={calcular} disabled={calculando}>{calculando ? 'Calculando…' : 'Calcular'}</button>
      {calculando && <p className="hint">Puede tardar hasta un par de minutos — podés esperar acá.</p>}
      {mensaje && <p className={mensajeEsError ? 'error-text' : 'hint'}>{mensaje}</p>}

      {resultado && (
        <div className="tabla-scroll" style={{ marginTop: 12 }}>
          <p className="hint" style={{ marginTop: 0 }}>
            Total bruto {formatoMonto(resultado.totalBruto)} · Total neto {formatoMonto(resultado.totalNeto)} · Total ganancia {formatoMonto(resultado.totalGanancia)} · Total comisión {formatoMonto(resultado.totalComision)}
          </p>
        </div>
      )}
    </div>
  )
}

export default function TurnosAdminPage() {
  const [autorizado, setAutorizado] = useState(null) // null = verificando
  const [sesion, setSesion] = useState(null)
  const [workers, setWorkers] = useState([])

  // Doble gate, mismo criterio que pages/AdminPage.jsx y src/reportes/main.js:
  // sesion.rol es solo cosmético (para mostrar/ocultar el link en el
  // portal) -- el gate real de una pantalla admin-only vuelve a chequear
  // el email de auth directo, no la columna perfiles.rol.
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user?.email === ADMIN_EMAIL) {
        const { data: perfil } = await supabase.from('perfiles').select('nombre, rol').eq('id', session.user.id).maybeSingle()
        setSesion({ id: session.user.id, nombre: perfil?.nombre || 'Admin', rol: 'admin' })
        setAutorizado(true)
      } else {
        setAutorizado(false)
      }
    })
  }, [])

  useEffect(() => {
    if (!autorizado) return
    supabase.from('perfiles').select('id, nombre, rol').order('nombre').then(({ data }) => setWorkers(data || []))
  }, [autorizado])

  if (autorizado === null) return null

  if (!autorizado) {
    return (
      <div className="page">
        <div className="card"><p className="error-text">No tenés acceso a esta pantalla.</p></div>
        <a className="btn btn-ghost" href="/">Volver al inicio</a>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Turnos — admin</div>
          <h1>Panel de turnos y comisiones</h1>
        </div>
        <div className="row-inline" style={{ gap: 8 }}>
          <a className="btn btn-ghost" href="/turnos/historial">Historial</a>
          <a className="btn btn-ghost" href="/">Inicio</a>
        </div>
      </div>

      <SeccionTurnos workers={workers} sesion={sesion} />
      <SeccionComisiones workers={workers} sesion={sesion} />
      <SeccionCalcular workers={workers} sesion={sesion} />
    </div>
  )
}
