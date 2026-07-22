// Valida la clave de administrador contra el servidor (/api/entrar-admin),
// en vez de compararla en el navegador contra VITE_ADMIN_CLAVE (que quedaba
// legible en el bundle público). Devuelve true/false.
// Usado por AdminPage (formulario), WorkerPage (bypass ?admin=) e
// HistorialReportesPage (bypass ?clave=).
export async function verificarClaveAdmin(clave) {
  if (!clave) return false
  try {
    const resp = await fetch('/api/entrar-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave }),
    })
    const data = await resp.json().catch(() => ({}))
    return resp.ok && data.ok === true
  } catch {
    return false
  }
}
