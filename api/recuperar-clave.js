// Recuperación de clave de trabajador. Antes, WorkerPage.jsx traía el hash
// de recuperación a la browser y comparaba ahí mismo -- ahora el hash nunca
// sale del servidor, y el reseteo de la clave real de Supabase Auth se hace
// con la Admin API (única forma de cambiarle la clave a OTRO usuario sin
// conocer la clave vieja).
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from './_supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Método no permitido' });
    return;
  }

  const { nombre, palabraRecuperacion, claveNueva } = req.body || {};
  if (!nombre || !palabraRecuperacion || !claveNueva) {
    res.status(400).json({ ok: false, error: 'Completa todos los campos.' });
    return;
  }

  try {
    const admin = supabaseAdmin();

    const { data: perfil, error } = await admin
      .from('perfiles')
      .select('id, recuperacion_hash')
      .ilike('nombre', nombre.trim())
      .maybeSingle();
    if (error) throw error;

    if (!perfil || !perfil.recuperacion_hash) {
      res.status(400).json({ ok: false, error: 'No existe una cuenta con ese nombre, o no tiene palabra de recuperación configurada (pedile al admin que te asigne una clave inicial).' });
      return;
    }

    const coincide = await bcrypt.compare(palabraRecuperacion.trim().toLowerCase(), perfil.recuperacion_hash);
    if (!coincide) {
      res.status(400).json({ ok: false, error: 'Palabra de recuperación incorrecta.' });
      return;
    }

    const { error: errUpdate } = await admin.auth.admin.updateUserById(perfil.id, { password: claveNueva });
    if (errUpdate) throw errUpdate;

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
