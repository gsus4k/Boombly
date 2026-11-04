import { useCallback, useEffect, useState } from 'react'
import { SEED_RESTAURANTS } from './seed'
import type { Restaurant } from './types'
import { supabase } from '../lib/supabase'

// Capa de persistencia aislada: para escalar, reemplaza estas 2 funciones
// por llamadas a una API/base de datos sin tocar la UI.
const KEY = 'boombly:restaurants:v1'

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&h=400&fit=crop&auto=format'

function inferCategory(name: string): string {
  const normalized = name.toLowerCase()
  if (/pizza|pizzer/.test(normalized)) return 'pizza'
  if (/sushi|sakura/.test(normalized)) return 'sushi'
  if (/taco/.test(normalized)) return 'tacos'
  if (/ramen/.test(normalized)) return 'ramen'
  if (/burger|hamburg/.test(normalized)) return 'burgers'
  if (/dulce|postre|helad/.test(normalized)) return 'desserts'
  if (/bebida|café|coffee|jugos/.test(normalized)) return 'drinks'
  return 'all'
}

function load(): Restaurant[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as Restaurant[]
  } catch {
    /* ignore */
  }
  return SEED_RESTAURANTS
}

function save(list: Restaurant[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function useRestaurants() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>(load)

  useEffect(() => {
    let cancelled = false

    const syncAvailability = async () => {
      const { data, error } = await supabase
        .from('restaurante')
        .select('*, detalle_producto(precio, disponible, producto(*))')
      if (cancelled || error || !data) return

      setRestaurants(current => {
        const mapped = data.map((row, index) => {
          const remoteName = String(row.nombre ?? '').trim()
          const existing = current.find(restaurant =>
            restaurant.id === row.id_restaurante ||
            restaurant.name.trim().toLowerCase() === remoteName.toLowerCase(),
          ) ?? SEED_RESTAURANTS.find(restaurant =>
            restaurant.name.trim().toLowerCase() === remoteName.toLowerCase(),
          )
          const items = (row.detalle_producto ?? [])
            .map((detail: {
              precio: number | string
              disponible: boolean
              producto: { nombre?: string; imagen_url?: string } | Array<{ nombre?: string; imagen_url?: string }> | null
            }) => {
              const product = Array.isArray(detail.producto) ? detail.producto[0] : detail.producto
              if (!product?.nombre) return null
              return {
                name: product.nombre,
                price: Number(detail.precio),
                img: product.imagen_url ?? undefined,
                available: detail.disponible !== false,
              }
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)

          return {
            id: String(row.id_restaurante),
            name: remoteName,
            category: existing?.category ?? inferCategory(remoteName),
            rating: Number(row.calificacion_base ?? existing?.rating ?? 4.5),
            time: String(row.tiempo_estimado ?? existing?.time ?? '20–30 min'),
            deliveryFee: existing?.deliveryFee ?? 0,
            tag: row.etiqueta ?? existing?.tag ?? null,
            img: row.imagen_url ?? existing?.img ?? FALLBACK_IMAGE,
            items: items.length > 0 ? items : existing?.items ?? [],
            active: row.activo !== false,
            pagoMovil: row.pm_banco || row.pm_telefono || row.pm_cedula_rif ? {
              banco: String(row.pm_banco ?? ''),
              telefono: String(row.pm_telefono ?? ''),
              cedula: String(row.pm_cedula_rif ?? ''),
            } : existing?.pagoMovil,
            whatsapp: row.telefono ?? existing?.whatsapp,
            lat: row.lat == null ? existing?.lat : Number(row.lat),
            lng: row.lng == null ? existing?.lng : Number(row.lng),
            createdAt: existing?.createdAt ?? -(Date.now() + index),
          } as Restaurant
        })

        return mapped.length > 0 ? mapped : current
      })
    }

    void syncAvailability()
    const refreshInterval = window.setInterval(() => {
      void syncAvailability()
    }, 2000)
    const refreshOnAvailabilityChange = () => {
      void syncAvailability()
    }
    window.addEventListener('boombly:products-updated', refreshOnAvailabilityChange)
    const channel = supabase.channel('restaurant-product-availability')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'detalle_producto' }, () => {
        void syncAvailability()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurante' }, () => {
        void syncAvailability()
      })
      .subscribe()

    return () => {
      cancelled = true
      window.clearInterval(refreshInterval)
      window.removeEventListener('boombly:products-updated', refreshOnAvailabilityChange)
      void supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    save(restaurants)
  }, [restaurants])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setRestaurants(load())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const add = useCallback((data: Omit<Restaurant, 'id' | 'createdAt'>) => {
    setRestaurants(prev => [{ ...data, id: crypto.randomUUID(), createdAt: Date.now() }, ...prev])
  }, [])

  const update = useCallback((id: string, data: Partial<Restaurant>) => {
    setRestaurants(prev => prev.map(r => (r.id === id ? { ...r, ...data } : r)))
  }, [])

  const remove = useCallback((id: string) => {
    setRestaurants(prev => prev.filter(r => r.id !== id))
  }, [])

  return { restaurants, add, update, remove }
}
