import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

const inputCls =
  'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-3 pr-12 text-sm outline-none focus:border-[#2563eb] transition-colors placeholder:text-[#555]'

export default function PasswordRecoveryModal({ email, onClose }: { email: string; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState('')
  const lock = useRef(false)

  useEffect(() => () => {
    setPassword('')
    setConfirm('')
  }, [])

  const cleanUrl = () => window.history.replaceState({}, '', window.location.pathname)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (lock.current) return
    setMessage('')
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password) || password.length < 8) {
      setMessage('Contraseña débil: mínimo 8 caracteres con letras y números')
      setPassword('')
      setConfirm('')
      return
    }
    if (password !== confirm) {
      setMessage('Las contraseñas no coinciden')
      setPassword('')
      setConfirm('')
      return
    }

    lock.current = true
    setProcessing(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        if (updateError.code === 'same_password') setMessage('La nueva contraseña debe ser distinta')
        else if (updateError.code === 'weak_password') setMessage('Contraseña débil: mínimo 8 caracteres con letras y números')
        else if (updateError.code === 'unexpected_failure' || updateError.message.toLowerCase().includes('error sending')) setMessage('No se pudo enviar el correo de verificación: revisa la configuración de correo del proyecto')
        else if (updateError.message.toLowerCase().includes('auth session missing')) setMessage('Tu sesión venció: solicita un enlace nuevo')
        else setMessage(updateError.message)
        return
      }
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password })
      cleanUrl()
      if (verifyError) {
        setMessage('Se cambió, pero no se pudo verificar: inicia sesión con la nueva contraseña')
      } else {
        setMessage('Contraseña restablecida y verificada ✓')
        window.dispatchEvent(new Event('boombly:auth-changed'))
        window.setTimeout(onClose, 900)
      }
    } finally {
      setPassword('')
      setConfirm('')
      setProcessing(false)
      lock.current = false
    }
  }

  const cancel = async () => {
    await supabase.auth.signOut()
    cleanUrl()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[120] bg-black/95 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-sm bg-[#111] border border-[#2a2a2a] rounded-2xl p-6">
        <h2 className="font-display font-black text-xl mb-5">Crea tu nueva contraseña</h2>
        <label className="block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-1.5">Nueva contraseña</label>
        <div className="relative mb-4">
          <input className={inputCls} type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required />
          <button type="button" onClick={() => setShowPassword(value => !value)} className="absolute right-3 top-3 text-xs text-[#888]">{showPassword ? 'Ocultar' : 'Mostrar'}</button>
        </div>
        <label className="block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-1.5">Confirmar contraseña</label>
        <div className="relative">
          <input className={inputCls} type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} required />
          <button type="button" onClick={() => setShowPassword(value => !value)} className="absolute right-3 top-3 text-xs text-[#888]">{showPassword ? 'Ocultar' : 'Mostrar'}</button>
        </div>
        {message && <p className="text-sm text-[#aaa] mt-3">{message}</p>}
        <button type="submit" disabled={processing} className="w-full mt-5 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-60 py-3 rounded-xl font-display font-black">
          {processing ? 'Guardando…' : 'Restablecer contraseña'}
        </button>
        <button type="button" onClick={() => void cancel()} disabled={processing} className="w-full mt-2 text-[#888] disabled:opacity-60 py-2">
          Cancelar
        </button>
      </form>
    </div>
  )
}
