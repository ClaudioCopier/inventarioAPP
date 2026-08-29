import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient.js'

const TIMEOUT_MS = 60000 // una sola consulta liviana, no una republicación de catálogo

const COLOR_VENTA = '#1D6343' // --brand-card
const COLOR_TICKETS = '#5B7A99' // segundo acento, solo para este gráfico -- no reusa ningún color de alerta (esos están reservados)

function formatoMonto(n) {
  return Number(n).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

function etiquetaHora(h) {
  return `${String(h).padStart(2, '0')}:00`
}

// Path de una barra con esquinas superiores redondeadas y base cuadrada
// (mark spec del skill de dataviz: "4px rounded data-end, square at the
// baseline"). SVG `rx` redondea las 4 esquinas por igual -- para "solo
// arriba" hace falta un path a mano.
function pathBarra(x, y, w, h, r) {
  const radio = Math.min(r, w / 2, h)
  if (h <= 0) return ''
  if (radio <= 0) return `M${x},${y} h${w} v${h} h${-w} Z`
  return `M${x},${y + radio} Q${x},${y} ${x + radio},${y} L${x + w - radio},${y} Q${x + w},${y} ${x + w},${y + radio} L${x + w},${y + h} L${x},${y + h} Z`
}

// Un mini bar-chart de una sola serie (small multiple) -- dos instancias
// comparten el mismo eje de horas y un tooltip sincronizado, en vez de un
// gráfico combinado de doble eje (venta $ y tickets # tienen escalas muy
// distintas -- el skill de dataviz es explícito: "Never a dual-axis
// chart... two measures of different scale -> two charts").
export function MiniBarChart({ titulo, datos, valorDe, color, formatoValor, hoverHora, onHover }) {
  const ancho = 560
  const alto = 130
  const margenIzq = 46
  const margenDer = 8
  const margenSup = 22
  const margenInf = 22
  const anchoBarras = ancho - margenIzq - margenDer
  const altoBarras = alto - margenSup - margenInf
  const maxValor = Math.max(1, ...datos.map(valorDe))
  const bandas = datos.length
  const bandaAncho = anchoBarras / bandas
  const barraAncho = Math.min(24, bandaAncho * 0.6)

  const iPico = datos.reduce((mejor, d, i) => (valorDe(d) > valorDe(datos[mejor]) ? i : mejor), 0)

  return (
    <div style={{ marginBottom: 12 }}>
      <p className="hint" style={{ margin: '0 0 4px', fontWeight: 600, color: 'var(--text-main)' }}>{titulo}</p>
      <svg viewBox={`0 0 ${ancho} ${alto}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={titulo}>
        {/* Línea base -- hairline recesivo, nunca protagonista */}
        <line x1={margenIzq} y1={alto - margenInf} x2={ancho - margenDer} y2={alto - margenInf} stroke="var(--border)" strokeWidth="1" />
        {/* Tick del máximo, para dar escala sin saturar de grillas */}
        <text x={margenIzq - 6} y={margenSup + 4} textAnchor="end" fontSize="9" fill="var(--text-muted)">{formatoValor(maxValor)}</text>
        <text x={margenIzq - 6} y={alto - margenInf} textAnchor="end" fontSize="9" fill="var(--text-muted)">0</text>

        {datos.map((d, i) => {
          const valor = valorDe(d)
          const h = maxValor > 0 ? (valor / maxValor) * altoBarras : 0
          const x = margenIzq + i * bandaAncho + (bandaAncho - barraAncho) / 2
          const y = alto - margenInf - h
          const esPico = i === iPico && valor > 0
          const estaHover = hoverHora === d.hora
          return (
            <g key={d.hora}>
              <path d={pathBarra(x, y, barraAncho, h, 4)} fill={color} opacity={estaHover ? 1 : 0.85} />
              {esPico && (
                <text x={x + barraAncho / 2} y={y - 4} textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--text-main)">
                  {formatoValor(valor)}
                </text>
              )}
              <text x={x + barraAncho / 2} y={alto - margenInf + 11} textAnchor="middle" fontSize="8" fill="var(--text-muted)">
                {etiquetaHora(d.hora)}
              </text>
              {/* Hit target más grande que la barra, toda la banda -- mark
                  spec de interacción. Va AL FINAL (arriba en el z-order del
                  grupo) a propósito: si quedara debajo del path de la
                  barra, pasar el mouse justo sobre la barra le daría el
                  evento al path (que no tiene handlers) en vez de a este
                  rect -- bug real encontrado probando el gráfico antes de
                  deployar. */}
              <rect
                data-hora={d.hora}
                x={margenIzq + i * bandaAncho} y={margenSup} width={bandaAncho} height={altoBarras}
                fill="transparent" onMouseEnter={() => onHover(d.hora)} onMouseLeave={() => onHover(null)}
                style={{ cursor: 'pointer' }}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// Gráfico de ventas por hora, mostrado al editar un turno cerrado
// (2026-08-29, pedido explícito del usuario): "un gráfico... que me
// muestre didácticamente qué horas de ese día fue donde más se vendió,
// tanto en tickets como en venta total, para sacar estadísticas de los
// horarios pico de cada día y mejores momentos del vendedor". Pide el
// cálculo apenas se monta (turno ya cerrado, siempre hay una ventana
// completa que mostrar) -- mismo patrón insert+poll+timeout que el resto
// de Turnos, pero corto (60s, una sola consulta liviana).
export default function GraficoVentasPorHora({ turno, sesion }) {
  const [estado, setEstado] = useState('cargando') // cargando | listo | error
  const [horas, setHoras] = useState([])
  const [mensaje, setMensaje] = useState('')
  const [hoverHora, setHoverHora] = useState(null)

  const pedir = useCallback(async () => {
    setEstado('cargando')
    setMensaje('')
    const { data: solicitud, error } = await supabase
      .from('turnos_ventas_hora_solicitudes')
      .insert({ desde: turno.hora_entrada, hasta: turno.hora_salida, solicitado_por: sesion?.nombre })
      .select()
      .single()
    if (error) { setEstado('error'); setMensaje('No se pudo pedir el gráfico: ' + error.message); return }

    let resuelto = false
    const terminar = (row) => {
      if (resuelto) return
      resuelto = true
      supabase.removeChannel(canal)
      clearTimeout(timeoutId)
      if (row?.status === 'error') {
        setEstado('error')
        setMensaje('No se pudo calcular: ' + (row.mensaje || 'error desconocido'))
      } else {
        setHoras(row?.resultado?.horas || [])
        setEstado('listo')
      }
    }

    const canal = supabase
      .channel(`turnos-ventas-hora-solicitud-${solicitud.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'turnos_ventas_hora_solicitudes', filter: `id=eq.${solicitud.id}` },
        (payload) => {
          if (payload.new?.status === 'done' || payload.new?.status === 'error') terminar(payload.new)
        }
      )
      .subscribe()

    const timeoutId = setTimeout(() => {
      if (resuelto) return
      resuelto = true
      supabase.removeChannel(canal)
      setEstado('error')
      setMensaje('Está tardando más de lo normal -- probá de nuevo en un momento.')
    }, TIMEOUT_MS)
  }, [turno.hora_entrada, turno.hora_salida, sesion])

  useEffect(() => { pedir() }, [pedir])

  const filaHover = horas.find((h) => h.hora === hoverHora)

  return (
    <div className="card" style={{ background: 'var(--bg-app)' }}>
      <p className="hint" style={{ marginTop: 0 }}>Ventas por hora de este turno</p>
      <p className="hint" style={{ fontSize: 12 }}>
        Para ir viendo con el tiempo los horarios pico de cada día y los mejores momentos de cada vendedor.
      </p>

      {estado === 'cargando' && <p className="hint">Calculando…</p>}
      {estado === 'error' && (
        <>
          <p className="error-text">{mensaje}</p>
          <button className="btn btn-ghost btn-sm" onClick={pedir}>Reintentar</button>
        </>
      )}

      {estado === 'listo' && horas.length === 0 && <p className="hint">Sin ventas registradas en este turno.</p>}

      {estado === 'listo' && horas.length > 0 && (
        <>
          <MiniBarChart
            titulo="Venta total por hora"
            datos={horas}
            valorDe={(d) => d.total}
            color={COLOR_VENTA}
            formatoValor={formatoMonto}
            hoverHora={hoverHora}
            onHover={setHoverHora}
          />
          <MiniBarChart
            titulo="Tickets por hora"
            datos={horas}
            valorDe={(d) => d.tickets}
            color={COLOR_TICKETS}
            formatoValor={(n) => String(Math.round(n))}
            hoverHora={hoverHora}
            onHover={setHoverHora}
          />
          {filaHover && (
            <p className="hint" style={{ margin: '4px 0 0', fontWeight: 600, color: 'var(--text-main)' }}>
              {etiquetaHora(filaHover.hora)} – {String(filaHover.hora + 1).padStart(2, '0')}:00 · {formatoMonto(filaHover.total)} · {filaHover.tickets} ticket(s)
            </p>
          )}
        </>
      )}
    </div>
  )
}
