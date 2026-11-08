import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { authRedirectOrigin } from '../lib/authRedirectOrigin'

const inputCls =
  'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-3 text-sm outline-none focus:border-[#2563eb] transition-colors placeholder:text-[#555]'
const labelCls = 'block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-1.5'

function authError(error: unknown): string {
  const authError = error as { code?: string; message?: string }
  const code = authError?.code
  const message = authError?.message ?? ''

  if (code === 'invalid_credentials') return 'Contraseña actual incorrecta'
  if (code === 'same_password') return 'La nueva contraseña debe ser distinta'
  if (code === 'weak_password') return 'Contraseña débil: mínimo 8 caracteres con letras y números'
  if (code === 'email_exists') return 'Ese correo ya está en uso'
  if (message.toLowerCase().includes('already been registered')) return 'Ese correo ya está en uso'
  if (code === 'over_email_send_rate_limit') return 'Se alcanzó el límite de correos: espera unos minutos'
  if (code === 'email_address_not_authorized') return 'El proyecto aún no puede enviar correos a esa dirección: hay que configurar SMTP en Supabase'
  if (code === 'unexpected_failure' || message.toLowerCase().includes('error sending')) {
    return 'No se pudo enviar el correo de verificación: revisa la configuración de correo del proyecto'
  }
  if (message.toLowerCase().includes('auth session missing')) return 'Tu sesión venció: cierra sesión y vuelve a entrar'
  if (code === 'reauthentication_needed' || message.toLowerCase().includes('reauthentication')) {
    return 'Cierra sesión, vuelve a entrar e inténtalo de nuevo'
  }
  return message || 'No se pudo completar la operación.'
}

function formatDate(value?: string | null) {
  if (!value) return 'No disponible'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'No disponible'
    : new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function AccountSettings() {
  const [user, setUser] = useState<User | null>(null)
  const [loadingUser, setLoadingUser] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailError, setEmailError] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [emailProcessing, setEmailProcessing] = useState(false)
  const [requestedEmail, setRequestedEmail] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordProcessing, setPasswordProcessing] = useState(false)
  const [showPasswords, setShowPasswords] = useState(false)
  const refreshLock = useRef(false)
  const emailLock = useRef(false)
  const passwordLock = useRef(false)
  const resendLock = useRef(false)

  const reloadUser = async () => {
    setLoadingUser(true)
    const { data, error } = await supabase.auth.getUser()
    setLoadingUser(false)
    if (error) {
      console.error('[cuenta] cargar usuario', error)
      setEmailError(authError(error))
      return
    }

    setUser(data.user)
    setEmailMessage(current => {
      const completed = requestedEmail && data.user.email === requestedEmail && !data.user.new_email
      return completed ? `Correo actualizado a ${requestedEmail} ✓` : current
    })
  }

  useEffect(() => {
    void reloadUser()
    const refreshEmail = () => { void reloadUser() }
    window.addEventListener('boombly:cuenta-actualizada', refreshEmail)
    try {
      const stored = localStorage.getItem('boombly_email_cambio')
      if (stored && Date.now() - JSON.parse(stored).ts > 24 * 60 * 60 * 1000) {
        localStorage.removeItem('boombly_email_cambio')
      }
    } catch {
      localStorage.removeItem('boombly_email_cambio')
    }
    return () => window.removeEventListener('boombly:cuenta-actualizada', refreshEmail)
  }, [])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timeout = window.setTimeout(() => setResendCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timeout)
  }, [resendCooldown])

  const refreshAccount = async () => {
    if (refreshLock.current) return
    refreshLock.current = true
    try {
      const { error } = await supabase.auth.refreshSession()
      if (error) {
        console.error('[cuenta] actualizar estado', error)
        setEmailError(authError(error))
        return
      }
      await reloadUser()
    } finally {
      refreshLock.current = false
    }
  }

  const changeEmail = async (event: FormEvent) => {
    event.preventDefault()
    if (emailLock.current) return
    emailLock.current = true
    setEmailProcessing(true)
    setEmailError('')
    setEmailMessage('')

    try {
      const normalizedEmail = newEmail.trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        setEmailError('Introduce un correo válido')
        return
      }
      if (!user?.email || normalizedEmail.toLowerCase() === user.email.toLowerCase()) {
        setEmailError('El correo nuevo debe ser distinto al actual')
        return
      }
      if (!emailPassword) {
        setEmailError('La contraseña actual es obligatoria')
        return
      }

      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: emailPassword,
      })
      if (reauthError) {
        console.error('[cuenta] reautenticar correo', reauthError)
        setEmailError(authError(reauthError))
        return
      }

      const { error: updateError } = await supabase.auth.updateUser(
        { email: normalizedEmail },
        { emailRedirectTo: authRedirectOrigin() },
      )
      if (updateError) {
        console.error('[cuenta] cambiar correo', updateError)
        setEmailError(authError(updateError))
        return
      }

      setRequestedEmail(normalizedEmail)
      setEmailMessage(`Te enviamos un enlace a ${normalizedEmail}. El correo no cambia hasta que lo confirmes`)
      localStorage.setItem('boombly_email_cambio', JSON.stringify({
        desde: user.email,
        hacia: normalizedEmail,
        ts: Date.now(),
      }))
      await reloadUser()
    } finally {
      setEmailPassword('')
      setNewEmail('')
      setEmailProcessing(false)
      emailLock.current = false
    }
  }

  const resendEmail = async () => {
    if (resendLock.current || resendCooldown > 0 || !requestedEmail) return
    resendLock.current = true
    setEmailProcessing(true)
    setEmailError('')
    try {
      const { error } = await supabase.auth.resend({ type: 'email_change', email: requestedEmail })
      if (error) {
        console.error('[cuenta] reenviar cambio de correo', error)
        setEmailError(authError(error))
        return
      }
      setEmailMessage(`Te enviamos otro enlace a ${requestedEmail}. El correo no cambia hasta que lo confirmes`)
      setResendCooldown(60)
    } finally {
      setEmailProcessing(false)
      resendLock.current = false
    }
  }

  const changePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (passwordLock.current) return
    passwordLock.current = true
    setPasswordProcessing(true)
    setPasswordError('')
    setPasswordMessage('')

    try {
      if (!currentPassword) {
        setPasswordError('La contraseña actual es obligatoria')
        return
      }
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        setPasswordError('Contraseña débil: mínimo 8 caracteres con letras y números')
        return
      }
      if (password !== confirmPassword) {
        setPasswordError('La confirmación no coincide con la nueva contraseña')
        return
      }
      if (password === currentPassword) {
        setPasswordError('La nueva contraseña debe ser distinta')
        return
      }
      if (!user?.email) {
        setPasswordError('No se pudo obtener el correo de la sesión.')
        return
      }

      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      })
      if (reauthError) {
        console.error('[cuenta] reautenticar contraseña', reauthError)
        setPasswordError(authError(reauthError))
        return
      }

      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        console.error('[cuenta] cambiar contraseña', updateError)
        setPasswordError(authError(updateError))
        return
      }

      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password,
      })
      if (verifyError) {
        console.error('[cuenta] verificar contraseña', verifyError)
        setPasswordMessage('Se cambió pero no se pudo verificar: cierra sesión e inicia con la nueva')
      } else {
        setPasswordMessage('Contraseña actualizada y verificada ✓: la nueva contraseña ya funciona')
      }

      const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' })
      if (signOutError) console.error('[cuenta] cerrar otras sesiones', signOutError)
    } finally {
      setCurrentPassword('')
      setPassword('')
      setConfirmPassword('')
      setPasswordProcessing(false)
      passwordLock.current = false
    }
  }

  const pendingEmail = user?.new_email ?? null

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <section className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-5 lg:col-span-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display font-black text-lg">Mi cuenta</h3>
            <p className="text-sm text-[#888] mt-1 break-all">{user?.email ?? 'Cargando correo…'}</p>
            {user?.email_confirmed_at && <p className="text-xs text-green-400 mt-2">Correo confirmado ✓</p>}
            <p className="text-xs text-[#777] mt-2">Último ingreso: {formatDate(user?.last_sign_in_at)}</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshAccount()}
            disabled={loadingUser || refreshLock.current}
            className="shrink-0 text-xs text-[#888] hover:text-white border border-[#2a2a2a] disabled:opacity-50 rounded-xl px-3 py-2"
          >
            {loadingUser ? 'Actualizando…' : 'Actualizar estado'}
          </button>
        </div>
        {pendingEmail && (
          <p className="mt-4 rounded-xl border border-yellow-700/40 bg-yellow-500/10 px-3 py-3 text-sm text-yellow-300">
            Pendiente de verificación: {pendingEmail}. Tu correo no cambia hasta que abras el enlace que enviamos
          </p>
        )}
      </section>

      <section className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-5">
        <h3 className="font-display font-black text-lg mb-4">Cambiar correo</h3>
        <form onSubmit={changeEmail} className="space-y-3">
          <div>
            <label className={labelCls}>Correo nuevo</label>
            <input className={inputCls} type="email" autoComplete="email" value={newEmail} onChange={event => setNewEmail(event.target.value)} placeholder="nuevo@correo.com" />
          </div>
          <div>
            <label className={labelCls}>Contraseña actual</label>
            <input className={inputCls} type="password" autoComplete="current-password" value={emailPassword} onChange={event => setEmailPassword(event.target.value)} />
          </div>
          {emailError && <p className="text-red-400 text-sm">{emailError}</p>}
          {emailMessage && <p className={`text-sm ${emailMessage.includes('✓') ? 'text-green-400' : 'text-[#bbb]'}`}>{emailMessage}</p>}
          <button disabled={emailProcessing} className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-60 py-3 rounded-xl font-display font-black text-sm">
            {emailProcessing ? 'Procesando…' : 'Cambiar correo'}
          </button>
          {(requestedEmail || pendingEmail) && (
            <button type="button" disabled={emailProcessing || resendCooldown > 0 || !requestedEmail} onClick={() => void resendEmail()} className="w-full border border-[#2a2a2a] hover:text-white disabled:opacity-50 py-3 rounded-xl text-sm text-[#aaa]">
              {resendCooldown > 0 ? `Reenviar enlace (${resendCooldown}s)` : 'Reenviar enlace'}
            </button>
          )}
        </form>
      </section>

      <section className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-black text-lg">Cambiar contraseña</h3>
          <button
            type="button"
            disabled={passwordProcessing}
            onClick={() => setShowPasswords(value => !value)}
            className="text-xs text-[#888] hover:text-white disabled:opacity-50"
          >
            {showPasswords ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        <form onSubmit={changePassword} className="space-y-3">
          <div>
            <label className={labelCls}>Contraseña actual</label>
            <input className={inputCls} type={showPasswords ? 'text' : 'password'} autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Contraseña nueva</label>
            <input className={inputCls} type={showPasswords ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Confirmar contraseña nueva</label>
            <input className={inputCls} type={showPasswords ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} />
          </div>
          {passwordError && <p className="text-red-400 text-sm">{passwordError}</p>}
          {passwordMessage && <p className={`text-sm ${passwordMessage.includes('✓') ? 'text-green-400' : 'text-amber-300'}`}>{passwordMessage}</p>}
          <button disabled={passwordProcessing} className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-60 py-3 rounded-xl font-display font-black text-sm">
            {passwordProcessing ? 'Procesando…' : 'Cambiar contraseña'}
          </button>
        </form>
      </section>
    </div>
  )
}
