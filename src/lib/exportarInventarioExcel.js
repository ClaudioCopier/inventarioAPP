import { supabase } from '../supabaseClient.js'

// Respaldo manual del inventario actual (tabla products) a un .xlsx --
// por si el día que la base local del POS se daña, hay algo reciente
// desde donde reconstruir. Carga diferida de exceljs, igual que
// exportarReporteExcel.js.
export async function exportarInventarioExcel() {
  const ExcelJS = (await import('exceljs')).default

  // Supabase limita a 1000 filas por consulta -- hay que paginar para
  // traer el catálogo completo (hoy son ~2838 productos).
  const tam = 1000
  let desde = 0
  let productos = []
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('codigo, descripcion, precio_costo, precio_venta, precio_mayoreo, inventario_sistema, inv_minimo, departamento')
      .order('descripcion', { ascending: true })
      .range(desde, desde + tam - 1)
    if (error) throw error
    productos = productos.concat(data)
    if (data.length < tam) break
    desde += tam
  }

  const wb = new ExcelJS.Workbook()
  const hoja = wb.addWorksheet('Inventario')
  hoja.columns = [
    { header: 'Codigo', key: 'codigo', width: 22 },
    { header: 'Descripcion', key: 'descripcion', width: 45 },
    { header: 'Precio Costo', key: 'precio_costo', width: 14 },
    { header: 'Precio Venta', key: 'precio_venta', width: 14 },
    { header: 'Precio Mayoreo', key: 'precio_mayoreo', width: 14 },
    { header: 'Inventario', key: 'inventario_sistema', width: 14 },
    { header: 'Inv. Minimo', key: 'inv_minimo', width: 14 },
    { header: 'Departamento', key: 'departamento', width: 26 },
  ]
  hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F4F3F' } }
  hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }

  for (const p of productos) {
    hoja.addRow({
      codigo: p.codigo || '',
      descripcion: p.descripcion,
      precio_costo: p.precio_costo,
      precio_venta: p.precio_venta,
      precio_mayoreo: p.precio_mayoreo,
      inventario_sistema: p.inventario_sistema,
      inv_minimo: p.inv_minimo,
      departamento: p.departamento || '',
    })
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const fecha = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `inventario_supabase_${fecha}.xlsx`
  a.click()
  URL.revokeObjectURL(url)

  return productos.length
}
