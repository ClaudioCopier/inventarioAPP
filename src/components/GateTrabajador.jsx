import { useState } from 'react'
import { supabase } from '../supabaseClient.js'
import { emailSintetico } from '../lib/emailSintetico.js'

const NOMBRE_RESERVADO = 'admin'

// Login/creación de cuenta/recuperación de clave para trabajador o admin
// (mismas cuentas reales de Supabase Auth). Extraído de WorkerPage.jsx
// (2026-08-16) para que Vencimientos use exactamente el mismo formulario,
// sin duplicar 180 líneas -- comportamiento idéntico al de antes.
export default function GateTrabajador({ onIngresar }) {
  const [modo, setModo] = useState('entrar') // 'entrar' | 'crear' | 'recuperar'
  const [nombre, setNombre] = useState('')
  const [clave, setClave] = useState('')
  const [palabraRecuperacion, setPalabraRecuperacion] = useState('')
  const [claveNueva, setClaveNueva] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  function cambiarModo(nuevoModo) {
    setModo(nuevoModo)
    setError('')
    setAviso('')
  }

  async function entrar(e) {
    e.preventDefault()
    setError('')
    setAviso('')
    const nombreLimpio = nombre.trim()
    if (!nombreLimpio || !clave) {
      setError('Completa tu nombre y clave.')
      return
    }
    if (modo === 'crear' && nombreLimpio.toLowerCase() === NOMBRE_RESERVADO) {
      setError('Ese nombre está reservado, elige otro.')
      return
    }
    if (modo === 'crear' && !palabraRecuperacion.trim()) {
      setError('Elige también una palabra de recuperación, por si olvidas tu clave.')
      return
    }
    setCargando(true)
    try {
      const email = emailSintetico(nombreLimpio)

      if (modo === 'crear') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password: clave,
          options: { data: { nombre: nombreLimpio } },
        })
        if (signUpError) {
          if (/already registered|already been registered/i.test(signUpError.message)) {
            setError('Ya existe una cuenta con ese nombre. Usa "Iniciar sesión".')
          } else {
            setError('Error: ' + signUpError.message)
          }
          setCargando(false)
          return
        }
        // Guarda la palabra de recuperación en el perfil recién creado (la
        // fila ya existe: el trigger de la base la crea antes de que signUp
        // termine de responder).
        const bcrypt = (await import('bcryptjs')).default
        const recuperacionHash = await bcrypt.hash(palabraRecuperacion.trim().toLowerCase(), 8)
        await supabase.from('perfiles').update({ recuperacion_hash: recuperacionHash }).eq('id', data.user.id)
        onIngresar()
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: clave })
        if (signInError) {
          setError('Nombre o clave incorrectos.')
          setCargando(false)
          return
        }
        onIngresar()
      }
    } catch (err) {
      setError('Error: ' + err.message)
    } finally {
      setCargando(false)
    }
  }

  async function recuperar(e) {
    e.preventDefault()
    setError('')
    setAviso('')
    const nombreLimpio = nombre.trim()
    if (!nombreLimpio || !palabraRecuperacion.trim() || !claveNueva) {
      setError('Completa tu nombre, tu palabra de recuperación y la nueva clave.')
      return
    }
    setCargando(true)
    try {
      const resp = await fetch('/api/recuperar-clave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombreLimpio, palabraRecuperacion, claveNueva }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || !data.ok) {
        setError(data.error || 'No se pudo cambiar la clave.')
        setCargando(false)
        return
      }
      setAviso('Clave actualizada. Ya puedes iniciar sesión con la nueva clave.')
      setModo('entrar')
      setClave('')
      setPalabraRecuperacion('')
      setClaveNueva('')
    } catch (err) {
      setError('Error: ' + err.message)
    } finally {
      setCargando(false)
    }
  }

  if (modo === 'recuperar') {
    return (
      <div className="gate">
        <form className="gate-card" onSubmit={recuperar}>
          <h2>Recuperar clave</h2>
          <p>Ingresa tu nombre, tu palabra de recuperación, y la clave nueva que quieras usar.</p>
          <div className="field">
            <label htmlFor="nombre-rec">Nombre</label>
            <input id="nombre-rec" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="palabra-rec">Palabra de recuperación</label>
            <input id="palabra-rec" type="text" value={palabraRecuperacion} onChange={(e) => setPalabraRecuperacion(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="clave-nueva">Clave nueva</label>
            <input id="clave-nueva" type="password" value={claveNueva} onChange={(e) => setClaveNueva(e.target.value)} />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={cargando}>
            {cargando ? 'Un momento…' : 'Cambiar clave'}
          </button>
          <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => cambiarModo('entrar')}>
            Volver a iniciar sesión
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={entrar}>
        <h2>{modo === 'entrar' ? 'Iniciar sesión' : 'Crear cuenta'}</h2>
        <p>{modo === 'entrar' ? 'Ingresa tu nombre y clave para entrar.' : 'Elige un nombre y una clave para empezar.'}</p>
        <div className="field">
          <label htmlFor="nombre">Nombre</label>
          <input id="nombre" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="clave-trabajador">Clave</label>
          <input id="clave-trabajador" type="password" value={clave} onChange={(e) => setClave(e.target.value)} />
        </div>
        {modo === 'crear' && (
          <div className="field">
            <label htmlFor="palabra-crear">Palabra de recuperación (por si olvidas tu clave)</label>
            <input id="palabra-crear" type="text" value={palabraRecuperacion} onChange={(e) => setPalabraRecuperacion(e.target.value)} />
          </div>
        )}
        {aviso && <p className="hint" style={{ color: 'var(--ok)' }}>{aviso}</p>}
        {error && <div className="error-text">{error}</div>}
        <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={cargando}>
          {cargando ? 'Un momento…' : modo === 'entrar' ? 'Entrar' : 'Crear cuenta'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ width: '100%', marginTop: 8 }}
          onClick={() => cambiarModo(modo === 'entrar' ? 'crear' : 'entrar')}
        >
          {modo === 'entrar' ? 'No tengo cuenta' : 'Ya tengo cuenta'}
        </button>
        {modo === 'entrar' && (
          <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => cambiarModo('recuperar')}>
            ¿Olvidaste tu clave?
          </button>
        )}
      </form>
    </div>
  )
}
