import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  // eslint-disable-next-line no-console
  console.warn('Faltan las variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
}

// Sesión atada a sessionStorage, no al localStorage por defecto de Supabase
// -- a pedido explícito del usuario (2026-08-08): que cerrar el navegador
// cierre la sesión de verdad, tanto para trabajador como para admin. Con el
// storage por defecto (localStorage) el login sobrevivía indefinidamente
// (autoRefreshToken lo renueva solo) aunque se cerrara el navegador -- solo
// "Cerrar sesión" lo invalidaba. sessionStorage sigue sobreviviendo un
// refresh de la página (para no desloguear a mitad de una ronda de conteo),
// pero desaparece al cerrar la pestaña/navegador de verdad.
export const supabase = createClient(url, key, {
  auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true },
})
