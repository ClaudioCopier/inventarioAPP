import { useEffect, useState } from 'react'

function isoAHoraTexto(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

// Mismo espíritu que formatearMientrasTipea() de CampoFecha.jsx, pero para
// HH:MM: escribir "1430" seguido va mostrando "14" -> "14:3" -> "14:30".
function formatearHoraMientrasTipea(valorCrudo) {
  const digitos = valorCrudo.replace(/\D/g, '').slice(0, 4)
  let out = digitos.slice(0, 2)
  if (digitos.length > 2) out += ':' + digitos.slice(2)
  return out
}

function textoAHora(texto) {
  const digitos = texto.replace(/\D/g, '')
  if (digitos.length !== 4) return null
  const hh = +digitos.slice(0, 2)
  const mm = +digitos.slice(2, 4)
  if (hh > 23 || mm > 59) return null
  return { hh, mm }
}

// Campo de hora del día -- selector nativo arriba (control principal) +
// atajo de texto libre abajo (acción secundaria, discreta) con
// autoformato mientras se tipea ("1430" -> "14:30"), pensado para cargar
// turnos rápido de memoria sin perder el selector. Reordenado 2026-08-29
// (antes iban lado a lado, con estilos de navegador distintos entre sí --
// pedido explícito del usuario: "más lineal", selector arriba, texto
// abajo, para que se vea como un solo campo prolijo). `value`/onChange
// trabajan con una fecha ISO completa (igual que hora_entrada/hora_salida
// en Supabase, timestamptz) -- `fecha` (YYYY-MM-DD) fija el día sobre el
// que se aplica la hora elegida.
export default function CampoHora({ label, value, onChange, fecha }) {
  const [texto, setTexto] = useState(() => isoAHoraTexto(value))

  useEffect(() => { setTexto(isoAHoraTexto(value)) }, [value])

  function combinarYEmitir(hh, mm) {
    if (!fecha) return
    const [y, m, d] = fecha.split('-').map(Number)
    const fechaHora = new Date(y, m - 1, d, hh, mm, 0, 0)
    onChange(fechaHora.toISOString())
  }

  function alTipear(e) {
    const formateado = formatearHoraMientrasTipea(e.target.value)
    setTexto(formateado)
    const hora = textoAHora(formateado)
    if (hora) combinarYEmitir(hora.hh, hora.mm)
  }

  function alElegirSelector(e) {
    const [hh, mm] = e.target.value.split(':').map(Number)
    if (!Number.isNaN(hh) && !Number.isNaN(mm)) combinarYEmitir(hh, mm)
  }

  const textoIncompleto = texto.replace(/\D/g, '').length === 4 && !textoAHora(texto)

  return (
    <div className="field campo-compuesto">
      <label>{label}</label>
      <input type="time" value={isoAHoraTexto(value)} onChange={alElegirSelector} disabled={!fecha} />
      <input
        type="text" inputMode="numeric" placeholder="o escribí: 1430" value={texto} onChange={alTipear} disabled={!fecha}
        className={`campo-atajo${textoIncompleto ? ' campo-atajo-error' : ''}`}
      />
      {textoIncompleto && <p className="hint" style={{ color: 'var(--alert-error)', margin: '4px 0 0' }}>Formato: HHMM o HH:MM (24 hs)</p>}
    </div>
  )
}
