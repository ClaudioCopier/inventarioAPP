import { useRef } from 'react'

// Avance automático de foco entre los 4 campos de hora de un turno
// (2026-08-29, pedido explícito del usuario: "al terminar de anotar una
// hora se pase directo a la otra"). Compartido entre FormularioTurno,
// FormularioTurnoNuevo (AdminPage.jsx) y EdicionHoras (MarcarPage.jsx) --
// mismo comportamiento en los 3:
//
// Entrada completa -> foco a Almuerzo (salida).
// Almuerzo (salida) completo con "0000" -> se interpreta como "no tuvo
//   almuerzo": limpia las dos horas de almuerzo (no queda "00:00"
//   guardado, queda vacío) y salta directo a Salida, saltándose
//   Almuerzo (vuelta).
// Almuerzo (salida) completo con cualquier otra hora -> foco a
//   Almuerzo (vuelta).
// Almuerzo (vuelta) completo -> foco a Salida.
// Salida completa -> foco al botón Guardar (el turno ya está completo).
export function useAvanceHoras({ setHoraAlmuerzoInicio, setHoraAlmuerzoFin }) {
  const refEntrada = useRef(null)
  const refAlmuerzoInicio = useRef(null)
  const refAlmuerzoFin = useRef(null)
  const refSalida = useRef(null)
  const refGuardar = useRef(null)

  function alCompletarEntrada() {
    refAlmuerzoInicio.current?.focus()
  }

  function alCompletarAlmuerzoInicio(hh, mm) {
    if (hh === 0 && mm === 0) {
      setHoraAlmuerzoInicio('')
      setHoraAlmuerzoFin('')
      // Limpia el atajo de texto a mano -- ver el comentario de
      // CampoHora.jsx::limpiar(), el efecto normal no alcanza a
      // dispararse porque el valor vuelve a '' en el mismo tick.
      refAlmuerzoInicio.current?.limpiar()
      refSalida.current?.focus()
    } else {
      refAlmuerzoFin.current?.focus()
    }
  }

  function alCompletarAlmuerzoFin() {
    refSalida.current?.focus()
  }

  function alCompletarSalida() {
    refGuardar.current?.focus()
  }

  return {
    refEntrada, refAlmuerzoInicio, refAlmuerzoFin, refSalida, refGuardar,
    alCompletarEntrada, alCompletarAlmuerzoInicio, alCompletarAlmuerzoFin, alCompletarSalida,
  }
}
