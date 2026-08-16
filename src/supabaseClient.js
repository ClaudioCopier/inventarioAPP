import { createClient } from '@supabase/supabase-js'
import { ADMIN_EMAIL } from './lib/constantes.js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  // eslint-disable-next-line no-console
  console.warn('Faltan las variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
}

// Storage de sesión distinto según quién se loguea (2026-08-16) -- bug real
// reportado en producción: la ventana de 5 horas (ver más abajo) se estaba
// aplicando también al admin, cuando el pedido original era SOLO para
// trabajador ("nunca el admin ni nada que lo involucre"). Como hay un único
// cliente de Supabase compartido por toda la app, la decisión se toma
// mirando el email adentro del JSON de sesión que GoTrueClient guarda --
// no hace falta saber el rol de antemano, el email ya viaja en `session.user`.
//
// - Admin: sessionStorage puro, como estaba ANTES del pedido de las 5 horas
//   (2026-08-08) -- cerrar la pestaña/navegador cierra la sesión de verdad,
//   sin ninguna ventana de gracia.
// - Trabajador (cualquier otro email): localStorage con vencimiento propio
//   de 5 horas desde el LOGIN, no desde la última actividad -- sobrevive
//   cerrar el navegador (motivo: usan el celular, cambian de app seguido,
//   el sistema operativo mata la pestaña y sessionStorage se pierde a mitad
//   de un conteo).
const CINCO_HORAS_MS = 5 * 60 * 60 * 1000
const claveVencimiento = (clave) => clave + '-vence-en'

function esSesionAdmin(valorJson) {
  try {
    return JSON.parse(valorJson)?.user?.email === ADMIN_EMAIL
  } catch {
    return false
  }
}

const storagePorRol = {
  getItem(clave) {
    // El admin guarda en sessionStorage; el trabajador en localStorage con
    // vencimiento. Ninguna sesión activa a la vez usa las dos, pero se
    // revisan ambas acá porque en el momento de leer (carga de la página)
    // todavía no se sabe cuál es -- recién se sabe adentro del valor guardado.
    const enSession = window.sessionStorage.getItem(clave)
    if (enSession) return enSession

    const venceTexto = window.localStorage.getItem(claveVencimiento(clave))
    if (venceTexto && Date.now() > Number(venceTexto)) {
      window.localStorage.removeItem(clave)
      window.localStorage.removeItem(claveVencimiento(clave))
      return null
    }
    return window.localStorage.getItem(clave)
  },
  setItem(clave, valor) {
    if (esSesionAdmin(valor)) {
      window.sessionStorage.setItem(clave, valor)
      window.localStorage.removeItem(clave)
      window.localStorage.removeItem(claveVencimiento(clave))
      return
    }
    // Solo se fija el vencimiento la PRIMERA vez (login) -- los refrescos
    // automáticos del token siguen llamando a setItem con el mismo valor de
    // clave, pero no deben correr la ventana de 5 horas hacia adelante.
    if (!window.localStorage.getItem(claveVencimiento(clave))) {
      window.localStorage.setItem(claveVencimiento(clave), String(Date.now() + CINCO_HORAS_MS))
    }
    window.localStorage.setItem(clave, valor)
    window.sessionStorage.removeItem(clave)
  },
  removeItem(clave) {
    window.localStorage.removeItem(clave)
    window.localStorage.removeItem(claveVencimiento(clave))
    window.sessionStorage.removeItem(clave)
  },
}

export const supabase = createClient(url, key, {
  auth: { storage: storagePorRol, persistSession: true, autoRefreshToken: true },
})
