// Cliente de Supabase con la clave service_role -- se salta RLS por
// completo. SOLO se usa desde funciones serverless (este archivo nunca se
// importa desde src/, que es lo único que termina en el bundle del
// navegador). La clave vive en SUPABASE_SERVICE_ROLE_KEY (Vercel,
// server-only, nunca con prefijo VITE_) -- mismo patrón que
// SERVIDOR-PDV/agente-servidor usa para Supabase Storage.
import { createClient } from '@supabase/supabase-js';

let cliente = null;

export function supabaseAdmin() {
  if (cliente) return cliente;

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Faltan SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en las variables de entorno del servidor.');
  }

  cliente = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return cliente;
}
