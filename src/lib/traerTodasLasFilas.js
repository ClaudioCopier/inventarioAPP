import { supabase } from '../supabaseClient.js'

const TAM_PAGINA = 1000 // Supabase/PostgREST no devuelve más de esto por consulta si no se pagina

// Mismo problema encontrado en agente-servidor/lib/vencimientos.js: sin
// paginar, una tabla con más de 1000 filas se trunca en silencio, sin error.
// lotes_vencimiento va a superar eso con el tiempo.
export async function traerTodasLasFilas(tabla, columnas, filtro = (q) => q) {
  let desde = 0
  let filas = []
  while (true) {
    const { data, error } = await filtro(supabase.from(tabla).select(columnas)).range(desde, desde + TAM_PAGINA - 1)
    if (error) throw new Error(`No se pudo leer ${tabla}: ` + error.message)
    filas = filas.concat(data)
    if (data.length < TAM_PAGINA) break
    desde += TAM_PAGINA
  }
  return filas
}
