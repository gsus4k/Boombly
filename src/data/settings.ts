import { useCallback, useEffect, useState } from 'react'
import { CATEGORIES as SEED_CATEGORIES } from './seed'
import type { Category } from './types'

export type Driver = { id: string; name: string; phone: string; active: boolean }

const CATEGORIES_KEY = 'boombly:categories:v1'
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
  const [categories, setCategories] = useState<Category[]>(() => readJson<Category[]>(CATEGORIES_KEY) ?? SEED_CATEGORIES)
  const [drivers, setDrivers] = useState<Driver[]>(loadDrivers)

  useEffect(() => {
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories))
  }, [categories])

  useEffect(() => {
    localStorage.setItem(DRIVERS_KEY, JSON.stringify(drivers))
  }, [drivers])

  const addCategory = useCallback((category: Omit<Category, 'id'>) => {
    setCategories(prev => [...prev, { ...category, id: crypto.randomUUID() }])
  }, [])

  const removeCategory = useCallback((id: string) => {
    if (id === 'all') return
    setCategories(prev => prev.filter(category => category.id !== id))
  }, [])

  const addDriver = useCallback((driver: Omit<Driver, 'id'>) => {
    setDrivers(prev => [...prev, { ...driver, id: crypto.randomUUID() }])
  }, [])

  const updateDriver = useCallback((id: string, patch: Partial<Driver>) => {
    setDrivers(prev => prev.map(driver => driver.id === id ? { ...driver, ...patch } : driver))
  }, [])

  const removeDriver = useCallback((id: string) => {
    setDrivers(prev => prev.filter(driver => driver.id !== id))
  }, [])

  return { categories, drivers, addCategory, removeCategory, addDriver, updateDriver, removeDriver }
}
