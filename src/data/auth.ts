import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useAdminAuth() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [currentUser, setCurrentUser] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [roleChecked, setRoleChecked] = useState(false)

  const loadSession = async () => {
    setRoleChecked(false)
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      setLoggedIn(false)
      setCurrentUser('')
      setRole(null)
      setRoleChecked(true)
      return
    }
    const { data: userData } = await supabase.auth.getUser()
    let roleData: unknown = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data, error } = await supabase.rpc('mi_rol')
      if (!error && typeof data === 'string') {
        roleData = data
        break
      }
      await new Promise(resolve => window.setTimeout(resolve, 150))
    }
    setLoggedIn(true)
    setCurrentUser(userData.user?.email ?? data.session.user.email ?? '')
    setRole(typeof roleData === 'string' ? roleData : null)
    setRoleChecked(true)
  }

  useEffect(() => {
    void loadSession()
    const refresh = () => { void loadSession() }
    window.addEventListener('boombly:auth-changed', refresh)
    return () => window.removeEventListener('boombly:auth-changed', refresh)
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
    return Boolean(data.session)
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setLoggedIn(false)
    setCurrentUser('')
    setRole(null)
    setRoleChecked(true)
  }

  return { loggedIn, login, logout, currentUser, role, roleChecked, refreshRole: loadSession }
}
