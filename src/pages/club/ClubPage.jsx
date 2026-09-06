import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient.js'
import { useSesionTrabajador } from '../../lib/useSesionTrabajador.js'
import GateTrabajador from '../../components/GateTrabajador.jsx'
import { traerTodasLasFilas } from '../../lib/traerTodasLasFilas.js'
import { normalizarRut, formatearRutMientrasTipea } from '../../lib/rut.js'

// Mismo criterio que "Calcular" de Turnos -- una sola consulta liviana
// contra ventatickets (leer Notas), no una republicación de catálogo
// completo como Vencimientos (que necesita 8 min).
const TIMEOUT_ACTUALIZAR_MS = 120000

function formatoMonto(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}
function formatoFecha(iso) {
  if (!iso) return '—'
  return new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('es-CL')
}

// Registrar un socio nuevo -- si viene de una compra "sin reconocer"
// (`compraPendiente`), esa compra se suma de una al registrarse, sin
// esperar al próximo "Actualizar" (pedido explícito del usuario: que la
// compra quede contabilizada apenas se anota a la persona al club).
function FormularioSocio({ rutInicial, compraPendiente, sesion, onGuardado, onCancelar }) {
  const [rut, setRut] = useState(rutInicial || '')
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [fechaNacimiento, setFechaNacimiento] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function guardar() {
    const normalizado = normalizarRut(rut)
    if (!normalizado) { setError('El RUT no es válido -- revisá el dígito verificador.'); return }
    if (!nombre.trim()) { setError('Falta el nombre.'); return }
    setError('')
    setGuardando(true)
    const ahora = new Date().toISOString()
    const { data: nuevo, error: errInsert } = await supabase
      .from('club_socios')
      .insert({
        rut: normalizado,
        nombre: nombre.trim(),
        telefono: telefono.trim() || null,
        email: email.trim() || null,
        fecha_nacimiento: fechaNacimiento || null,
        creado_por: sesion.nombre,
        actualizado_por: sesion.nombre,
        actualizado_en: ahora,
      })
      .select()
      .single()
    if (errInsert) {
      setGuardando(false)
      setError(/duplicate|unique/i.test(errInsert.message) ? 'Ya existe un socio registrado con este RUT.' : 'No se pudo registrar: ' + errInsert.message)
      return
    }

    if (compraPendiente) {
      await supabase.from('club_compras').upsert(
        {
          socio_id: nuevo.id,
          ticket_id: compraPendiente.ticket_id,
          fecha: compraPendiente.fecha,
          bruto: compraPendiente.bruto,
          neto: Number(compraPendiente.bruto) / 1.19,
          notas_original: compraPendiente.notas_original,
        },
        { onConflict: 'ticket_id' }
      )
      await supabase
        .from('club_compras_sin_socio')
        .update({ revisado: true, revisado_por: sesion.nombre, revisado_en: ahora })
        .eq('id', compraPendiente.id)
    }

    setGuardando(false)
    onGuardado(nuevo)
  }

  return (
    <div className="card">
      <p className="hint" style={{ marginTop: 0 }}>Registrar socio nuevo</p>
      <div className="row-inline" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="field" style={{ maxWidth: 160 }}>
          <label>RUT</label>
          <input
            type="text" value={rut} onChange={(e) => setRut(formatearRutMientrasTipea(e.target.value))}
            placeholder="12.345.678-9" disabled={!!rutInicial}
          />
        </div>
        <div className="field" style={{ minWidth: 200 }}>
          <label>Nombre</label>
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Teléfono</label>
          <input type="text" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+56 9…" />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>Fecha de nacimiento</label>
          <input type="date" value={fechaNacimiento} onChange={(e) => setFechaNacimiento(e.target.value)} />
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="row-inline" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Registrar'}</button>
        <button className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>Cancelar</button>
      </div>
    </div>
  )
}

function PerfilSocio({ socio, compras, onVolver }) {
  const totalBruto = compras.reduce((acc, c) => acc + Number(c.bruto), 0)
  const totalNeto = compras.reduce((acc, c) => acc + Number(c.neto), 0)
  return (
    <div className="card">
      <div className="row-inline" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong>{socio.nombre}</strong>
          <p className="hint" style={{ margin: 0 }}>
            RUT {socio.rut}{socio.telefono ? ` · ${socio.telefono}` : ''}{socio.email ? ` · ${socio.email}` : ''}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={onVolver}>Volver a buscar</button>
      </div>
      <div className="row-inline" style={{ gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
        <div><span className="hint">Compras vinculadas</span><br /><strong>{compras.length}</strong></div>
        <div><span className="hint">Total bruto</span><br /><strong>{formatoMonto(totalBruto)}</strong></div>
        <div><span className="hint">Total neto</span><br /><strong>{formatoMonto(totalNeto)}</strong></div>
        <div><span className="hint">Socio desde</span><br /><strong>{formatoFecha(socio.creado_en)}</strong></div>
      </div>
      {compras.length === 0 && <p className="hint" style={{ marginTop: 16 }}>Todavía no hay compras vinculadas a este socio.</p>}
      {compras.length > 0 && (
        <div className="tabla-scroll" style={{ marginTop: 16 }}>
          <table className="table-preview">
            <thead><tr><th>Fecha</th><th>Bruto</th><th>Neto</th></tr></thead>
            <tbody>
              {compras.map((c) => (
                <tr key={c.id}><td>{formatoFecha(c.fecha)}</td><td>{formatoMonto(c.bruto)}</td><td>{formatoMonto(c.neto)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PantallaClub() {
  const { sesion, sesionLista } = useSesionTrabajador()
  const [busqueda, setBusqueda] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [resultado, setResultado] = useState(null) // { socio, compras } | { socio: null, rutBuscado, compraPendiente? }
  const [registrando, setRegistrando] = useState(false)
  const [sinReconocer, setSinReconocer] = useState(null)
  const [actualizando, setActualizando] = useState(false)
  const [mensajeActualizar, setMensajeActualizar] = useState('')
  const [mensajeActualizarEsError, setMensajeActualizarEsError] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const cargarSinReconocer = useCallback(async () => {
    const { data } = await supabase
      .from('club_compras_sin_socio')
      .select('*')
      .eq('revisado', false)
      .order('fecha', { ascending: false })
    setSinReconocer(data || [])
  }, [])

  useEffect(() => { if (sesion) cargarSinReconocer() }, [sesion, cargarSinReconocer, refreshKey])

  async function buscar() {
    const normalizado = normalizarRut(busqueda)
    if (!normalizado) { setMensaje('Ese RUT no es válido -- revisá el dígito verificador.'); return }
    setMensaje('')
    setBuscando(true)
    setRegistrando(false)
    const { data: socio, error } = await supabase.from('club_socios').select('*').eq('rut', normalizado).maybeSingle()
    if (error) { setBuscando(false); setMensaje('Error al buscar: ' + error.message); return }
    if (!socio) {
      setBuscando(false)
      setResultado({ socio: null, rutBuscado: normalizado })
      return
    }
    let compras = []
    try {
      compras = await traerTodasLasFilas('club_compras', '*', (q) => q.eq('socio_id', socio.id))
    } catch (err) {
      setBuscando(false)
      setMensaje('Error al cargar el historial: ' + err.message)
      return
    }
    compras.sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
    setBuscando(false)
    setResultado({ socio, compras })
  }

  function alRegistrado() {
    setRegistrando(false)
    buscar()
  }

  function registrarDesdeSinReconocer(fila) {
    setBusqueda(fila.rut_detectado)
    setResultado({ socio: null, rutBuscado: fila.rut_detectado, compraPendiente: fila })
    setRegistrando(true)
  }

  async function marcarRevisado(fila) {
    await supabase
      .from('club_compras_sin_socio')
      .update({ revisado: true, revisado_por: sesion.nombre, revisado_en: new Date().toISOString() })
      .eq('id', fila.id)
    setSinReconocer((prev) => (prev || []).filter((f) => f.id !== fila.id))
  }

  // "Actualizar" -- mismo mecanismo exacto que Vencimientos/Turnos: cola
  // de solicitudes escuchada por agente-servidor vía Realtime.
  async function actualizar() {
    setActualizando(true)
    setMensajeActualizar('')
    setMensajeActualizarEsError(false)
    const { data, error } = await supabase
      .from('club_solicitudes')
      .insert({ status: 'pending', solicitado_por: sesion.nombre })
      .select()
      .single()
    if (error) {
      setActualizando(false)
      setMensajeActualizar('No se pudo pedir la actualización: ' + error.message)
      setMensajeActualizarEsError(true)
      return
    }

    let terminado = false
    const canal = supabase
      .channel(`club-solicitud-${data.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'club_solicitudes', filter: `id=eq.${data.id}` },
        (payload) => {
          const fila = payload.new
          if (fila.status !== 'done' && fila.status !== 'error') return
          terminado = true
          supabase.removeChannel(canal)
          setActualizando(false)
          setMensajeActualizar(fila.mensaje || (fila.status === 'done' ? 'Actualización terminada.' : 'La actualización terminó con un error.'))
          setMensajeActualizarEsError(fila.status === 'error')
          if (fila.status === 'done') setRefreshKey((k) => k + 1)
        }
      )
      .subscribe()

    setTimeout(() => {
      if (terminado) return
      supabase.removeChannel(canal)
      setActualizando(false)
      setMensajeActualizar('La actualización está tardando más de lo esperado — revisá que el agente de la tienda esté prendido y conectado.')
      setMensajeActualizarEsError(true)
    }, TIMEOUT_ACTUALIZAR_MS)
  }

  if (!sesionLista) return null
  if (!sesion) return <GateTrabajador onIngresar={() => { window.location.href = '/' }} />

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Club Punto Verde — {sesion.nombre}</div>
          <h1>Fidelización</h1>
        </div>
        <div className="row-inline" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={actualizar} disabled={actualizando}>
            {actualizando ? 'Actualizando…' : 'Actualizar'}
          </button>
          <a className="btn btn-ghost" href="/">Salir</a>
        </div>
      </div>

      {actualizando && <p className="hint">Buscando compras nuevas con RUT en "Notas" — puede tardar un par de minutos.</p>}
      {mensajeActualizar && <div className="card"><p className={mensajeActualizarEsError ? 'error-text' : ''}>{mensajeActualizar}</p></div>}

      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>Buscar socio por RUT</p>
        <div className="row-inline" style={{ gap: 8 }}>
          <input
            type="text" value={busqueda} onChange={(e) => setBusqueda(formatearRutMientrasTipea(e.target.value))}
            placeholder="12.345.678-9" style={{ maxWidth: 200 }}
            onKeyDown={(e) => { if (e.key === 'Enter') buscar() }}
          />
          <button className="btn btn-primary" onClick={buscar} disabled={buscando}>{buscando ? 'Buscando…' : 'Buscar'}</button>
        </div>
        {mensaje && <p className="error-text" style={{ marginTop: 8 }}>{mensaje}</p>}
      </div>

      {resultado?.socio && <PerfilSocio socio={resultado.socio} compras={resultado.compras} onVolver={() => setResultado(null)} />}

      {resultado && !resultado.socio && !registrando && (
        <div className="card empty-state">
          <p>No hay ningún socio registrado con el RUT {resultado.rutBuscado}.</p>
          <button className="btn btn-primary" onClick={() => setRegistrando(true)}>Registrar como socio nuevo</button>
        </div>
      )}

      {registrando && (
        <FormularioSocio
          rutInicial={resultado?.rutBuscado}
          compraPendiente={resultado?.compraPendiente}
          sesion={sesion}
          onGuardado={alRegistrado}
          onCancelar={() => setRegistrando(false)}
        />
      )}

      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>
          Compras con RUT sin socio registrado {sinReconocer ? `(${sinReconocer.length})` : ''}
        </p>
        <p className="hint">
          Alguien tipeó un RUT válido en "Notas", pero todavía no hay ningún socio con ese RUT —
          puede ser un error de tipeo del cajero, o alguien que compró antes de anotarse al club.
        </p>
        {sinReconocer === null && <p>Cargando…</p>}
        {sinReconocer && sinReconocer.length === 0 && <p className="hint">Nada pendiente de revisar.</p>}
        {sinReconocer && sinReconocer.length > 0 && (
          <div className="tabla-scroll">
            <table className="table-preview">
              <thead><tr><th>Fecha</th><th>RUT detectado</th><th>Monto</th><th>Notas</th><th></th></tr></thead>
              <tbody>
                {sinReconocer.map((f) => (
                  <tr key={f.id}>
                    <td>{formatoFecha(f.fecha)}</td>
                    <td>{f.rut_detectado}</td>
                    <td>{formatoMonto(f.bruto)}</td>
                    <td>{f.notas_original}</td>
                    <td>
                      <div className="acciones-tabla">
                        <button className="btn btn-ghost btn-sm" onClick={() => registrarDesdeSinReconocer(f)}>Registrar este RUT</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => marcarRevisado(f)}>Marcar revisado</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default PantallaClub
