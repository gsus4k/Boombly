import { useEffect, useRef, useState } from 'react'
import { authRedirect } from '../lib/authRedirect'
import { supabase } from '../lib/supabase'

type EmailChangeState = 'confirmed' | 'step1' | 'error'
type StoredEmailChange = {
  desde: string
  hacia: string
  ts: number
}

function readPendingEmailChange(): StoredEmailChange | null {
  const raw = localStorage.getItem('boombly_email_cambio')
  if (!raw) return null
  try {
    const mark = JSON.parse(raw) as StoredEmailChange
    if (!mark.hacia || Date.now() - mark.ts > 24 * 60 * 60 * 1000) {
      localStorage.removeItem('boombly_email_cambio')
      return null
    }
    return mark
  } catch {
    localStorage.removeItem('boombly_email_cambio')
    return null
  }
}

function recentlyConfirmed(email: string) {
  const stored = localStorage.getItem('boombly_email_confirmado')
  if (!stored) return false
  const separator = stored.lastIndexOf('|')
  const storedEmail = stored.slice(0, separator).toLowerCase()
  const timestamp = Number(stored.slice(separator + 1))
  return storedEmail === email.toLowerCase()
    && Number.isFinite(timestamp)
    && Date.now() - timestamp < 5 * 60 * 1000
}

export default function EmailChangeModal({ suppressError = false }: { suppressError?: boolean }) {
  const [state, setState] = useState<EmailChangeState | null>(null)
  const [email, setEmail] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)

  const show = (nextState: EmailChangeState, confirmedEmail = '') => {
    if (nextState === 'confirmed' && confirmedEmail) {
      if (recentlyConfirmed(confirmedEmail)) return
      localStorage.setItem('boombly_email_confirmado', `${confirmedEmail}|${Date.now()}`)
      localStorage.removeItem('boombly_email_cambio')
      setEmail(confirmedEmail)
    }
    setState(nextState)
  }

  useEffect(() => {
    let stopped = false
    let interval: number | undefined
    let timeout: number | undefined
    let visibilityCheckQueued = false

    const checkConfirmed = async () => {
      if (stopped) return
      const mark = readPendingEmailChange()
      if (!mark) return
      const { data, error } = await supabase.auth.getUser()
      const user = data.user
      if (!error && user?.email && user.email.toLowerCase() === mark.hacia.toLowerCase() && !user.new_email) {
        show('confirmed', user.email)
      }
    }

    const runUrlDetection = async () => {
      if (authRedirect.message?.toLowerCase().includes('other email')) {
        show('step1')
        return
      }
      if (authRedirect.type === 'email_change') {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const { data, error } = await supabase.auth.getUser()
          if (!error && data.user?.email) {
            show('confirmed', data.user.email)
            return
          }
          await new Promise(resolve => window.setTimeout(resolve, 500))
        }
        return
      }
      if ((authRedirect.error || authRedirect.errorCode) && !suppressError) {
        show('error')
      }
    }

    void runUrlDetection()
    void checkConfirmed()

    const { data } = supabase.auth.onAuthStateChange(() => {
      window.setTimeout(() => {
        void checkConfirmed()
      }, 0)
    })

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !visibilityCheckQueued) {
        visibilityCheckQueued = true
        window.setTimeout(() => {
          visibilityCheckQueued = false
          void checkConfirmed()
        }, 0)
      }
    }
    const onFocus = () => void checkConfirmed()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)

    interval = readPendingEmailChange()
      ? window.setInterval(() => void checkConfirmed(), 10_000)
      : undefined
    timeout = window.setTimeout(() => {
      if (interval !== undefined) window.clearInterval(interval)
    }, 15 * 60 * 1000)

    return () => {
      stopped = true
      data.subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      if (interval !== undefined) window.clearInterval(interval)
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [suppressError])

  useEffect(() => {
    if (!state) return
    buttonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setState(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [state])

  const confirm = async () => {
    await supabase.auth.refreshSession()
    await supabase.rpc('mi_rol')
    window.dispatchEvent(new Event('boombly:cuenta-actualizada'))
    setState(null)
  }

  if (!state) return null

  const confirmed = state === 'confirmed'
  const title = confirmed ? 'Correo actualizado ✓' : state === 'step1' ? 'Primer enlace confirmado' : 'Enlace no válido'
  const text = confirmed
    ? `Tu nuevo correo de ingreso es ${email}. Úsalo la próxima vez que inicies sesión`
    : state === 'step1'
      ? 'Falta confirmar el enlace que enviamos a la otra dirección de correo para completar el cambio'
      : 'El enlace venció o ya se usó. Pide un nuevo cambio de correo desde Mi cuenta'

  return (
    <div className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-sm flex items-center justify-center px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md bg-[#111] border border-[#2a2a2a] rounded-2xl p-6 shadow-2xl slide-up">
        <h2 className="font-display font-black text-xl mb-3">{title}</h2>
        <p className="text-sm text-[#bbb] leading-relaxed">{text}</p>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => void confirm()}
          className="w-full mt-6 bg-[#2563eb] hover:bg-[#1d4ed8] py-3 rounded-xl font-display font-black"
        >
          Entendido
        </button>
      </div>
    </div>
  )
}
