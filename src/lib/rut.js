// RUT chileno: validar y normalizar (2026-09-06, Club de fidelización).
// Misma función replicada a mano en agente-servidor/lib/rut.js -- igual
// criterio que vencimientosReglas.js (no vale la pena compartir el archivo
// entre un proyecto Node y uno Vite). Cualquier cambio acá tiene que
// replicarse en los dos lados.

// Deja solo dígitos + K/k, sin puntos ni guión ni espacios.
export function limpiarRut(rut) {
  return String(rut || '').replace(/[^0-9kK]/g, '').toUpperCase()
}

// Algoritmo módulo 11 -- dígito verificador esperado para un "cuerpo"
// (RUT sin el dígito verificador).
function calcularDv(cuerpo) {
  let suma = 0
  let multiplo = 2
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplo
    multiplo = multiplo === 7 ? 2 : multiplo + 1
  }
  const resto = 11 - (suma % 11)
  if (resto === 11) return '0'
  if (resto === 10) return 'K'
  return String(resto)
}

// true si "rut" (en cualquier formato: con puntos, con o sin guión) tiene
// un dígito verificador válido.
export function validarRut(rut) {
  const limpio = limpiarRut(rut)
  if (limpio.length < 2) return false
  const cuerpo = limpio.slice(0, -1)
  const dv = limpio.slice(-1)
  if (!/^\d+$/.test(cuerpo)) return false
  return calcularDv(cuerpo) === dv
}

// Formato canónico de almacenamiento: sin puntos, CON guión (ej.
// "18756847-1") -- el que usa club_socios.rut.
export function formatearRut(rut) {
  const limpio = limpiarRut(rut)
  if (limpio.length < 2) return limpio
  return `${limpio.slice(0, -1)}-${limpio.slice(-1)}`
}

// Devuelve el RUT en formato canónico si es válido, o null si no lo es.
export function normalizarRut(rut) {
  return validarRut(rut) ? formatearRut(rut) : null
}

// Autoformato mientras se tipea (mismo espíritu que CampoFecha/CampoHora,
// pedido explícito del usuario: sin puntos, solo el guión --
// "187568471" -> "18756847-1", mismo formato canónico que ya usa
// normalizarRut()/club_socios.rut, para no mostrar un formato en pantalla
// distinto del que después queda guardado).
export function formatearRutMientrasTipea(valorCrudo) {
  const limpio = limpiarRut(valorCrudo).slice(0, 9) // 8 dígitos + dv, tope razonable
  if (limpio.length <= 1) return limpio
  return `${limpio.slice(0, -1)}-${limpio.slice(-1)}`
}
