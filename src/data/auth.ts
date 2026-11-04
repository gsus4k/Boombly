import { useState } from 'react'

// Autenticación del lado del cliente (demo). Para producción, valida en un backend.
const CRED_KEY = 'boombly:admin:cred'
const SESSION_KEY = 'boombly:admin:session'
const DEFAULT_CRED = { user: 'admin', pass: 'boombly2026' }

type Cred = { user: string; pass: string }

function getCred(): Cred {
  try {
    const raw = localStorage.getItem(CRED_KEY)
    if (raw) return JSON.parse(raw) as Cred
  } catch {
    /* ignore */
  }
  return DEFAULT_CRED
}

export function useAdminAuth() {
  const [loggedIn, setLoggedIn] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1')

  const login = (user: string, pass: string) => {
    const c = getCred()
    const ok = user.trim() === c.user && pass === c.pass
    if (ok) {
      sessionStorage.setItem(SESSION_KEY, '1')
      setLoggedIn(true)
    }
    return ok
  }

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY)
    setLoggedIn(false)
  }

  const changeCredentials = (user: string, pass: string) => {
    localStorage.setItem(CRED_KEY, JSON.stringify({ user: user.trim(), pass }))
  }

  return { loggedIn, login, logout, changeCredentials, currentUser: getCred().user }
}
