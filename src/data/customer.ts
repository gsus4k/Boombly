import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export type Customer = { id: string; name: string; phone: string }

type CustomerSession = { codigo: string; nombre: string; telefono: string }
type CustomerResponse = { ok: true; cliente: CustomerSession }
type CustomerAction =
  | { accion: 'registrar'; nombre: string; telefono: string }
  | { accion: 'entrar'; codigo: string; telefono: string }

const SESSION_KEY = 'boombly:session:v2'

export const phoneDigits = (v: string) => v.replace(/\D/g, '')
export const isValidPhone = (v: string) => phoneDigits(v).length >= 10

function fromSession(session: CustomerSession): Customer {
  return { id: session.codigo, name: session.nombre, phone: session.telefono }
}

function readSession(): { customer: Customer | null; invalid: boolean } {
  let raw: string | null
  try {
    raw = localStorage.getItem(SESSION_KEY)
  } catch (error) {
    console.error('[cliente] leer sesión', error)
    return { customer: null, invalid: true }
  }
  if (!raw) return { customer: null, invalid: false }

  try {
    const saved = JSON.parse(raw) as Partial<CustomerSession>
    if (
      typeof saved.codigo === 'string' &&
      typeof saved.nombre === 'string' &&
      typeof saved.telefono === 'string'
    ) {
      return { customer: fromSession(saved as CustomerSession), invalid: false }
    }

    throw new Error('La sesión guardada tiene un formato inválido.')
  } catch (error) {
    console.error('[cliente] leer sesión', error)
    try {
      localStorage.removeItem(SESSION_KEY)
    } catch (removeError) {
      console.error('[cliente] borrar sesión inválida', removeError)
    }
    return { customer: null, invalid: true }
  }
}

export type AuthResult = { ok: true; customer: Customer } | { ok: false; error: string }

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

async function requestCustomer(action: CustomerAction, operation: string): Promise<Customer> {
  const { data, error } = await supabase.functions.invoke<CustomerResponse>('registrar-cliente', { body: action })
  if (error) {
    if (error instanceof FunctionsFetchError) {
      console.error(`[cliente] ${operation}`, error)
      throw new Error('No se pudo contactar con el servidor: revisa tu conexión')
    }

    if (error instanceof FunctionsHttpError) {
      let body: { error?: string } | null
      try {
        body = await error.context.json() as { error?: string }
      } catch (parseError) {
        console.error(`[cliente] ${operation}`, parseError)
        throw new Error('No se pudo completar la operación. Intenta de nuevo.')
      }
      const message = typeof body?.error === 'string' ? body.error : 'No se pudo completar la operación.'
      console.error(`[cliente] ${operation}`, error)
      const httpError = new Error(message)
      Object.assign(httpError, { status: error.context.status })
      throw httpError
    }

    console.error(`[cliente] ${operation}`, error)
    throw new Error('No se pudo completar la operación. Intenta de nuevo.')
  }

  if (!data?.ok || !data.cliente?.codigo || !data.cliente.nombre || !data.cliente.telefono) {
    const invalidResponse = new Error('El servidor devolvió datos de cliente incompletos.')
    console.error(`[cliente] ${operation}`, invalidResponse)
    throw invalidResponse
  }

  return fromSession(data.cliente)
}

export function useCustomers() {
  const [initialSession] = useState(readSession)
  const [current, setCurrent] = useState<Customer | null>(initialSession.customer)
  const [notice, setNotice] = useState(initialSession.invalid ? 'Tu cuenta no se encontró: regístrate de nuevo o entra con tu código' : '')
  const validationRequest = useRef<Promise<Customer> | null>(null)
  const savedSession = useRef(initialSession.customer)

  const saveSession = useCallback((customer: Customer) => {
    const session: CustomerSession = {
      codigo: customer.id,
      nombre: customer.name,
      telefono: customer.phone,
    }
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    } catch (error) {
      console.error('[cliente] guardar sesión', error)
      throw new Error('El cliente fue validado, pero no se pudo guardar la sesión en este dispositivo.')
    }
    setCurrent(customer)
    setNotice('')
  }, [])

  const login = useCallback(async (code: string, phone: string): Promise<AuthResult> => {
    const normalizedCode = code.trim().toUpperCase()
    if (!normalizedCode || !isValidPhone(phone)) {
      const error = new Error('Escribe un código y un teléfono válidos.')
      console.error('[cliente] entrar', error)
      return { ok: false, error: error.message }
    }

    try {
      const customer = await requestCustomer(
        { accion: 'entrar', codigo: normalizedCode, telefono: phone.trim() },
        'entrar',
      )
      saveSession(customer)
      return { ok: true, customer }
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'No se pudo iniciar sesión.') }
    }
  }, [saveSession])

  const register = useCallback(async (name: string, phone: string): Promise<AuthResult> => {
    if (name.trim().length < 2 || !isValidPhone(phone)) {
      const error = new Error(name.trim().length < 2 ? 'Escribe tu nombre completo.' : 'Escribe un teléfono válido.')
      console.error('[cliente] registrar', error)
      return { ok: false, error: error.message }
    }

    try {
      const customer = await requestCustomer(
        { accion: 'registrar', nombre: name.trim(), telefono: phone.trim() },
        'registrar',
      )
      saveSession(customer)
      return { ok: true, customer }
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'No se pudo registrar el cliente.') }
    }
  }, [saveSession])

  const logout = useCallback((message = '') => {
    let nextNotice = message
    try {
      localStorage.removeItem(SESSION_KEY)
    } catch (error) {
      console.error('[cliente] cerrar sesión', error)
      nextNotice = 'No se pudo borrar la sesión guardada en este dispositivo.'
    }
    setCurrent(null)
    setNotice(nextNotice)
  }, [])

  useEffect(() => {
    const saved = savedSession.current
    if (!saved) return
    let active = true
    validationRequest.current ??= requestCustomer(
      { accion: 'entrar', codigo: saved.id, telefono: saved.phone },
      'validar sesión',
    )

    void validationRequest.current.then(customer => {
      if (active) setCurrent(customer)
    }).catch(error => {
      if (!active) return
      const status = (error as Error & { status?: number }).status
      if (status === 401) {
        logout('Tu cuenta no se encontró: regístrate de nuevo o entra con tu código')
      } else if (!(error instanceof Error && error.message === 'No se pudo contactar con el servidor: revisa tu conexión')) {
        setNotice(errorMessage(error, 'No se pudo verificar tu cuenta. Intenta de nuevo.'))
      }
    })

    return () => { active = false }
  }, [logout])

  return { current, register, login, logout, notice }
}
