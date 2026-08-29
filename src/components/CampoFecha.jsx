import { useEffect, useState } from 'react'

function isoATexto(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// Autoformateo mientras se tipea (2026-08-23, pedido explícito del
// usuario): escribir solo los números seguidos ("010526") va insertando las
// barras solo -- "01" -> "01/0" -> "01/05" -> "01/05/2" -> "01/05/26".
// También acepta que la persona tipee las barras a mano ("12/06/2026"), da
// igual: se descartan y se reconstruyen siempre desde los dígitos crudos.
export function formatearMientrasTipea(valorCrudo) {
  const digitos = valorCrudo.replace(/\D/g, '').slice(0, 8)
  let out = digitos.slice(0, 2)
  if (digitos.length > 2) out += '/' + digitos.slice(2, 4)
  if (digitos.length > 4) out += '/' + digitos.slice(4)
  return out
}

// Año de 2 dígitos ("26") se expande a 2026 -- 6 dígitos en total
// (DDMMAA). Con 8 dígitos (DDMMAAAA) se usa el año literal, para quien
// prefiere escribirlo completo. Devuelve ISO (YYYY-MM-DD) o null si
// todavía no está completa o no es una fecha válida (ej. 31/04).
export function textoAIso(texto) {
  const digitos = texto.replace(/\D/g, '')
  let dd, mm, yyyy
  if (digitos.length === 6) {
    dd = +digitos.slice(0, 2); mm = +digitos.slice(2, 4); yyyy = 2000 + +digitos.slice(4, 6)
  } else if (digitos.length === 8) {
    dd = +digitos.slice(0, 2); mm = +digitos.slice(2, 4); yyyy = +digitos.slice(4, 8)
  } else {
    return null
  }
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null
  const fecha = new Date(yyyy, mm - 1, dd)
  if (fecha.getFullYear() !== yyyy || fecha.getMonth() !== mm - 1 || fecha.getDate() !== dd) return null // ej. 31/04
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

// Fecha con dos formas de cargarla en paralelo, siempre sincronizadas (2026-08-23,
// pedido explícito del usuario): el selector de calendario de siempre para
// elegir con clicks, y al lado un campo de texto para escribir directo
// "010526" (día, mes, año corto, sin tipear las barras) -- más rápido para
// quien ya sabe el dato de memoria. El valor de verdad sigue siendo el ISO
// que espera <input type="date">; el campo de texto solo se traduce
// hacia/desde ese valor.
//
// Extraído de pages/vencimientos/CargarPage.jsx (2026-08-29) para
// reusarlo también en Turnos -- comportamiento idéntico, sin cambios.
export default function CampoFecha({ label, value, onChange, max }) {
  const [texto, setTexto] = useState(() => isoATexto(value))

  useEffect(() => { setTexto(isoATexto(value)) }, [value])

  function alTipear(e) {
    const formateado = formatearMientrasTipea(e.target.value)
    setTexto(formateado)
    const iso = textoAIso(formateado)
    if (iso && (!max || iso <= max)) onChange(iso)
  }

  const textoIncompleto = texto.replace(/\D/g, '').length >= 6 && !textoAIso(texto)

  return (
    <div className="field">
      <label>{label}</label>
      <div className="row-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input type="date" max={max} value={value} onChange={(e) => onChange(e.target.value)} />
        <input type="text" inputMode="numeric" placeholder="DDMMAA" value={texto} onChange={alTipear} style={{ width: 110 }} />
      </div>
      {textoIncompleto && <p className="hint" style={{ color: 'var(--alert-error)', margin: '4px 0 0' }}>Formato: DDMMAA o DD/MM/AAAA</p>}
    </div>
  )
}
