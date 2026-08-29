import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient.js'

const DIAS_SEMANA_CORTO = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// Jornada máxima semanal vigente en Chile (Ley 21.561, 26-04-2026) -- si
// el total de una semana la supera, se resalta en vez de en verde neutro.
// Es solo un aviso visual, no bloquea nada.
const JORNADA_MAXIMA_SEMANAL = 42

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

function enSemanas(celdas) {
  const semanas = []
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7))
  return semanas
}

// Horas de trabajo EFECTIVO de un turno cerrado: horas totales
// (entrada->salida) menos la colación, si se marcó las dos puntas. Un
// turno todavía abierto no tiene una jornada completa que contar todavía
// -- devuelve null a propósito (se muestra en blanco, no en cero, para no
// confundir "no trabajó" con "todavía no cerró el turno").
function horasEfectivas(turno) {
  if (!turno || turno.estado !== 'cerrado' || !turno.hora_entrada || !turno.hora_salida) return null
  const entrada = new Date(turno.hora_entrada)
  const salida = new Date(turno.hora_salida)
  let ms = salida - entrada
  if (turno.hora_almuerzo_inicio && turno.hora_almuerzo_fin) {
    const almInicio = new Date(turno.hora_almuerzo_inicio)
    const almFin = new Date(turno.hora_almuerzo_fin)
    if (almFin > almInicio) ms -= (almFin - almInicio)
  }
  return Math.max(0, ms / 3600000) // horas en decimal
}

function formatoHoras(horas) {
  if (horas == null) return null
  const h = Math.floor(horas)
  const m = Math.round((horas - h) * 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// Vista de calendario de los turnos de un trabajador (2026-08-29, pedido
// explícito del usuario) -- compartida entre el panel admin
// (`/turnos/admin`, con horas por día + total semanal, ver más abajo) y
// la pantalla del propio trabajador (`/turnos`, sin esos datos --
// "esta info solo visible por la vista de admin, el trabajador no").
//
// `mostrarHoras` (admin-only): agrega debajo del número de cada día
// cerrado las horas de trabajo EFECTIVO (horas totales menos colación), y
// una columna extra a la derecha de cada semana con el total -- pensado
// para llevar la cuenta de la jornada semanal y cumplir con la
// legislación vigente (jornada máxima actual: 42 h/semana, Ley 21.561).
// `permiteCrear` (admin-only): tocar un día SIN turno crea uno nuevo --
// el trabajador no puede crear turnos desde acá, solo corregir los que ya
// marcó (mismo criterio que el resto de Turnos: el trabajador no
// "fabrica" asistencia, solo corrige errores de tipeo).
export default function CalendarioTurnos({ workerId, refrescarTick, mostrarHoras = false, permiteCrear = false, onEditarTurno, onCrearTurno }) {
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

  if (turnos === null) return <p>Cargando…</p>

  const porFecha = new Map(turnos.map((t) => [t.fecha, t]))
  const semanas = enSemanas(construirGrid(mes))
  const hoyIso = fechaISO(new Date())
  const columnas = mostrarHoras ? 'repeat(7, 1fr) 76px' : 'repeat(7, 1fr)'

  return (
    <div>
      <div className="row-inline" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, maxWidth: mostrarHoras ? 560 : 400 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setMes((m) => sumarMeses(m, -1))} aria-label="Mes anterior">‹</button>
        <strong style={{ textTransform: 'capitalize' }}>{MESES[mes.getMonth()]} de {mes.getFullYear()}</strong>
        <button className="btn btn-ghost btn-sm" onClick={() => setMes((m) => sumarMeses(m, 1))} aria-label="Mes siguiente">›</button>
      </div>

      <div style={{ maxWidth: mostrarHoras ? 560 : 400 }}>
        <div style={{ display: 'grid', gridTemplateColumns: columnas, gap: 4, marginBottom: 4 }}>
          {DIAS_SEMANA_CORTO.map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', padding: '2px 0' }}>{d}</div>
          ))}
          {mostrarHoras && <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>Semana</div>}
        </div>

        {semanas.map((semana, i) => {
          const totalSemana = mostrarHoras
            ? semana.reduce((acc, d) => acc + (horasEfectivas(porFecha.get(fechaISO(d))) || 0), 0)
            : 0
          const excedeJornada = totalSemana > JORNADA_MAXIMA_SEMANAL

          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: columnas, gap: 4, marginBottom: 4 }}>
              {semana.map((d) => {
                const iso = fechaISO(d)
                const enMes = d.getMonth() === mes.getMonth()
                const turno = porFecha.get(iso)
                const esHoy = iso === hoyIso
                const horas = mostrarHoras ? horasEfectivas(turno) : null
                let fondo = 'transparent'
                if (turno) fondo = turno.estado === 'cerrado' ? '#c7ecd1' : '#fbe6b0'
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => {
                      if (turno) onEditarTurno(turno)
                      else if (permiteCrear) onCrearTurno(iso)
                    }}
                    disabled={!turno && !permiteCrear}
                    title={turno ? (turno.estado === 'cerrado' ? 'Turno cerrado -- tocar para editar' : 'Turno abierto -- tocar para editar') : (permiteCrear ? 'Sin turno -- tocar para crear uno' : 'Sin turno')}
                    style={{
                      aspectRatio: '1', border: esHoy ? '2px solid #2c5f4a' : '1px solid #ddd',
                      borderRadius: 6, background: fondo, opacity: enMes ? 1 : 0.35,
                      cursor: (turno || permiteCrear) ? 'pointer' : 'default', fontSize: 13, padding: 2,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                    }}
                  >
                    <span>{d.getDate()}</span>
                    {horas != null && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{formatoHoras(horas)}</span>}
                  </button>
                )
              })}
              {mostrarHoras && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 12, fontWeight: 700,
                  border: '1px dashed var(--border)', borderRadius: 6,
                  color: excedeJornada ? 'var(--alert-warn)' : 'var(--text-main)',
                  background: excedeJornada ? 'var(--alert-warn-bg)' : 'transparent',
                }}>
                  {totalSemana > 0 ? formatoHoras(totalSemana) : '—'}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="row-inline" style={{ gap: 16, marginTop: 12, fontSize: 13, flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#c7ecd1', borderRadius: 3, marginRight: 6, verticalAlign: 'middle' }} />Turno cerrado</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#fbe6b0', borderRadius: 3, marginRight: 6, verticalAlign: 'middle' }} />Turno abierto</span>
        {mostrarHoras && <span>Total semana en <span style={{ color: 'var(--alert-warn)', fontWeight: 700 }}>naranja</span> si supera las {JORNADA_MAXIMA_SEMANAL}h legales.</span>}
        <span className="hint" style={{ margin: 0 }}>{permiteCrear ? 'Tocá cualquier día para editar o crear un turno.' : 'Tocá un día con turno para corregirlo.'}</span>
      </div>
    </div>
  )
}
