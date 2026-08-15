import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  // eslint-disable-next-line no-console
  console.warn('Faltan las variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
}

// Sesión con vencimiento propio de 5 horas, en localStorage (2026-08-10) --
// reemplaza el esquema anterior con sessionStorage, a pedido explícito del
// usuario: los trabajadores usan el celular y a veces tienen que cambiar de
// app por distintos motivos (llamada, otra app, etc.) -- eso basta para que
// el sistema operativo suspenda o mate la pestaña del navegador, perdiendo
// sessionStorage (atado al ciclo de vida de la pestaña) y forzando a
// escribir la clave de nuevo cada vez, a mitad de un conteo.
//
// Con localStorage puro la sesión sobrevivía indefinidamente (el motivo
// original del cambio a sessionStorage el 2026-08-08) -- este envoltorio le
// pone un techo real: 5 horas desde el LOGIN, no desde la última actividad
// (no se estira solo con el refresco automático del token), vencida esa
// ventana getItem() devuelve null como si la sesión no existiera, GoTrueClient
// la trata como cerrada, y el gate de la app vuelve a pedir la clave.
const CINCO_HORAS_MS = 5 * 60 * 60 * 1000
const claveVencimiento = (clave) => clave + '-vence-en'

const storageConVencimiento = {
  getItem(clave) {
    const venceTexto = window.localStorage.getItem(claveVencimiento(clave))
    if (venceTexto && Date.now() > Number(venceTexto)) {
      window.localStorage.removeItem(clave)
      window.localStorage.removeItem(claveVencimiento(clave))
      return null
    }
    return window.localStorage.getItem(clave)
  },
  setItem(clave, valor) {
    // Solo se fija el vencimiento la PRIMERA vez (login) -- los refrescos
    // automáticos del token siguen llamando a setItem con el mismo valor de
    // clave, pero no deben correr la ventana de 5 horas hacia adelante.
    if (!window.localStorage.getItem(claveVencimiento(clave))) {
      window.localStorage.setItem(claveVencimiento(clave), String(Date.now() + CINCO_HORAS_MS))
    }
    window.localStorage.setItem(clave, valor)
  },
  removeItem(clave) {
    window.localStorage.removeItem(clave)
    window.localStorage.removeItem(claveVencimiento(clave))
  },
}

export const supabase = createClient(url, key, {
  auth: { storage: storageConVencimiento, persistSession: true, autoRefreshToken: true },
})
