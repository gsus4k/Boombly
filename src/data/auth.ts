import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useAdminAuth() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [currentUser, setCurrentUser] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setLoggedIn(Boolean(data.session))
      setCurrentUser(data.session?.user.email ?? '')
    })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoggedIn(Boolean(session))
      setCurrentUser(session?.user.email ?? '')
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const login = async (email: string, pass: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass })
    if (error) throw error
    setLoggedIn(Boolean(data.session))
    setCurrentUser(data.user?.email ?? '')
    return Boolean(data.session)
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setLoggedIn(false)
    setCurrentUser('')
  }

  return { loggedIn, login, logout, currentUser }
}
