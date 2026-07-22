// Función serverless de Vercel (se detecta sola por vivir en /api).
// Valida la clave de administrador del lado del servidor, así deja de viajar
// en el JavaScript público (antes: variable VITE_ADMIN_CLAVE, legible por
// cualquiera con las herramientas del navegador). Devuelve sólo ok:true/false
// -- no hace falta devolver la clave, quien la escribió ya la tiene.
// Ver APP INVENTARIOS/SEGURIDAD_PENDIENTE.md por lo que este cambio NO cierra
// (acceso directo a las tablas vía la clave anon sigue abierto).
export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Método no permitido' });
    return;
  }

  const clave = (req.body && req.body.clave) || '';
  const claveReal = process.env.ADMIN_CLAVE || '';

  if (!claveReal) {
    res.status(500).json({ ok: false, error: 'No se configuró ADMIN_CLAVE en el servidor.' });
    return;
  }

  res.status(200).json({ ok: clave === claveReal });
}
