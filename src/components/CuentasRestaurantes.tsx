// src/components/CuentasRestaurantes.tsx
// Panel del ADMINISTRADOR para gestionar las cuentas de acceso de cada restaurante.
// - Lista los restaurantes con su cuenta (admin_listar_cuentas_restaurante).
// - Crear cuenta (Edge Function crear-cuenta-restaurante), asignar una cuenta existente
//   (admin_asignar_gestor) y quitar el acceso (admin_quitar_gestor).
// - Las ventanas se dibujan con createPortal en <body>: no pueden quedar tapadas por el panel.
// - Todo error se muestra en pantalla y en la consola. Nunca se imprimen contraseñas.
// Uso: <CuentasRestaurantes />  (dentro del panel de administración, en la pestaña Restaurantes)
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase' // si tu cliente se exporta con otro nombre, cambia SOLO esta línea

type Fila = { id_rest: string; nombre_rest: string; activo: boolean; email_gestor: string | null; id_gestor: string | null }
type Resultado = { restaurante: string; email: string; modo: 'temporal' | 'dueno'; password: string }
type Modal =
  | { tipo: 'crear'; fila: Fila }
  | { tipo: 'asignar'; fila: Fila }
  | { tipo: 'quitar'; fila: Fila }
  | { tipo: 'resultado'; datos: Resultado }
  | null

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAYUS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const MINUS = 'abcdefghijkmnopqrstuvwxyz'
const NUMS = '23456789'

const claveValida = (p: string) => p.length >= 8 && p.length <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p)

function azar(n: number): Uint32Array {
  const a = new Uint32Array(n)
  crypto.getRandomValues(a)
  return a
}

/** Contraseña aleatoria sin caracteres ambiguos (0, O, l, 1, I). */
function generarClave(largo: number): string {
  const todo = MAYUS + MINUS + NUMS
  const r = azar(largo)
  const c = Array.from({ length: largo }, (_, i) => todo[r[i] % todo.length])
  const e = azar(3)
  c[0] = MAYUS[e[0] % MAYUS.length]
  c[1] = MINUS[e[1] % MINUS.length]
  c[2] = NUMS[e[2] % NUMS.length]
  const s = azar(largo)
  for (let i = largo - 1; i > 0; i--) {
    const j = s[i] % (i + 1)
    ;[c[i], c[j]] = [c[j], c[i]]
  }
  return c.join('')
}

/** Lee el motivo real cuando la Edge Function responde con error. */
async function mensajeDeError(error: unknown): Promise<string> {
  const e = error as { name?: string; message?: string; context?: Response }
  try {
    if (e?.context && typeof e.context.json === 'function') {
      const j = await e.context.json()
      if (j?.error) return String(j.error)
    }
  } catch {
    /* si no se puede leer, sigue con los mensajes generales */
  }
  if (e?.name === 'FunctionsFetchError') {
    return 'No se pudo contactar con la función: revisa que esté publicada y que esta dirección esté en ALLOWED_ORIGINS'
  }
  return e?.message ?? 'Error desconocido'
}

// ---------- estilos (en línea, para no depender de ninguna configuración)
const caja: CSSProperties = { border: '1px solid #2a2a2a', borderRadius: 14, background: '#111', padding: 16, color: '#fff', marginTop: 16 }
const input: CSSProperties = { width: '100%', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 14, boxSizing: 'border-box' }
const etiqueta: CSSProperties = { display: 'block', fontSize: 11, letterSpacing: 1, color: '#8a8a8a', margin: '12px 0 6px', textTransform: 'uppercase' }
const errorBox: CSSProperties = { marginTop: 12, color: '#ff6b6b', fontSize: 13 }
const boton = (tipo: 'primario' | 'suave' | 'peligro' = 'suave', off = false): CSSProperties => ({
  background: tipo === 'primario' ? '#2563eb' : tipo === 'peligro' ? '#7f1d1d' : 'transparent',
  color: '#fff',
  border: tipo === 'suave' ? '1px solid #333' : '1px solid transparent',
  borderRadius: 10,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: off ? 'not-allowed' : 'pointer',
  opacity: off ? 0.6 : 1,
})

function Ventana({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={e => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose()
      }}
      onClick={e => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, zIndex: 2147483000, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div style={{ width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 20, color: '#fff' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>{titulo}</h3>
        {children}
      </div>
    </div>,
    document.body,
  )
}

// ---------- Crear cuenta
function FormCrear({ fila, onClose, onCreada }: { fila: Fila; onClose: () => void; onCreada: (r: Resultado) => void }) {
  const [email, setEmail] = useState('')
  const [modo, setModo] = useState<'temporal' | 'dueno'>('dueno')
  const [clave, setClave] = useState('')
  const [ver, setVer] = useState(false)
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const candado = useRef(false)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (candado.current) return
    setError('')
    const correo = email.trim().toLowerCase()
    if (!EMAIL.test(correo)) return setError('Escribe un correo válido')
    const password = modo === 'dueno' ? generarClave(24) : clave
    if (modo === 'temporal' && !claveValida(password)) {
      return setError('La contraseña debe tener al menos 8 caracteres, con letras y números')
    }
    candado.current = true
    setTrabajando(true)
    console.log('[cuentas] crear', { idRestaurante: fila.id_rest })
    try {
      const { data, error: err } = await supabase.functions.invoke('crear-cuenta-restaurante', {
        body: { id_restaurante: fila.id_rest, email: correo, password },
      })
      if (err) {
        console.error('[cuentas] crear', err)
        setError(await mensajeDeError(err))
        return
      }
      const motivo = (data as { error?: string } | null)?.error
      if (motivo) {
        setError(String(motivo))
        return
      }
      onCreada({ restaurante: fila.nombre_rest, email: correo, modo, password: modo === 'temporal' ? password : '' })
    } catch (ex) {
      console.error('[cuentas] crear', ex)
      setError(ex instanceof Error ? ex.message : 'Error inesperado')
    } finally {
      candado.current = false
      setTrabajando(false)
    }
  }

  return (
    <Ventana titulo={`Crear cuenta · ${fila.nombre_rest}`} onClose={onClose}>
      <form onSubmit={enviar} autoComplete="off">
        <label style={etiqueta}>Correo de acceso</label>
        <input style={input} type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="dueno@correo.com" />

        <label style={etiqueta}>Contraseña</label>
        <label style={{ display: 'flex', gap: 8, fontSize: 13, margin: '4px 0' }}>
          <input type="radio" checked={modo === 'dueno'} onChange={() => setModo('dueno')} />
          El dueño la define con «¿Olvidaste tu contraseña?»
        </label>
        <label style={{ display: 'flex', gap: 8, fontSize: 13, margin: '4px 0' }}>
          <input type="radio" checked={modo === 'temporal'} onChange={() => setModo('temporal')} />
          Yo defino una contraseña temporal
        </label>

        {modo === 'temporal' && (
          <div style={{ marginTop: 8 }}>
            <input style={input} type={ver ? 'text' : 'password'} autoComplete="new-password" value={clave} onChange={e => setClave(e.target.value)} placeholder="Mínimo 8, con letras y números" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" style={boton('suave')} onClick={() => setClave(generarClave(12))}>Generar</button>
              <button type="button" style={boton('suave')} onClick={() => setVer(v => !v)}>{ver ? 'Ocultar' : 'Mostrar'}</button>
            </div>
          </div>
        )}

        {error && <div style={errorBox}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" style={boton('suave')} onClick={onClose}>Cancelar</button>
          <button type="submit" style={boton('primario', trabajando)} disabled={trabajando}>{trabajando ? 'Creando…' : 'Crear cuenta'}</button>
        </div>
      </form>
    </Ventana>
  )
}

// ---------- Asignar una cuenta que ya existe
function FormAsignar({ fila, onClose, onHecho }: { fila: Fila; onClose: () => void; onHecho: (msg: string) => void }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const candado = useRef(false)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (candado.current) return
    setError('')
    const correo = email.trim().toLowerCase()
    if (!EMAIL.test(correo)) return setError('Escribe un correo válido')
    candado.current = true
    setTrabajando(true)
    console.log('[cuentas] asignar', { idRestaurante: fila.id_rest })
    try {
      const { error: err } = await supabase.rpc('admin_asignar_gestor', { p_id_restaurante: fila.id_rest, p_email: correo })
      if (err) {
        console.error('[cuentas] asignar', err)
        setError(err.message)
        return
      }
      onHecho(`Cuenta ${correo} asignada a ${fila.nombre_rest}`)
    } catch (ex) {
      console.error('[cuentas] asignar', ex)
      setError(ex instanceof Error ? ex.message : 'Error inesperado')
    } finally {
      candado.current = false
      setTrabajando(false)
    }
  }

  return (
    <Ventana titulo={`Asignar cuenta · ${fila.nombre_rest}`} onClose={onClose}>
      <form onSubmit={enviar} autoComplete="off">
        <p style={{ fontSize: 13, color: '#aaa', margin: '8px 0 0' }}>La cuenta debe existir ya. Si este restaurante tenía otra, se reemplaza.</p>
        <label style={etiqueta}>Correo de la cuenta</label>
        <input style={input} type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="dueno@correo.com" />
        {error && <div style={errorBox}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" style={boton('suave')} onClick={onClose}>Cancelar</button>
          <button type="submit" style={boton('primario', trabajando)} disabled={trabajando}>{trabajando ? 'Asignando…' : 'Asignar'}</button>
        </div>
      </form>
    </Ventana>
  )
}

// ---------- Quitar acceso
function FormQuitar({ fila, onClose, onHecho }: { fila: Fila; onClose: () => void; onHecho: (msg: string) => void }) {
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const candado = useRef(false)

  const confirmar = async () => {
    if (candado.current) return
    setError('')
    candado.current = true
    setTrabajando(true)
    console.log('[cuentas] quitar', { idRestaurante: fila.id_rest })
    try {
      const { error: err } = await supabase.rpc('admin_quitar_gestor', { p_id_restaurante: fila.id_rest })
      if (err) {
        console.error('[cuentas] quitar', err)
        setError(err.message)
        return
      }
      onHecho(`Se quitó el acceso a ${fila.nombre_rest}`)
    } catch (ex) {
      console.error('[cuentas] quitar', ex)
      setError(ex instanceof Error ? ex.message : 'Error inesperado')
    } finally {
      candado.current = false
      setTrabajando(false)
    }
  }

  return (
    <Ventana titulo="Quitar acceso" onClose={onClose}>
      <p style={{ fontSize: 14, color: '#ccc' }}>
        ¿Quitar el acceso a <b>{fila.nombre_rest}</b>? La cuenta <b>{fila.email_gestor}</b> no se borra, pero ya no podrá entrar a este restaurante.
      </p>
      {error && <div style={errorBox}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
        <button type="button" style={boton('suave')} onClick={onClose}>Cancelar</button>
        <button type="button" style={boton('peligro', trabajando)} disabled={trabajando} onClick={confirmar}>{trabajando ? 'Quitando…' : 'Quitar acceso'}</button>
      </div>
    </Ventana>
  )
}

// ---------- Resultado (la contraseña temporal se muestra UNA sola vez)
function VentanaResultado({ datos, onClose }: { datos: Resultado; onClose: () => void }) {
  const [copiado, setCopiado] = useState(false)
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(datos.password)
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
  }
  return (
    <Ventana titulo="Cuenta creada ✓" onClose={onClose}>
      <p style={{ fontSize: 14, color: '#ccc' }}>
        Cuenta creada para <b>{datos.restaurante}</b>: <b>{datos.email}</b>
      </p>
      {datos.modo === 'temporal' ? (
        <>
          <label style={etiqueta}>Contraseña temporal (se muestra una sola vez)</label>
          <div style={{ ...input, fontFamily: 'monospace', userSelect: 'all', wordBreak: 'break-all' }}>{datos.password}</div>
          <div style={{ marginTop: 8 }}>
            <button type="button" style={boton('suave')} onClick={copiar}>{copiado ? 'Copiada ✓' : 'Copiar'}</button>
          </div>
          <p style={{ fontSize: 12, color: '#aaa' }}>Entrégala al dueño por un canal privado. Debe cambiarla en «Mi cuenta».</p>
        </>
      ) : (
        <p style={{ fontSize: 13, color: '#ccc' }}>
          Dile al dueño que entre a «Soy restaurante», pulse «¿Olvidaste tu contraseña?» y escriba ese correo para crear la suya.
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button type="button" style={boton('primario')} onClick={onClose}>Entendido</button>
      </div>
    </Ventana>
  )
}

// ---------- Componente principal
export default function CuentasRestaurantes() {
  const [filas, setFilas] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorLista, setErrorLista] = useState('')
  const [aviso, setAviso] = useState('')
  const [modal, setModal] = useState<Modal>(null)
  const [cuentaActual, setCuentaActual] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    setErrorLista('')
    const { data: u } = await supabase.auth.getUser()
    const correo = u?.user?.email ?? ''
    setCuentaActual(correo)
    const { data, error } = await supabase.rpc('admin_listar_cuentas_restaurante')
    if (error) {
      console.error('[cuentas] listar', error)
      const m = error.message ?? ''
      if (/permission denied/i.test(m)) {
        setErrorLista('No hay una sesión activa en este navegador. Cierra sesión y vuelve a entrar como administrador.')
      } else if (/solo un administrador/i.test(m)) {
        setErrorLista(`La sesión actual (${correo || 'desconocida'}) no es de administrador. Es probable que en este navegador hayas entrado a otro panel con otra cuenta: cierra sesión y entra como administrador.`)
      } else {
        setErrorLista(m)
      }
      setFilas([])
    } else {
      setFilas((data ?? []) as Fila[])
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar() // solo lectura
    const { data: sub } = supabase.auth.onAuthStateChange((evento: string) => {
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED') {
        setTimeout(() => void cargar(), 0) // sin await de supabase dentro del callback
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [cargar])

  const cerrar = useCallback(() => setModal(null), [])
  const terminado = (msg: string) => {
    setModal(null)
    setAviso(msg)
    void cargar()
  }

  return (
    <section style={caja} aria-label="Cuentas de restaurantes">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 1, color: '#8a8a8a', textTransform: 'uppercase' }}>Accesos</div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Cuentas de restaurantes</div>
          {cuentaActual && <div style={{ fontSize: 12, color: '#8a8a8a' }}>Sesión actual: {cuentaActual}</div>}
        </div>
        <button type="button" style={boton('suave', cargando)} disabled={cargando} onClick={() => void cargar()}>{cargando ? 'Cargando…' : 'Actualizar'}</button>
      </div>

      {aviso && (
        <div style={{ marginTop: 12, fontSize: 13, color: '#7ee787' }}>
          {aviso}{' '}
          <button type="button" style={{ ...boton('suave'), padding: '2px 8px' }} onClick={() => setAviso('')}>Cerrar</button>
        </div>
      )}
      {errorLista && <div style={errorBox}>No se pudo cargar la lista: {errorLista}</div>}
      {!cargando && !errorLista && filas.length === 0 && <div style={{ marginTop: 12, fontSize: 13, color: '#aaa' }}>No hay restaurantes todavía.</div>}

      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {filas.map(f => (
          <div key={f.id_rest} style={{ border: '1px solid #262626', borderRadius: 12, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>
                {f.nombre_rest}
                {!f.activo && <span style={{ marginLeft: 8, fontSize: 11, color: '#f5a524' }}>Inactivo</span>}
              </div>
              <div style={{ fontSize: 13, color: f.email_gestor ? '#9be28f' : '#999', wordBreak: 'break-all' }}>
                {f.email_gestor ? `Cuenta: ${f.email_gestor}` : 'Sin cuenta'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!f.email_gestor && <button type="button" style={boton('primario')} onClick={() => setModal({ tipo: 'crear', fila: f })}>Crear cuenta</button>}
              <button type="button" style={boton('suave')} onClick={() => setModal({ tipo: 'asignar', fila: f })}>{f.email_gestor ? 'Reasignar' : 'Asignar existente'}</button>
              {f.email_gestor && <button type="button" style={boton('peligro')} onClick={() => setModal({ tipo: 'quitar', fila: f })}>Quitar acceso</button>}
            </div>
          </div>
        ))}
      </div>

      {modal?.tipo === 'crear' && (
        <FormCrear fila={modal.fila} onClose={cerrar} onCreada={r => { setModal({ tipo: 'resultado', datos: r }); void cargar() }} />
      )}
      {modal?.tipo === 'asignar' && <FormAsignar fila={modal.fila} onClose={cerrar} onHecho={terminado} />}
      {modal?.tipo === 'quitar' && <FormQuitar fila={modal.fila} onClose={cerrar} onHecho={terminado} />}
      {modal?.tipo === 'resultado' && <VentanaResultado datos={modal.datos} onClose={cerrar} />}
    </section>
  )
}