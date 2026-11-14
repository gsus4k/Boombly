import { useRef, useState } from 'react'
import type { AuthResult, Customer } from '../data/customer'

const inputCls =
  'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-3 text-sm outline-none focus:border-[#2563eb] transition-colors placeholder:text-[#555]'
const labelCls = 'block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-1.5'

export default function CustomerAuth({
  onRegister,
  onLogin,
  onDone,
  onClose,
  notice,
}: {
  onRegister: (name: string, phone: string) => Promise<AuthResult>
  onLogin: (code: string, phone: string) => Promise<AuthResult>
  onDone: (c: Customer) => void
  onClose: () => void
  notice?: string
}) {
  const [mode, setMode] = useState<'register' | 'login'>('register')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [created, setCreated] = useState<Customer | null>(null)
  const submitLock = useRef(false)
  const copyLock = useRef(false)
  const doneLock = useRef(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitLock.current) return
    submitLock.current = true
    setBusy(true)
    setError('')
    try {
      const result = mode === 'register'
        ? await onRegister(name, phone)
        : await onLogin(code.trim().toUpperCase(), phone)
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (mode === 'register') setCreated(result.customer)
      else onDone(result.customer)
    } catch (submitError) {
      console.error(`[cliente] ${mode === 'register' ? 'registrar' : 'entrar'}`, submitError)
      setError('No se pudo completar la operación. Intenta de nuevo.')
    } finally {
      submitLock.current = false
      setBusy(false)
    }
  }

  const copyCode = async () => {
    if (!created || copyLock.current) return
    copyLock.current = true
    setBusy(true)
    setError('')
    try {
      await navigator.clipboard.writeText(created.id)
      setCopied(true)
    } catch (copyError) {
      console.error('[cliente] copiar código', copyError)
      setError('No se pudo copiar el código. Puedes seleccionarlo y copiarlo manualmente.')
    } finally {
      copyLock.current = false
      setBusy(false)
    }
  }

  const finish = () => {
    if (!created || doneLock.current) return
    doneLock.current = true
    onDone(created)
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={() => { if (!created && !busy) onClose() }}
    >
      <div className="w-full max-w-md max-h-[92dvh] overflow-y-auto bg-[#111] border border-[#1e1e1e] rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] slide-up" onClick={e => e.stopPropagation()}>
        {created ? (
          <div className="text-center">
            <div className="text-5xl mb-3">🎉</div>
            <h2 className="font-display font-black text-xl">Tu código de cliente: {created.id}</h2>
            <p className="text-[#888] text-sm mt-1">Guárdalo: lo necesitas junto con tu teléfono para entrar desde otro dispositivo</p>
            <p className="font-mono font-black text-3xl text-[#3b82f6] bg-[#2563eb]/10 border border-[#2563eb]/30 rounded-2xl py-4 my-5">{created.id}</p>
            {error && <p role="alert" className="text-red-400 text-xs mb-3">{error}</p>}
            <button type="button" disabled={busy} onClick={() => void copyCode()} className="w-full border border-[#2a2a2a] hover:border-[#2563eb] disabled:opacity-60 transition-colors py-3 rounded-xl font-display font-bold">
              {copied ? 'Copiado' : 'Copiar'}
            </button>
            <button type="button" disabled={busy} onClick={finish} className="w-full mt-3 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-60 transition-colors py-3.5 rounded-xl font-display font-black">
              Entendido
            </button>
          </div>
        ) : (
          <form onSubmit={event => void submit(event)}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-black text-xl">{mode === 'register' ? 'Crea tu cuenta' : 'Inicia sesión'}</h2>
              <button type="button" disabled={busy} onClick={onClose} aria-label="Cerrar" className="text-[#555] hover:text-white disabled:opacity-60 text-xl">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-1 bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl p-1 mb-5">
              {(['register', 'login'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  disabled={busy}
                  onClick={() => { setMode(m); setError('') }}
                  className={`py-2 rounded-lg text-sm font-display font-semibold transition-colors disabled:opacity-60 ${mode === m ? 'bg-[#2563eb] text-white' : 'text-[#888] hover:text-white'}`}
                >
                  {m === 'register' ? 'Registrarme' : 'Ya tengo cuenta'}
                </button>
              ))}
            </div>
            {notice && <p role="alert" className="text-red-400 text-xs mb-3">{notice}</p>}

            {mode === 'register' ? (
              <>
                <label className={labelCls}>Nombre completo</label>
                <input disabled={busy} className={`${inputCls} mb-4 disabled:opacity-60`} value={name} onChange={e => setName(e.target.value)} placeholder="Ej: María Pérez" autoFocus />
              </>
            ) : (
              <>
                <label className={labelCls}>Código de cliente</label>
                <input disabled={busy} className={`${inputCls} mb-4 font-mono uppercase disabled:opacity-60`} value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="CL-XXXXXX" autoFocus />
              </>
            )}

            <label className={labelCls}>Teléfono</label>
            <input
              className={inputCls}
              disabled={busy}
              aria-disabled={busy}
              value={phone}
              onChange={e => setPhone(e.target.value.replace(/[^\d+\- ]/g, '').slice(0, 16))}
              inputMode="tel"
              placeholder="0414-1234567"
            />
            {error && <p role="alert" className="text-red-400 text-xs mt-3">{error}</p>}
            <button type="submit" disabled={busy} className="w-full mt-5 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-60 transition-colors py-3.5 rounded-xl font-display font-black">
              {busy ? 'Procesando…' : mode === 'register' ? 'Registrarme y obtener mi código' : 'Entrar'}
            </button>
            <p className="text-[11px] text-[#555] text-center mt-3">
              Tu código de cliente identifica tus pedidos y permite al restaurante contactarte.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
