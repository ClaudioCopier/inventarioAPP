// Respaldo para trabajadores que nunca configuraron palabra de
// recuperación (recuperacion_hash es nullable): el admin les asigna una
// clave inicial a mano desde el panel. Requiere una sesión de admin real
// -- se verifica el token recibido contra la Admin API y se confirma
// rol='admin' en "perfiles" antes de tocar nada.
import { supabaseAdmin } from './_supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Método no permitido' });
    return;
  }

  const { accessToken, nombre, claveNueva } = req.body || {};
  if (!accessToken || !nombre || !claveNueva) {
    res.status(400).json({ ok: false, error: 'Faltan datos.' });
    return;
  }

  try {
    const admin = supabaseAdmin();

    const { data: userData, error: errUser } = await admin.auth.getUser(accessToken);
    if (errUser || !userData?.user) {
      res.status(401).json({ ok: false, error: 'Sesión inválida, volvé a iniciar sesión como admin.' });
      return;
    }

    const { data: perfilLlamador, error: errLlamador } = await admin
      .from('perfiles')
      .select('rol')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (errLlamador) throw errLlamador;
    if (!perfilLlamador || perfilLlamador.rol !== 'admin') {
      res.status(403).json({ ok: false, error: 'Solo el administrador puede hacer esto.' });
      return;
    }

    const { data: perfilTrabajador, error: errTrabajador } = await admin
      .from('perfiles')
      .select('id')
      .ilike('nombre', nombre.trim())
      .maybeSingle();
    if (errTrabajador) throw errTrabajador;
    if (!perfilTrabajador) {
      res.status(400).json({ ok: false, error: 'No existe una cuenta con ese nombre.' });
      return;
    }

    const { error: errUpdate } = await admin.auth.admin.updateUserById(perfilTrabajador.id, { password: claveNueva });
    if (errUpdate) throw errUpdate;

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
