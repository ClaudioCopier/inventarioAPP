import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient.js'

// Sesión real de Supabase Auth, compartida entre Conteo de inventario y
// Vencimientos (extraído de WorkerPage.jsx, 2026-08-16 -- mismo
// comportamiento de antes, solo reusable). onAuthStateChange se dispara
// tanto por un login normal como por el bypass de admin de WorkerPage --
// una sola fuente de verdad por pantalla.
export function useSesionTrabajador() {
  const [sesion, setSesion] = useState(null)
  const [sesionLista, setSesionLista] = useState(false) // evita mostrar el gate antes de resolver la sesión inicial

  const cargarPerfil = useCallback(async (userId) => {
    const { data } = await supabase.from('perfiles').select('nombre, rol').eq('id', userId).maybeSingle()
    return data
  }, [])

  useEffect(() => {
    let activo = true

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!activo) return
      if (session) {
        supabase.realtime.setAuth(session.access_token)
        const perfil = await cargarPerfil(session.user.id)
        if (activo) setSesion({ id: session.user.id, nombre: perfil?.nombre || session.user.user_metadata?.nombre || '', rol: perfil?.rol || 'trabajador' })
      }
      if (activo) setSesionLista(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!activo) return
      if (session) {
        supabase.realtime.setAuth(session.access_token)
        const perfil = await cargarPerfil(session.user.id)
        if (activo) setSesion({ id: session.user.id, nombre: perfil?.nombre || session.user.user_metadata?.nombre || '', rol: perfil?.rol || 'trabajador' })
      } else {
        setSesion(null)
      }
    })

    return () => {
      activo = false
      sub.subscription.unsubscribe()
    }
  }, [cargarPerfil])

  function salir() {
    supabase.auth.signOut()
  }

  return { sesion, sesionLista, salir }
}
