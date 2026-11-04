// Registro de clientes: cada cliente se registra una vez y recibe un código único (CL-XXXXXX).
// Persistencia aislada (reemplazable por una API de registro/login).
import { useCallback, useEffect, useState } from 'react'

export type Customer = { id: string; name: string; phone: string; createdAt: number }

const CUSTOMERS_KEY = 'boombly:customers:v2'
const SESSION_KEY = 'boombly:session:v2'

export const phoneDigits = (v: string) => v.replace(/\D/g, '')
export const isValidPhone = (v: string) => phoneDigits(v).length >= 10

function loadAll(): Customer[] {
  try {
    const raw = localStorage.getItem(CUSTOMERS_KEY)
    if (raw) return JSON.parse(raw) as Customer[]
  } catch {
    /* ignore */
  }
  return []
}

const loadSession = () => localStorage.getItem(SESSION_KEY)

const newCode = (taken: Set<string>) => {
  let id: string
  do id = `CL-${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`
  while (taken.has(id))
  return id
}

export type AuthResult = { ok: true; customer: Customer } | { ok: false; error: string }

export function useCustomers() {
  const [customers, setCustomers] = useState<Customer[]>(loadAll)
  const [sessionId, setSessionId] = useState<string | null>(loadSession)

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === CUSTOMERS_KEY) setCustomers(loadAll())
      if (e.key === SESSION_KEY) setSessionId(loadSession())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const startSession = (id: string) => {
    localStorage.setItem(SESSION_KEY, id)
    setSessionId(id)
  }

  const register = useCallback((name: string, phone: string): AuthResult => {
    const all = loadAll()
    const digits = phoneDigits(phone)
    if (name.trim().length < 2) return { ok: false, error: 'Escribe tu nombre completo.' }
    if (!isValidPhone(phone)) return { ok: false, error: 'Escribe un teléfono válido (mínimo 10 dígitos).' }
    if (all.some(c => phoneDigits(c.phone) === digits)) {
      return { ok: false, error: 'Ese teléfono ya está registrado. Usa "Ya tengo cuenta" con tu código de cliente.' }
    }
    const customer: Customer = {
      id: newCode(new Set(all.map(c => c.id))),
      name: name.trim(),
      phone: phone.trim(),
      createdAt: Date.now(),
    }
    const next = [...all, customer]
    localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(next))
    setCustomers(next)
    startSession(customer.id)
    return { ok: true, customer }
  }, [])

  const login = useCallback((code: string, phone: string): AuthResult => {
    const c = loadAll().find(x => x.id === code.trim().toUpperCase() && phoneDigits(x.phone) === phoneDigits(phone))
    if (!c) return { ok: false, error: 'No encontramos un cliente con ese código y teléfono.' }
    startSession(c.id)
    return { ok: true, customer: c }
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY)
    setSessionId(null)
  }, [])

  const current = customers.find(c => c.id === sessionId) ?? null

  return { customers, current, register, login, logout }
}
