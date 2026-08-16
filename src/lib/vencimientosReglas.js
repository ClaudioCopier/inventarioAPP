// Misma regla de alerta que agente-servidor/lib/vencimientos.js::calcularAlerta
// -- mantenida en sync a mano a propósito (es una función chica y pura, no
// vale la pena compartir el archivo entre un proyecto Node y uno Vite).
// Cualquier cambio a la regla del 60% o al modo "solo_vencimiento" tiene que
// replicarse en los dos lados.
const MS_DIA = 86400000
const UMBRAL_FRACCION = 0.6
const MULTIPLICADOR_UNIDAD = { dias: 1, semanas: 7, meses: 30 }

export function diasEntre(desde, hasta) {
  return Math.round((hasta - desde) / MS_DIA)
}

// Devuelve { alerta, vencido, diasRestantes, fraccion } para un lote, en el
// momento `hoy`. Se calcula siempre en vivo, nunca es un flag guardado.
export function calcularAlerta(lote, hoy = new Date()) {
  if (!lote.modo || lote.modo === 'omitido') return { alerta: false, vencido: false }

  if (lote.modo === 'completo') {
    if (!lote.fecha_elaboracion || !lote.fecha_vencimiento) return { alerta: false, vencido: false }
    const elaboracion = new Date(lote.fecha_elaboracion)
    const vencimiento = new Date(lote.fecha_vencimiento)
    const vidaUtilMs = vencimiento - elaboracion
    if (vidaUtilMs <= 0) return { alerta: false, vencido: false }
    const fraccion = (hoy - elaboracion) / vidaUtilMs
    const diasRestantes = diasEntre(hoy, vencimiento)
    return { alerta: fraccion >= UMBRAL_FRACCION, vencido: diasRestantes < 0, fraccion, diasRestantes }
  }

  if (lote.modo === 'solo_vencimiento') {
    if (!lote.fecha_vencimiento) return { alerta: false, vencido: false }
    const vencimiento = new Date(lote.fecha_vencimiento)
    const multiplicador = MULTIPLICADOR_UNIDAD[lote.aviso_previo_unidad] || 1
    const avisoPrevioDias = (Number(lote.aviso_previo_valor) || 0) * multiplicador
    const umbral = new Date(vencimiento.getTime() - avisoPrevioDias * MS_DIA)
    const diasRestantes = diasEntre(hoy, vencimiento)
    return { alerta: hoy >= umbral, vencido: diasRestantes < 0, diasRestantes }
  }

  return { alerta: false, vencido: false }
}

// Clasificación para ListaPage.jsx -- una sola pasada, un solo criterio.
export function clasificarLote(lote, hoy = new Date()) {
  if (lote.estado === 'agotado') return 'agotado'
  if (!lote.modo) return 'pendiente'
  if (lote.modo === 'omitido') return 'omitido'
  const { vencido, alerta } = calcularAlerta(lote, hoy)
  if (vencido) return 'vencido'
  if (alerta) return 'proximo'
  return 'ok'
}
