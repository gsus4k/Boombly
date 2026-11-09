import { useCallback, useEffect, useState } from 'react'

export type Driver = { id: string; name: string; phone: string; active: boolean }

const DRIVERS_KEY = 'boombly:drivers:v1'

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

export function loadDrivers(): Driver[] {
  return readJson<Driver[]>(DRIVERS_KEY) ?? []
}

export function useSettings() {
  const [drivers, setDrivers] = useState<Driver[]>(loadDrivers)

  useEffect(() => {
    localStorage.setItem(DRIVERS_KEY, JSON.stringify(drivers))
  }, [drivers])

  const addDriver = useCallback((driver: Omit<Driver, 'id'>) => {
    setDrivers(prev => [...prev, { ...driver, id: crypto.randomUUID() }])
  }, [])

  const updateDriver = useCallback((id: string, patch: Partial<Driver>) => {
    setDrivers(prev => prev.map(driver => driver.id === id ? { ...driver, ...patch } : driver))
  }, [])

  const removeDriver = useCallback((id: string) => {
    setDrivers(prev => prev.filter(driver => driver.id !== id))
  }, [])

  return { drivers, addDriver, updateDriver, removeDriver }
}
