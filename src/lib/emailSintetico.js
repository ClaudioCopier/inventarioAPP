// Los trabajadores no tienen email real -- Supabase Auth necesita uno
// igual (nunca se manda nada a esta direccion, es solo un identificador).
// Usado tanto aca (login/creacion de cuenta) como en el script de backfill
// -- tiene que ser EXACTAMENTE la misma funcion en los dos lados, o un
// trabajador migrado no va a encontrar su cuenta por un desajuste de
// normalizacion (tildes, mayusculas, espacios).
const RANGO_DIACRITICOS_UNICODE = [0x0300, 0x036f]

function quitarTildes(texto) {
  const normalizado = texto.normalize('NFD')
  let resultado = ''
  for (const ch of normalizado) {
    const code = ch.codePointAt(0)
    if (code >= RANGO_DIACRITICOS_UNICODE[0] && code <= RANGO_DIACRITICOS_UNICODE[1]) continue
    resultado += ch
  }
  return resultado
}

export function slugNombre(nombre) {
  return quitarTildes(nombre)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

export function emailSintetico(nombre) {
  return `${slugNombre(nombre)}@inventario.local`
}
