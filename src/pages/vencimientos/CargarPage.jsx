import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient.js'
import { useSesionTrabajador } from '../../lib/useSesionTrabajador.js'
import GateTrabajador from '../../components/GateTrabajador.jsx'
import CampoFecha from '../../components/CampoFecha.jsx'
import { traerTodasLasFilas } from '../../lib/traerTodasLasFilas.js'

const HOY_ISO = () => new Date().toISOString().slice(0, 10)
const EPSILON = 0.001

async function registrarLog(loteId, codigo, sesion, accion, detalle) {
  const { error } = await supabase.from('lotes_vencimiento_log').insert({
    lote_id: loteId, codigo, worker_id: sesion.id, worker_nombre: sesion.nombre, accion, detalle,
  })
  if (error) console.error('No se pudo registrar el log de vencimientos:', error.message)
}

// "Juntar lotes" (2026-08-23, pedido explícito del usuario): cuando un lote
// recién agregado termina con la MISMA fecha (y mismo modo) que un lote ya
// existente del mismo producto, no tiene sentido llevarlos separados --
// se suma la cantidad al lote existente y este queda dado de baja (nunca
// se borra, queda el rastro completo en el log).
async function fusionarLotes(loteOrigen, loteDestino, sesion) {
  const nuevaInicial = Number(loteDestino.cantidad_inicial) + Number(loteOrigen.cantidad_restante)
  const nuevaRestante = Number(loteDestino.cantidad_restante) + Number(loteOrigen.cantidad_restante)
  const { error: errDestino } = await supabase
    .from('lotes_vencimiento')
    .update({ cantidad_inicial: nuevaInicial, cantidad_restante: nuevaRestante, actualizado_por: sesion.nombre, actualizado_en: new Date().toISOString() })
    .eq('id', loteDestino.id)
  if (errDestino) throw new Error(errDestino.message)

  const { error: errOrigen } = await supabase
    .from('lotes_vencimiento')
    .update({ estado: 'agotado', cantidad_restante: 0, actualizado_por: sesion.nombre, actualizado_en: new Date().toISOString() })
    .eq('id', loteOrigen.id)
  if (errOrigen) throw new Error(errOrigen.message)

  await registrarLog(loteOrigen.id, loteOrigen.codigo, sesion, 'fusionado_en', { fusionado_en_lote: loteDestino.id, cantidad: loteOrigen.cantidad_restante })
  await registrarLog(loteDestino.id, loteDestino.codigo, sesion, 'recibio_fusion', { fusionado_desde_lote: loteOrigen.id, cantidad: loteOrigen.cantidad_restante })
}

// "Separar" (2026-08-23, pedido explícito del usuario): lo inverso -- un
// lote que en realidad trae unidades con fechas de vencimiento distintas
// (llegó mezclado) se reparte en 2+ lotes nuevos, cada uno con su propia
// cantidad, pendientes de fecha por separado. El original queda dado de
// baja, nunca borrado.
async function separarLote(lote, cantidades, sesion) {
  const { data: hermanos, error: errHermanos } = await supabase.from('lotes_vencimiento').select('numero_lote').eq('codigo', lote.codigo)
  if (errHermanos) throw new Error(errHermanos.message)
  let maxNumero = hermanos && hermanos.length ? Math.max(...hermanos.map((h) => h.numero_lote)) : 0

  const nuevos = []
  for (const cantidad of cantidades) {
    maxNumero += 1
    const { data: nuevo, error } = await supabase
      .from('lotes_vencimiento')
      .insert({
        codigo: lote.codigo, descripcion: lote.descripcion, numero_lote: maxNumero,
        cantidad_inicial: cantidad, cantidad_restante: cantidad, estado: 'activo', creado_por: sesion.nombre,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    nuevos.push({ id: nuevo.id, cantidad })
  }

  const { error: errOrigen } = await supabase
    .from('lotes_vencimiento')
    .update({ estado: 'agotado', cantidad_restante: 0, actualizado_por: sesion.nombre, actualizado_en: new Date().toISOString() })
    .eq('id', lote.id)
  if (errOrigen) throw new Error(errOrigen.message)

  await registrarLog(lote.id, lote.codigo, sesion, 'separado_en', { nuevos_lotes: nuevos.map((n) => n.id), cantidades })
  for (const n of nuevos) {
    await registrarLog(n.id, lote.codigo, sesion, 'creado_por_separacion', { separado_de_lote: lote.id, cantidad: n.cantidad })
  }
}

// "Editar" (2026-08-30, pedido explícito del usuario: "nuestros trabajadores
// se han equivocado algunas veces y no se pueden editar"): un lote ya
// cargado (modo completo/solo_vencimiento/omitido) quedaba fijo para
// siempre -- si alguien tocaba mal una fecha no había forma de corregirlo
// salvo entrando directo a la base. Reutiliza el mismo formulario de 3
// modos que FormularioLote, pero actualiza en vez de crear, y deja
// registrado en el log qué valores tenía antes de la corrección.
function PanelEditar({ lote, lotesHermanos, sesion, onGuardado, onFusionado, onCancelar }) {
  const [modo, setModo] = useState(lote.modo || 'completo')
  const [fechaElaboracion, setFechaElaboracion] = useState(lote.fecha_elaboracion || '')
  const [fechaVencimiento, setFechaVencimiento] = useState(lote.fecha_vencimiento || '')
  const [avisoPrevioValor, setAvisoPrevioValor] = useState(lote.aviso_previo_valor || 14)
  const [avisoPrevioUnidad, setAvisoPrevioUnidad] = useState(lote.aviso_previo_unidad || 'dias')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  // Mismo detector de "juntar" que FormularioLote (2026-09-05, bug real
  // reportado: se corrigió la fecha de dos lotes de "RICO MG QUELADO" hasta
  // dejarlos con la misma fecha exacta, pero como esta lista de hermanos
  // nunca se le pasaba a PanelEditar, no había forma de juntarlos -- quedaban
  // duplicados para siempre). Compara en vivo contra lo que se está por
  // guardar, igual criterio: mismo modo, misma fecha (y mismo aviso previo si
  // aplica), solo contra hermanos activos.
  const candidatoFusion = fechaVencimiento
    ? (lotesHermanos || []).find((l) =>
        l.estado === 'activo' &&
        l.modo === modo &&
        l.fecha_vencimiento === fechaVencimiento &&
        (modo !== 'solo_vencimiento' || (Number(l.aviso_previo_valor) === Number(avisoPrevioValor) && l.aviso_previo_unidad === avisoPrevioUnidad))
      )
    : null

  async function juntarConExistente() {
    setError('')
    setGuardando(true)
    try {
      await fusionarLotes(lote, candidatoFusion, sesion)
      onFusionado()
    } catch (e) {
      setError('No se pudo juntar: ' + e.message)
    } finally {
      setGuardando(false)
    }
  }

  async function guardar() {
    setError('')
    let payload = { actualizado_por: sesion.nombre, actualizado_en: new Date().toISOString() }

    if (modo === 'completo') {
      if (!fechaElaboracion || !fechaVencimiento) { setError('Completa las dos fechas.'); return }
      if (fechaVencimiento <= fechaElaboracion) { setError('El vencimiento tiene que ser después de la elaboración.'); return }
      payload = { ...payload, modo: 'completo', fecha_elaboracion: fechaElaboracion, fecha_vencimiento: fechaVencimiento, aviso_previo_valor: null, aviso_previo_unidad: null, omitido_por: null, omitido_en: null }
    } else if (modo === 'solo_vencimiento') {
      if (!fechaVencimiento) { setError('Completa la fecha de vencimiento.'); return }
      if (!avisoPrevioValor || Number(avisoPrevioValor) <= 0) { setError('Indica con cuánto tiempo de anticipación avisar.'); return }
      payload = { ...payload, modo: 'solo_vencimiento', fecha_elaboracion: null, fecha_vencimiento: fechaVencimiento, aviso_previo_valor: Number(avisoPrevioValor), aviso_previo_unidad: avisoPrevioUnidad, omitido_por: null, omitido_en: null }
    } else {
      payload = { ...payload, modo: 'omitido', omitido_por: sesion.nombre, omitido_en: new Date().toISOString(), fecha_elaboracion: null, fecha_vencimiento: null, aviso_previo_valor: null, aviso_previo_unidad: null }
    }

    setGuardando(true)
    const { error: errUpdate } = await supabase.from('lotes_vencimiento').update(payload).eq('id', lote.id)
    setGuardando(false)
    if (errUpdate) { setError('No se pudo guardar: ' + errUpdate.message); return }
    registrarLog(lote.id, lote.codigo, sesion, 'corregido_manual', {
      anterior: { modo: lote.modo, fecha_elaboracion: lote.fecha_elaboracion, fecha_vencimiento: lote.fecha_vencimiento, aviso_previo_valor: lote.aviso_previo_valor, aviso_previo_unidad: lote.aviso_previo_unidad },
      nuevo: payload,
    })
    onGuardado({ id: lote.id, ...payload })
  }

  return (
    <div className="card" style={{ marginTop: 8, marginBottom: 12 }}>
      <p className="hint" style={{ marginTop: 0 }}>Corregir el registro del Lote {lote.numero_lote}.</p>

      <div className="row-inline" style={{ marginBottom: 16 }}>
        <button type="button" className={`btn ${modo === 'completo' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModo('completo')}>Completo</button>
        <button type="button" className={`btn ${modo === 'solo_vencimiento' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModo('solo_vencimiento')}>Solo vencimiento</button>
        <button type="button" className={`btn ${modo === 'omitido' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModo('omitido')}>Omitir</button>
      </div>

      {modo === 'completo' && (
        <div className="row-inline">
          <CampoFecha label="Fecha de elaboración" value={fechaElaboracion} onChange={setFechaElaboracion} max={HOY_ISO()} />
          <CampoFecha label="Fecha de vencimiento" value={fechaVencimiento} onChange={setFechaVencimiento} />
        </div>
      )}

      {modo === 'solo_vencimiento' && (
        <div className="row-inline">
          <CampoFecha label="Fecha de vencimiento" value={fechaVencimiento} onChange={setFechaVencimiento} />
          <div className="field">
            <label>Avisar con anticipación</label>
            <div className="row-inline" style={{ gap: 8 }}>
              <input type="number" min="1" style={{ width: 80 }} value={avisoPrevioValor} onChange={(e) => setAvisoPrevioValor(e.target.value)} />
              <select value={avisoPrevioUnidad} onChange={(e) => setAvisoPrevioUnidad(e.target.value)}>
                <option value="dias">día(s)</option>
                <option value="semanas">semana(s)</option>
                <option value="meses">mes(es)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {modo === 'omitido' && (
        <p className="hint">Este lote va a quedar marcado como omitido, sin seguimiento.</p>
      )}

      {candidatoFusion && (
        <div className="card" style={{ background: 'var(--alert-warn-bg)', marginTop: 12, marginBottom: 0 }}>
          <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
            Ya hay otro lote con esta misma fecha (Lote {candidatoFusion.numero_lote}, {candidatoFusion.cantidad_restante} unidad(es)) — ¿los juntamos en uno solo en vez de dejarlos separados?
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={juntarConExistente} disabled={guardando}>
            {guardando ? 'Juntando…' : `Juntar con el Lote ${candidatoFusion.numero_lote}`}
          </button>
        </div>
      )}

      {error && <div className="error-text">{error}</div>}
      <div className="row-inline" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar corrección'}
        </button>
        <button className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>Cancelar</button>
      </div>
    </div>
  )
}

function repartirParejo(total, n) {
  const base = Math.round((Number(total) / n) * 100) / 100
  const arr = Array(n).fill(base)
  const resto = +(Number(total) - base * n).toFixed(2)
  arr[n - 1] = +(arr[n - 1] + resto).toFixed(2)
  return arr
}

// Formulario para dividir un lote en 2+ lotes con cantidades distintas --
// compartido entre un lote pendiente (antes de ponerle fecha) y uno ya
// registrado (por si la fecha se cargó mal y hay que corregir después).
function PanelSeparar({ lote, sesion, onSeparado, onCancelar }) {
  const [partes, setPartes] = useState(2)
  const [cantidades, setCantidades] = useState(() => repartirParejo(lote.cantidad_restante, 2))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  function cambiarPartes(valor) {
    const n = Math.max(2, Math.min(6, Number(valor) || 2))
    setPartes(n)
    setCantidades(repartirParejo(lote.cantidad_restante, n))
  }

  const suma = cantidades.reduce((acc, c) => acc + (Number(c) || 0), 0)
  const sumaOk = Math.abs(suma - Number(lote.cantidad_restante)) < 0.01

  async function confirmar() {
    if (!sumaOk) { setError(`Las cantidades tienen que sumar ${lote.cantidad_restante} en total.`); return }
    setError('')
    setGuardando(true)
    try {
      await separarLote(lote, cantidades.map(Number), sesion)
      onSeparado()
    } catch (e) {
      setError('No se pudo separar: ' + e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: 8, marginBottom: 12 }}>
      <p className="hint" style={{ marginTop: 0 }}>
        Separar lote {lote.numero_lote} ({lote.cantidad_restante} unidad(es)) en varios lotes con fechas distintas.
      </p>
      <div className="field" style={{ marginBottom: 12, maxWidth: 160 }}>
        <label>¿En cuántas partes?</label>
        <input type="number" min="2" max="6" value={partes} onChange={(e) => cambiarPartes(e.target.value)} />
      </div>
      <div className="row-inline" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {cantidades.map((c, i) => (
          <div className="field" key={i} style={{ width: 120 }}>
            <label>Parte {i + 1}</label>
            <input
              type="number" step="0.01" value={c}
              onChange={(e) => setCantidades((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
            />
          </div>
        ))}
      </div>
      {!sumaOk && <p className="hint">Suma actual: {suma} — tiene que dar {lote.cantidad_restante}.</p>}
      {error && <div className="error-text">{error}</div>}
      <div className="row-inline">
        <button className="btn btn-primary" onClick={confirmar} disabled={guardando || !sumaOk}>
          {guardando ? 'Separando…' : 'Confirmar separación'}
        </button>
        <button className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>Cancelar</button>
      </div>
    </div>
  )
}

// Formulario de un lote pendiente -- elige uno de los 3 modos y guarda.
// "Omitir" vale SOLO para este lote (pedido explícito del usuario): el
// próximo lote del mismo código vuelve a preguntar desde cero, así que acá
// no se guarda ninguna preferencia por producto, solo se actualiza esta fila.
function FormularioLote({ lote, lotesHermanos, sesion, onGuardado, onFusionado, onSepararClick }) {
  const [modo, setModo] = useState('completo')
  const [fechaElaboracion, setFechaElaboracion] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [avisoPrevioValor, setAvisoPrevioValor] = useState(14)
  const [avisoPrevioUnidad, setAvisoPrevioUnidad] = useState('dias')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  // Lote existente del mismo producto con la MISMA fecha (y mismo criterio
  // de aviso, si aplica) que lo que se está por guardar acá -- candidato a
  // juntar en vez de quedar como dos lotes separados con la misma fecha.
  const candidatoFusion = fechaVencimiento
    ? lotesHermanos.find((l) =>
        l.estado === 'activo' &&
        l.modo === modo &&
        l.fecha_vencimiento === fechaVencimiento &&
        (modo !== 'solo_vencimiento' || (Number(l.aviso_previo_valor) === Number(avisoPrevioValor) && l.aviso_previo_unidad === avisoPrevioUnidad))
      )
    : null

  async function juntarConExistente() {
    setError('')
    setGuardando(true)
    try {
      await fusionarLotes(lote, candidatoFusion, sesion)
      onFusionado()
    } catch (e) {
      setError('No se pudo juntar: ' + e.message)
    } finally {
      setGuardando(false)
    }
  }

  async function guardar() {
    setError('')
    let payload = { actualizado_por: sesion.nombre, actualizado_en: new Date().toISOString() }
    let accion = 'cargado'

    if (modo === 'completo') {
      if (!fechaElaboracion || !fechaVencimiento) { setError('Completa las dos fechas.'); return }
      if (fechaVencimiento <= fechaElaboracion) { setError('El vencimiento tiene que ser después de la elaboración.'); return }
      payload = { ...payload, modo: 'completo', fecha_elaboracion: fechaElaboracion, fecha_vencimiento: fechaVencimiento, aviso_previo_valor: null, aviso_previo_unidad: null }
    } else if (modo === 'solo_vencimiento') {
      if (!fechaVencimiento) { setError('Completa la fecha de vencimiento.'); return }
      if (!avisoPrevioValor || Number(avisoPrevioValor) <= 0) { setError('Indica con cuánto tiempo de anticipación avisar.'); return }
      payload = { ...payload, modo: 'solo_vencimiento', fecha_elaboracion: null, fecha_vencimiento: fechaVencimiento, aviso_previo_valor: Number(avisoPrevioValor), aviso_previo_unidad: avisoPrevioUnidad }
    } else {
      payload = { ...payload, modo: 'omitido', omitido_por: sesion.nombre, omitido_en: new Date().toISOString(), fecha_elaboracion: null, fecha_vencimiento: null, aviso_previo_valor: null, aviso_previo_unidad: null }
      accion = 'omitido'
    }

    setGuardando(true)
    const { error: errUpdate } = await supabase.from('lotes_vencimiento').update(payload).eq('id', lote.id)
    setGuardando(false)
    if (errUpdate) { setError('No se pudo guardar: ' + errUpdate.message); return }
    // El log es solo auditoría -- no hace falta esperarlo para que la
    // pantalla avance (2026-08-29, pedido explícito del usuario: "Guardar"
    // tardaba hasta 30s porque encadenaba 3 viajes de red seguidos --
    // update, insert del log, y un recargarLotesActual() que volvía a pedir
    // TODOS los lotes del producto -- cuando alcanza con actualizar este
    // lote en memoria).
    registrarLog(lote.id, lote.codigo, sesion, accion, payload)
    onGuardado({ id: lote.id, ...payload })
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row-inline" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p className="hint" style={{ margin: 0 }}>
          Lote {lote.numero_lote} · {lote.cantidad_restante} unidad(es) sin fecha registrada
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onSepararClick}>Separar</button>
      </div>

      <div className="row-inline" style={{ marginBottom: 16 }}>
        <button type="button" className={`btn ${modo === 'completo' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModo('completo')}>Completo</button>
        <button type="button" className={`btn ${modo === 'solo_vencimiento' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModo('solo_vencimiento')}>Solo vencimiento</button>
        <button type="button" className={`btn ${modo === 'omitido' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModo('omitido')}>Omitir</button>
      </div>

      {modo === 'completo' && (
        <div className="row-inline">
          <CampoFecha label="Fecha de elaboración" value={fechaElaboracion} onChange={setFechaElaboracion} max={HOY_ISO()} />
          <CampoFecha label="Fecha de vencimiento" value={fechaVencimiento} onChange={setFechaVencimiento} />
        </div>
      )}

      {modo === 'solo_vencimiento' && (
        <div className="row-inline">
          <CampoFecha label="Fecha de vencimiento" value={fechaVencimiento} onChange={setFechaVencimiento} />
          <div className="field">
            <label>Avisar con anticipación</label>
            <div className="row-inline" style={{ gap: 8 }}>
              <input type="number" min="1" style={{ width: 80 }} value={avisoPrevioValor} onChange={(e) => setAvisoPrevioValor(e.target.value)} />
              <select value={avisoPrevioUnidad} onChange={(e) => setAvisoPrevioUnidad(e.target.value)}>
                <option value="dias">día(s)</option>
                <option value="semanas">semana(s)</option>
                <option value="meses">mes(es)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {modo === 'omitido' && (
        <p className="hint">No se le va a hacer seguimiento a este lote. La próxima vez que llegue stock nuevo de este producto, se vuelve a preguntar.</p>
      )}

      {candidatoFusion && (
        <div className="card" style={{ background: 'var(--alert-warn-bg)', marginTop: 12, marginBottom: 0 }}>
          <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
            Ya hay un lote con esta misma fecha (Lote {candidatoFusion.numero_lote}, {candidatoFusion.cantidad_restante} unidad(es)) — ¿los juntamos en uno solo en vez de dejarlos separados?
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={juntarConExistente} disabled={guardando}>
            {guardando ? 'Juntando…' : `Juntar con el Lote ${candidatoFusion.numero_lote}`}
          </button>
        </div>
      )}

      {error && <div className="error-text">{error}</div>}
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={guardar} disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}

// "Últimos agregados" (2026-08-23, pedido explícito del usuario): en la
// pantalla principal, antes de entrar a la lista completa, mostrar los
// últimos lotes que el sistema detectó -- así quien abra la app ve al
// toque si hay algo nuevo sin fecha todavía, sin tener que ir a buscar.
//
// Excluye los lotes cuya creación quedó marcada "creado_reconciliacion" en
// el log -- esa acción es del motor VIEJO (por diferencia neta, reemplazado
// el 22-08 por el evento-por-evento) y ya no se vuelve a generar nunca más.
// Sin este filtro, decenas de lotes que solo capturaron por primera vez
// stock que YA estaba antes del 21-08 (detectados recién el 22 durante
// pruebas internas) aparecían acá como si fueran entradas recientes --
// confirmado por el usuario: "siguen apareciendo muchos productos".
//
// Se agrupa por PRODUCTO, no por lote (2026-08-23, pedido explícito del
// usuario): un mismo código con 2 lotes nuevos (ej.: Sensorial Pu Erh)
// aparecía dos veces en la lista -- ahora aparece una sola vez, con la
// cantidad de lotes pendientes, y al tocarlo entra a la ficha del producto
// donde se ven y cargan todos juntos.
//
// Solo lotes SIN fecha todavía (modo is null) -- pedido explícito del
// usuario: este sector es nada más para avisar qué falta por fechar, así
// que en cuanto alguien le pone fecha a un lote, desaparece de acá (aunque
// el mismo producto tenga otro lote que sí siga pendiente, en cuyo caso
// sigue apareciendo, solo que ya no cuenta el que se completó).
// Conteo total (2026-09-05, pedido explícito del usuario: la preview de acá
// abajo solo mostraba 10 productos, sin decir cuántos lotes nuevos hay en
// total sin fecha -- imposible saber a simple vista cuánto falta por
// actualizar). Ya no capea la consulta a 50 candidatos (que además hacía
// que el conteo total fuera incorrecto apenas hubiera más de 50 pendientes)
// -- usa traerTodasLasFilas() para traer TODOS los lotes pendientes, igual
// criterio que ya usa ListaPage.jsx para lo mismo.
async function traerUltimosAgregados() {
  const candidatos = await traerTodasLasFilas(
    'lotes_vencimiento',
    'id, codigo, descripcion, numero_lote, cantidad_restante, modo, fecha_vencimiento, creado_en',
    (q) => q.neq('estado', 'agotado').is('modo', null)
  )
  if (!candidatos.length) return { productos: [], totalLotes: 0, totalProductos: 0 }

  const { data: viejos } = await supabase
    .from('lotes_vencimiento_log')
    .select('lote_id')
    .eq('accion', 'creado_reconciliacion')
    .in('lote_id', candidatos.map((c) => c.id))
  const idsViejos = new Set((viejos || []).map((v) => v.lote_id))
  const recientes = candidatos.filter((c) => !idsViejos.has(c.id))

  const porCodigo = new Map()
  for (const l of recientes) {
    if (!porCodigo.has(l.codigo)) {
      porCodigo.set(l.codigo, { codigo: l.codigo, descripcion: l.descripcion, creado_en: l.creado_en, lotes: [] })
    }
    porCodigo.get(l.codigo).lotes.push(l)
  }

  const productos = [...porCodigo.values()].sort((a, b) => (a.creado_en < b.creado_en ? 1 : -1))
  return { productos: productos.slice(0, 10), totalLotes: recientes.length, totalProductos: productos.length }
}

function UltimosAgregados({ refreshKey }) {
  const [datos, setDatos] = useState(null)

  useEffect(() => {
    let activo = true
    traerUltimosAgregados().then((data) => { if (activo) setDatos(data) })
    return () => { activo = false }
  }, [refreshKey])

  if (!datos || datos.totalProductos === 0) return null

  const { productos, totalLotes, totalProductos } = datos
  const hayMas = totalProductos > productos.length

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <p className="hint" style={{ marginTop: 0 }}>
        {totalLotes} lote(s) nuevo(s) sin fecha en {totalProductos} producto(s) distinto(s)
        {hayMas ? ` — mostrando los ${productos.length} más recientes:` : ':'}
      </p>
      <div className="product-list">
        {productos.map((p) => {
          return (
            <a
              key={p.codigo}
              className="product-card"
              style={{ textDecoration: 'none', display: 'block' }}
              href={`/vencimientos?buscar=${encodeURIComponent(p.codigo)}`}
            >
              <div className="desc">{p.descripcion}</div>
              <div className="sys">
                Código: {p.codigo} · {p.lotes.length === 1 ? '1 lote nuevo' : `${p.lotes.length} lotes nuevos`}
                {' · '}
                <span className="status-pill warn" style={{ display: 'inline-flex', padding: '2px 10px' }}>Sin fecha todavía</span>
              </div>
            </a>
          )
        })}
      </div>
    </div>
  )
}

function PantallaCargar() {
  const { sesion, sesionLista } = useSesionTrabajador()
  const [busqueda, setBusqueda] = useState('')
  const [sugerencias, setSugerencias] = useState(null) // null = todavía no se escribió nada que buscar
  const [buscandoSugerencias, setBuscandoSugerencias] = useState(false)
  const [inputEnfocado, setInputEnfocado] = useState(false)
  const [seleccionado, setSeleccionado] = useState(null)
  const [lotes, setLotes] = useState(null)
  const [cargandoLotes, setCargandoLotes] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [separandoId, setSeparandoId] = useState(null)
  const [editandoId, setEditandoId] = useState(null)
  const [actualizando, setActualizando] = useState(false)
  const [mensajeActualizar, setMensajeActualizar] = useState('')
  const [mensajeActualizarEsError, setMensajeActualizarEsError] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // "Actualizar" (movido acá desde ListaPage.jsx, pedido explícito del
  // usuario 2026-08-29: tiene que estar siempre en la pantalla principal de
  // Vencimientos, no repetido). Inserta una solicitud en
  // vencimientos_solicitudes, el agente-servidor la escucha por Realtime y
  // corre publicarInventario() + reconciliar() + reconciliarEnVivo(); acá se
  // espera el resultado por Realtime filtrado a esa fila puntual, con un
  // timeout de respaldo por si el agente está apagado o la conexión se cae.
  async function actualizar() {
    setActualizando(true)
    setMensajeActualizar('')
    setMensajeActualizarEsError(false)
    const { data, error } = await supabase
      .from('vencimientos_solicitudes')
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
      .channel(`vencimientos-solicitud-${data.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'vencimientos_solicitudes', filter: `id=eq.${data.id}` },
        (payload) => {
          const fila = payload.new
          if (fila.status !== 'done' && fila.status !== 'error') return
          terminado = true
          supabase.removeChannel(canal)
          setActualizando(false)
          setMensajeActualizar(fila.mensaje || (fila.status === 'done' ? 'Actualización terminada.' : 'La actualización terminó con un error.'))
          setMensajeActualizarEsError(fila.status === 'error')
          if (fila.status === 'done') {
            setRefreshKey((k) => k + 1)
            if (seleccionado) recargarLotesActual()
          }
        }
      )
      .subscribe()

    setTimeout(() => {
      if (terminado) return
      supabase.removeChannel(canal)
      setActualizando(false)
      setMensajeActualizar('La actualización está tardando más de lo esperado — revisá que el agente de la tienda esté prendido y conectado.')
      setMensajeActualizarEsError(true)
    }, 480000)
  }

  // Saca el "?buscar=..." de la URL (2026-08-30, bug real reportado: al
  // buscar otra cosa mientras se estaba viendo un producto llegado por link
  // directo, la URL se quedaba apuntando al código viejo -- un refresh
  // volvía a abrir ESE producto en vez de quedarse en la búsqueda nueva).
  function limpiarUrlBuscar() {
    if (!window.location.search) return
    window.history.replaceState(null, '', window.location.pathname)
  }

  // Menú flotante de búsqueda en vivo (2026-08-30, pedido explícito del
  // usuario: "para marcaje rápido... poder desde dentro de un producto...
  // buscar inmediatamente otro" y que la barra "vaya filtrando" a medida que
  // se escribe, en vez de tener que apretar "Buscar" y salir de la ficha del
  // producto actual). Con debounce de 250ms para no disparar una consulta
  // por cada tecla. Elegir una sugerencia llama a elegirProducto() directo,
  // que no depende de que `seleccionado` esté vacío -- así reemplaza la
  // ficha actual por la del producto elegido sin pasos intermedios.
  useEffect(() => {
    const termino = busqueda.trim()
    if (termino.length < 2) { setSugerencias(null); setBuscandoSugerencias(false); return }
    setBuscandoSugerencias(true)
    const timer = setTimeout(async () => {
      const { data, error } = await supabase
        .from('products')
        .select('codigo, descripcion, inventario_sistema')
        .or(`codigo.ilike.%${termino}%,descripcion.ilike.%${termino}%`)
        .order('descripcion', { ascending: true })
        .limit(30)
      setBuscandoSugerencias(false)
      if (!error) setSugerencias(data || [])
    }, 250)
    return () => clearTimeout(timer)
  }, [busqueda])

  function elegirSugerencia(producto) {
    limpiarUrlBuscar()
    setBusqueda('')
    setSugerencias(null)
    setInputEnfocado(false)
    elegirProducto(producto)
  }

  async function elegirProducto(producto) {
    setSeleccionado(producto)
    setMensaje('')
    setSeparandoId(null)
    setEditandoId(null)
    setCargandoLotes(true)
    const { data, error } = await supabase
      .from('lotes_vencimiento')
      .select('*')
      .eq('codigo', producto.codigo)
      .order('numero_lote', { ascending: true })
    setCargandoLotes(false)
    if (error) { setMensaje('Error al cargar lotes: ' + error.message); return }
    setLotes(data || [])
  }

  function recargarLotesActual() {
    setSeparandoId(null)
    setEditandoId(null)
    if (seleccionado) elegirProducto(seleccionado)
  }

  // Cuando un FormularioLote/PanelEditar guarda un cambio simple (fecha o
  // "omitir") ya sabemos el resultado exacto sin volver a preguntarle a
  // Supabase -- pedido explícito del usuario (2026-08-29): recargarLotesActual()
  // volvía a traer TODOS los lotes del producto por la red, agregando un
  // viaje de ida y vuelta más a un "Guardar" que ya tenía que esperar el
  // update en sí. Fusionar/separar sí siguen recargando entero porque tocan
  // más de un lote.
  function actualizarLoteEnMemoria(loteActualizado) {
    setLotes((prev) => (prev || []).map((l) => (l.id === loteActualizado.id ? { ...l, ...loteActualizado } : l)))
    setEditandoId(null)
  }

  // Llegada desde ListaPage.jsx ("Cargar fecha" en una fila puntual) o desde
  // "Últimos agregados" -- pedido explícito del usuario (2026-08-23): antes
  // esto solo precargaba el término de búsqueda y mostraba la lista de
  // resultados, obligando a tocar el producto una segunda vez para recién
  // ahí ver el formulario. Ahora, como se conoce el código EXACTO, busca por
  // igualdad (no por texto parcial) y entra directo a la ficha del producto,
  // sin ese paso intermedio.
  async function buscarYAbrirDirecto(codigo) {
    setSeleccionado(null)
    const { data, error } = await supabase
      .from('products')
      .select('codigo, descripcion, inventario_sistema')
      .eq('codigo', codigo)
      .limit(1)
    if (error) { setMensaje('Error al buscar: ' + error.message); return }
    if (data && data.length) {
      elegirProducto(data[0])
    } else {
      setMensaje(`No se encontró el producto con código ${codigo}.`)
    }
  }

  useEffect(() => {
    if (!sesion) return
    const params = new URLSearchParams(window.location.search)
    const codigoPrellenado = params.get('buscar')
    if (!codigoPrellenado) return
    setBusqueda(codigoPrellenado)
    buscarYAbrirDirecto(codigoPrellenado)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion])

  if (!sesionLista) return null
  if (!sesion) return <GateTrabajador onIngresar={() => { window.location.href = '/' }} />

  const pendientes = (lotes || []).filter((l) => !l.modo && l.estado === 'activo')
  const yaCargados = (lotes || []).filter((l) => l.modo)

  return (
    <div className="page venc-page">
      <div className="topbar">
        <div>
          <div className="eyebrow">Vencimientos — {sesion.nombre}</div>
          <h1>Cargar producto</h1>
        </div>
        <div className="row-inline topbar-acciones" style={{ gap: 8 }}>
          <a className="btn btn-ghost" href="/vencimientos">Inicio</a>
          <a className="btn btn-ghost" href="/vencimientos/lista">Ver lista completa</a>
          <a className="btn btn-ghost" href="/vencimientos/historial">Historial</a>
          <button className="btn btn-ghost" onClick={actualizar} disabled={actualizando}>
            {actualizando ? 'Actualizando…' : 'Actualizar'}
          </button>
          <a className="btn btn-ghost" href="/">Salir</a>
        </div>
      </div>

      {actualizando && <p className="hint">Actualizando inventario y lotes contra la tienda — puede tardar varios minutos, podés esperar acá.</p>}
      {mensajeActualizar && <div className="card"><p className={mensajeActualizarEsError ? 'error-text' : ''}>{mensajeActualizar}</p></div>}

      {!seleccionado && <UltimosAgregados refreshKey={refreshKey} />}

      {/* Menú flotante de búsqueda en vivo (2026-08-30, pedido explícito del
          usuario): siempre visible, incluso adentro de la ficha de un
          producto -- para marcaje rápido, elegir otro de acá salta directo
          sin tener que "volver a buscar" primero. */}
      <div className="card" style={{ position: 'relative', overflow: 'visible' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="busqueda">Buscar por código o nombre</label>
          <input
            id="busqueda" type="text" value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onFocus={() => setInputEnfocado(true)}
            onBlur={() => setInputEnfocado(false)}
            placeholder="Ej: 7801234567890 o ASHWAGANDHA"
            autoComplete="off"
          />
        </div>

        {inputEnfocado && busqueda.trim().length >= 2 && (
          <div className="dropdown-flotante">
            {buscandoSugerencias && <div className="dropdown-flotante-item hint">Buscando…</div>}
            {!buscandoSugerencias && sugerencias && sugerencias.length === 0 && (
              <div className="dropdown-flotante-item hint">No se encontró ningún producto con ese código o nombre.</div>
            )}
            {!buscandoSugerencias && sugerencias && sugerencias.map((p) => (
              <button
                key={p.codigo} type="button" className="dropdown-flotante-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegirSugerencia(p)}
              >
                <div className="desc">{p.descripcion}</div>
                <div className="sys">Código: {p.codigo} · Existencia: {p.inventario_sistema}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {mensaje && <div className="card"><p className="error-text">{mensaje}</p></div>}

      {seleccionado && (
        <>
          <div className="card">
            <div className="row-inline" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{seleccionado.descripcion}</strong>
                <p className="hint" style={{ margin: 0 }}>Código: {seleccionado.codigo} · Existencia actual: {seleccionado.inventario_sistema}</p>
              </div>
              <button className="btn btn-ghost" onClick={() => { limpiarUrlBuscar(); setSeleccionado(null); setLotes(null); setSeparandoId(null); setEditandoId(null); setBusqueda('') }}>Volver a buscar</button>
            </div>
          </div>

          {cargandoLotes && <div className="card"><p>Cargando lotes…</p></div>}

          {!cargandoLotes && lotes && lotes.length === 0 && (
            <div className="card empty-state"><p>Este producto todavía no tiene ningún lote registrado. Se crea solo cuando el sistema detecta stock nuevo.</p></div>
          )}

          {!cargandoLotes && pendientes.length === 0 && lotes && lotes.length > 0 && (
            <div className="card empty-state"><p>No hay ningún lote pendiente de fecha para este producto ahora mismo.</p></div>
          )}

          {pendientes.map((lote) => (
            <div key={lote.id}>
              {separandoId === lote.id ? (
                <PanelSeparar lote={lote} sesion={sesion} onSeparado={recargarLotesActual} onCancelar={() => setSeparandoId(null)} />
              ) : (
                <FormularioLote
                  lote={lote}
                  lotesHermanos={(lotes || []).filter((l) => l.id !== lote.id)}
                  sesion={sesion}
                  onGuardado={actualizarLoteEnMemoria}
                  onFusionado={recargarLotesActual}
                  onSepararClick={() => setSeparandoId(lote.id)}
                />
              )}
            </div>
          ))}

          {yaCargados.length > 0 && (
            <div className="card">
              <p className="hint" style={{ marginTop: 0 }}>Lotes ya registrados de este producto:</p>
              <div className="tabla-scroll">
                <table className="table-preview">
                  <thead>
                    <tr><th>Lote</th><th>Cantidad</th><th>Modo</th><th>Vencimiento</th><th>Estado</th><th></th></tr>
                  </thead>
                  <tbody>
                    {yaCargados.map((l) => (
                      <tr key={l.id}>
                        <td>{l.numero_lote}</td>
                        <td>{l.cantidad_restante}</td>
                        <td>{l.modo === 'completo' ? 'Completo' : l.modo === 'solo_vencimiento' ? 'Solo vencimiento' : 'Omitido'}</td>
                        <td>{l.fecha_vencimiento || '—'}</td>
                        <td>{l.estado === 'agotado' ? 'Agotado' : 'Activo'}</td>
                        <td>
                          <div className="acciones-tabla">
                            {editandoId === l.id ? null : (
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditandoId(l.id); setSeparandoId(null) }}>Editar</button>
                            )}
                            {l.estado === 'activo' && Number(l.cantidad_restante) > EPSILON && separandoId !== l.id && (
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSeparandoId(l.id); setEditandoId(null) }}>Separar</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {editandoId && yaCargados.some((l) => l.id === editandoId) && (
                <PanelEditar
                  lote={yaCargados.find((l) => l.id === editandoId)}
                  lotesHermanos={(lotes || []).filter((l) => l.id !== editandoId)}
                  sesion={sesion}
                  onGuardado={actualizarLoteEnMemoria}
                  onFusionado={recargarLotesActual}
                  onCancelar={() => setEditandoId(null)}
                />
              )}
              {separandoId && yaCargados.some((l) => l.id === separandoId) && (
                <PanelSeparar
                  lote={yaCargados.find((l) => l.id === separandoId)}
                  sesion={sesion}
                  onSeparado={recargarLotesActual}
                  onCancelar={() => setSeparandoId(null)}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default PantallaCargar
