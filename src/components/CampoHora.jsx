import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

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
// turnos rápido de memoria sin perder el selector. `value`/onChange
// trabajan con una fecha ISO completa (igual que hora_entrada/hora_salida
// en Supabase, timestamptz) -- `fecha` (YYYY-MM-DD) fija el día sobre el
// que se aplica la hora elegida.
//
// Avance automático (2026-08-29, pedido explícito del usuario): al
// completar los 4 dígitos del atajo de texto, `onCompleto(hh, mm)` avisa
// al formulario que lo contiene -- el formulario decide a qué campo
// saltar el foco (acá no sabe nada del orden de campos, ni de que "0000"
// en el almuerzo significa "sin almuerzo", eso es lógica de cada
// formulario, ver FormularioTurno/FormularioTurnoNuevo/EdicionHoras).
// Solo se dispara en la TRANSICIÓN de incompleto a completo (comparando
// contra la cantidad de dígitos anterior) -- si no, seguiría disparando
// en cada tecla de más mientras el campo ya está lleno (el formateo
// ignora dígitos extra, así que sin este resguardo el foco saltaría de
// nuevo cada vez que alguien vuelve a un campo ya completo y sigue
// tipeando por error). El selector nativo (arriba) a propósito NO dispara
// onCompleto -- ajustar hora y minuto ahí puede disparar varios `change`
// seguidos según el navegador, saltar de foco en el medio sería confuso.
const CampoHora = forwardRef(function CampoHora({ label, value, onChange, fecha, onCompleto }, ref) {
  const [texto, setTexto] = useState(() => isoAHoraTexto(value))
  const inputTextoRef = useRef(null)
  const digitosAnterioresRef = useRef(texto.replace(/\D/g, '').length)

  useImperativeHandle(ref, () => ({
    focus: () => inputTextoRef.current?.focus(),
    // Fuerza el atajo de texto a quedar vacío en pantalla (2026-08-29,
    // ver useAvanceHoras.js -- caso "0000" en almuerzo). El efecto que
    // sincroniza `texto` desde `value` no alcanza a dispararse acá: `value`
    // pasa de '' a un ISO real y de vuelta a '' dentro del mismo tick
    // (primero el onChange normal, después el reseteo del formulario por
    // el caso especial), React lo agrupa en un solo render y `value`
    // termina siendo igual al de antes -- sin cambio neto, el effect no
    // vuelve a correr, y el texto tipeado ("00:00") se queda pegado en
    // pantalla aunque el valor real ya esté vacío.
    limpiar: () => { setTexto(''); digitosAnterioresRef.current = 0 },
  }))

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
    const digitos = formateado.replace(/\D/g, '')
    const hora = textoAHora(formateado)
    if (hora) {
      combinarYEmitir(hora.hh, hora.mm)
      if (digitosAnterioresRef.current < 4 && digitos.length === 4) onCompleto?.(hora.hh, hora.mm)
    }
    digitosAnterioresRef.current = digitos.length
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
        ref={inputTextoRef}
        type="text" inputMode="numeric" placeholder="o escribí: 1430" value={texto} onChange={alTipear} disabled={!fecha}
        className={`campo-atajo${textoIncompleto ? ' campo-atajo-error' : ''}`}
      />
      {textoIncompleto && <p className="hint" style={{ color: 'var(--alert-error)', margin: '4px 0 0' }}>Formato: HHMM o HH:MM (24 hs)</p>}
    </div>
  )
})

export default CampoHora
