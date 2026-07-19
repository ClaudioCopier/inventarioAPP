// Exportación de un reporte de inventario a un .xlsx con formato real
// (colores por estado, dos hojas). Carga diferida de exceljs: solo el
// admin lo necesita, no tiene sentido incluirlo en el bundle del trabajador.
export async function exportarReporteExcel(reporte) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const hoja = wb.addWorksheet('Reporte')
  hoja.columns = [
    { header: 'Descripción', key: 'descripcion', width: 40 },
    { header: 'Inventario sistema', key: 'inventario_sistema', width: 18 },
    { header: 'En tienda', key: 'en_tienda', width: 12 },
    { header: 'En cajas', key: 'en_cajas', width: 12 },
    { header: 'En vitrina', key: 'en_vitrina', width: 12 },
    { header: 'Estado', key: 'estado', width: 16 },
    { header: 'Trabajadores', key: 'trabajadores', width: 30 },
  ]
  hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F4F3F' } }
  hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }

  const colorPorEstado = (estado) => {
    if (estado === 'Cuadrado') return 'FFEAF7ED'
    if (estado.startsWith('Faltan')) return 'FFFDECEC'
    return 'FFFFF4D9'
  }

  for (const fila of reporte.resumen || []) {
    const row = hoja.addRow({
      descripcion: fila.descripcion,
      inventario_sistema: fila.inventario_sistema,
      en_tienda: fila.en_tienda,
      en_cajas: fila.en_cajas,
      en_vitrina: fila.en_vitrina,
      estado: fila.estado,
      trabajadores: (fila.trabajadores || []).join(', '),
    })
    row.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorPorEstado(fila.estado) } }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } } }
    })
  }

  const resumenHoja = wb.addWorksheet('Resumen')
  resumenHoja.columns = [{ header: '', key: 'k', width: 28 }, { header: '', key: 'v', width: 40 }]
  const cuadrados = (reporte.resumen || []).filter((f) => f.estado === 'Cuadrado').length
  const faltantes = (reporte.resumen || []).filter((f) => f.estado.startsWith('Faltan')).length
  const sobrantes = (reporte.resumen || []).filter((f) => f.estado.startsWith('Sobran')).length
  resumenHoja.addRows([
    { k: 'Ronda', v: reporte.ronda || '(sin nombre)' },
    { k: 'Cerrado por', v: reporte.cerrado_por },
    { k: 'Cerrado en', v: new Date(reporte.cerrado_en).toLocaleString('es-CL') },
    { k: 'Participantes', v: (reporte.participantes || []).join(', ') },
    { k: 'Productos cuadrados', v: cuadrados },
    { k: 'Productos con faltantes', v: faltantes },
    { k: 'Productos con sobrantes', v: sobrantes },
  ])
  resumenHoja.getColumn(1).font = { bold: true }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const nombreRonda = (reporte.ronda || 'reporte').replace(/[^a-z0-9]+/gi, '_')
  a.href = url
  a.download = `inventario_${nombreRonda}_${reporte.id}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
