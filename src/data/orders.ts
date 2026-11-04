import { useCallback, useEffect, useState } from 'react'
import type { Payment } from './payment'

export type OrderLine = { name: string; price: number; qty: number }

export type OrderStatus = 'recibido' | 'preparado' | 'enviado' | 'entregado' | 'cancelado'

export const STATUS_FLOW: OrderStatus[] = ['recibido', 'preparado', 'enviado', 'entregado']

export const STATUS_META: Record<OrderStatus, { label: string; emoji: string; cls: string }> = {
  recibido: { label: 'Recibido', emoji: '📥', cls: 'bg-blue-500/15 text-blue-400' },
  preparado: { label: 'Preparado', emoji: '👨‍🍳', cls: 'bg-yellow-500/15 text-yellow-400' },
  enviado: { label: 'Enviado', emoji: '🛵', cls: 'bg-purple-500/15 text-purple-400' },
  entregado: { label: 'Entregado', emoji: '✅', cls: 'bg-green-500/15 text-green-400' },
  cancelado: { label: 'Cancelado', emoji: '✕', cls: 'bg-red-500/15 text-red-400' },
}

export type OrderLocation = { lat: number; lng: number; accuracy: number }

export type Order = {
  id: string
  restaurantId: string
  restaurantName: string
  createdAt: number
  items: OrderLine[]
  subtotal: number
  deliveryFee: number
  distanceKm?: number
  total: number
  status: OrderStatus
  rating?: number
  review?: string
  customerId: string
  customerName: string
  customerPhone: string
  location?: OrderLocation
  payment?: Payment
}

// Persistencia aislada (igual que restaurantes): reemplazable por una API.
const KEY = 'boombly:orders:v1'

function load(): Order[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as Order[]
  } catch {
    /* ignore */
  }
  return []
}

export function useOrders() {
  const [orders, setOrders] = useState<Order[]>(load)

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(orders))
  }, [orders])

  // Sincroniza entre pestañas/ventanas: lo que cambia el admin lo ve el cliente al instante.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setOrders(load())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const addMany = useCallback((list: Omit<Order, 'id' | 'createdAt' | 'status'>[]): Order[] => {
    const now = Date.now()
    const taken = new Set(load().map(o => o.id))
    const created = list.map(o => {
      let id: string
      do id = `BB-${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`
      while (taken.has(id))
      taken.add(id)
      return { ...o, id, createdAt: now, status: 'recibido' as const }
    })
    setOrders(prev => [...created, ...prev])
    return created
  }, [])

  const setStatus = useCallback((id: string, status: OrderStatus) => {
    setOrders(prev => prev.map(o => (o.id === id ? { ...o, status } : o)))
  }, [])

  const rate = useCallback((id: string, rating: number, review: string) => {
    setOrders(prev => prev.map(o => (o.id === id ? { ...o, rating, review: review.trim() || undefined } : o)))
  }, [])

  return { orders, addMany, setStatus, rate }
}

// Calificación mostrada = valoración base del restaurante ponderada con las reseñas reales de clientes.
const BASE_WEIGHT = 10
export function displayRating(base: number, orders: Order[], restaurantId: string) {
  const rated = orders.filter(o => o.restaurantId === restaurantId && o.rating)
  const sum = rated.reduce((s, o) => s + (o.rating ?? 0), 0)
  return { value: (base * BASE_WEIGHT + sum) / (BASE_WEIGHT + rated.length), count: rated.length }
}
