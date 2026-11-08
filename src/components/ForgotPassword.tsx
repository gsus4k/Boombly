import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { authRedirectOrigin } from '../lib/authRedirectOrigin'

const inputCls =
  'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-3 text-sm outline-none focus:border-[#2563eb] transition-colors placeholder:text-[#555]'

type ForgotPasswordProps = {
  panel: 'restaurant' | 'admin'
}

export default function ForgotPassword({ panel }: ForgotPasswordProps) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [processing, setProcessing] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const lock = useRef(false)

  useEffect(() => {
    const onExternalOpen = (event: Event) => {
      const target = (event as CustomEvent<string>).detail
      if (!target || target === panel) setOpen(true)
    }
    window.addEventListener('boombly:forgot-password', onExternalOpen)
    return () => window.removeEventListener('boombly:forgot-password', onExternalOpen)
  }, [panel])

  useEffect(() => {
    if (cooldown <= 0) return
    const timeout = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timeout)
  }, [cooldown])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (lock.current || cooldown > 0) return
    lock.current = true
    setProcessing(true)
    setMessage('')
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: authRedirectOrigin(),
      })
      if (error) {
        const code = error.code ?? ''
        const description = `${code} ${error.message}`.toLowerCase()
        if (code === 'over_email_send_rate_limit') {
          setMessage('Se alcanzó el límite de correos: espera unos minutos')
        } else if (description.includes('error sending') || code === 'unexpected_failure') {
          setMessage('No se pudo enviar el correo: el servidor de correo del proyecto no está configurado')
        } else {
          setMessage('Si ese correo está registrado, te enviamos un enlace para restablecer tu contraseña. Revisa también la carpeta de spam')
        }
      } else {
        setMessage('Si ese correo está registrado, te enviamos un enlace para restablecer tu contraseña. Revisa también la carpeta de spam')
      }
      setCooldown(60)
    } finally {
      setProcessing(false)
      lock.current = false
    }
  }

  return (
    <>
      <button type="button" onClick={() => { setMessage(''); setOpen(true) }} className="text-xs text-[#4d8cff] hover:text-[#82abff] mt-4">
        ¿Olvidaste tu contraseña?
      </button>
      {open && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm bg-[#111] border border-[#2a2a2a] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display font-black text-xl">Restablecer contraseña</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-[#777] hover:text-white" aria-label="Cerrar">✕</button>
            </div>
            <form onSubmit={submit}>
              <label className="block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-1.5">Correo</label>
              <input className={inputCls} type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required />
              {message && <p className="text-sm text-[#aaa] mt-3">{message}</p>}
              <button type="submit" disabled={processing || cooldown > 0} className="w-full mt-5 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-60 py-3 rounded-xl font-display font-black">
                {processing ? 'Enviando…' : cooldown > 0 ? `Esperar ${cooldown}s` : 'Enviar enlace'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
