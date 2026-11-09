import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export function isExpiredSessionError(value: unknown) {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : ''
  return /permission denied|auth session missing/i.test(message)
}

export function useAdminAuth() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [currentUser, setCurrentUser] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [roleChecked, setRoleChecked] = useState(false)
  const [sessionNotice, setSessionNotice] = useState('')
  const [expired, setExpired] = useState(false)
  const previousSession = useRef<{ email: string; role: string | null } | null>(null)

  const loadSession = async () => {
    setRoleChecked(false)
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      if (userError && isExpiredSessionError(userError.message)) setExpired(true)
      setLoggedIn(false)
      setCurrentUser('')
      setRole(null)
      setRoleChecked(true)
      previousSession.current = null
      return
    }
    let roleData: unknown = null
    let roleError: { message: string } | null = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await supabase.rpc('mi_rol')
      roleError = result.error
      const { data, error } = result
      if (!error && typeof data === 'string') {
        roleData = data
        break
      }
      await new Promise(resolve => window.setTimeout(resolve, 150))
    }
    if (roleError && isExpiredSessionError(roleError.message)) {
      setExpired(true)
      setLoggedIn(false)
      setCurrentUser('')
      setRole(null)
      setRoleChecked(true)
      previousSession.current = null
      return
    }
    setLoggedIn(true)
    const nextEmail = userData.user.email ?? ''
    const nextRole = typeof roleData === 'string' ? roleData : null
    const previous = previousSession.current
    if (previous && (previous.email !== nextEmail || previous.role !== nextRole)) {
      setSessionNotice(`La sesión cambió en otra ventana: ahora eres ${nextEmail} (${nextRole ?? 'sin rol'})`)
    }
    previousSession.current = { email: nextEmail, role: nextRole }
    setCurrentUser(nextEmail)
    setRole(nextRole)
    setExpired(false)
    setRoleChecked(true)
  }

  useEffect(() => {
    void loadSession()
    const refresh = () => { void loadSession() }
    window.addEventListener('boombly:auth-changed', refresh)
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED', 'TOKEN_REFRESHED'].includes(event)) {
        window.setTimeout(() => { void loadSession() }, 0)
      }
    })
    return () => {
      window.removeEventListener('boombly:auth-changed', refresh)
      data.subscription.unsubscribe()
    }
  }, [])

  const login = async (email: string, pass: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass })
    if (error) throw error
    const { data: userData } = await supabase.auth.getUser()
    const { data: roleData, error: roleError } = await supabase.rpc('mi_rol')
    if (roleError) throw roleError
    setLoggedIn(Boolean(data.session))
    setCurrentUser(userData.user?.email ?? data.user?.email ?? '')
    setRole(typeof roleData === 'string' ? roleData : null)
    setRoleChecked(true)
    setExpired(false)
    return Boolean(data.session)
  }

  const logout = async () => {
    await supabase.auth.signOut({ scope: 'local' })
    setLoggedIn(false)
    setCurrentUser('')
    setRole(null)
    setRoleChecked(true)
    setSessionNotice('')
    setExpired(false)
    previousSession.current = null
  }

  return { loggedIn, login, logout, currentUser, role, roleChecked, refreshRole: loadSession, sessionNotice, expired }
}
