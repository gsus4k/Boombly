import type { Restaurant } from './types'

// ───────── TARIFAS DE ENVÍO (edita aquí) ─────────
export const DELIVERY = {
  MIN_FEE: 2, // USD: tarifa mínima de cualquier envío
  INCLUDED_KM: 3, // km de ruta cubiertos por la tarifa mínima
  PER_KM: 0.4, // USD por cada km adicional
  MAX_KM: 100, // radio máximo de cobertura (en línea recta desde el restaurante)
}

// Punto de salida por defecto si el restaurante no tiene coordenadas (centro de Barquisimeto).
export const DEFAULT_ORIGIN = { lat: 10.0678, lng: -69.3467 }

// Servidor de rutas. El demo público de OSRM es solo para pruebas; en producción usa tu propio OSRM,
// OpenRouteService o Google Directions (misma idea: pedir la distancia por carretera).
const OSRM_URL = (import.meta.env.VITE_OSRM_URL as string | undefined) ?? 'https://router.project-osrm.org'
// Si el servicio de rutas falla, la línea recta se multiplica por este factor (las rutas reales son más largas).
const DETOUR_FACTOR = 1.3

type Point = { lat: number; lng: number }

// Distancia en línea recta (Haversine), en km.
export function haversineKm(a: Point, b: Point): number {
  const R = 6371
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export const feeForKm = (km: number) =>
  Math.round(Math.max(DELIVERY.MIN_FEE, DELIVERY.MIN_FEE + Math.max(0, km - DELIVERY.INCLUDED_KM) * DELIVERY.PER_KM) * 100) / 100

// exact = distancia real por carretera; false = estimada (el servicio de rutas no respondió).
export type DeliveryQuote = { km: number; fee: number; outOfRange: boolean; exact: boolean }

const cache = new Map<string, number>()

async function routeKm(a: Point, b: Point): Promise<number> {
  const key = [a.lat, a.lng, b.lat, b.lng].map(n => n.toFixed(4)).join(',')
  const hit = cache.get(key)
  if (hit != null) return hit
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const url = `${OSRM_URL}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`
    const r = await fetch(url, { signal: ctrl.signal })
    const j = await r.json()
    const meters = j?.routes?.[0]?.distance
    if (j?.code !== 'Ok' || typeof meters !== 'number') throw new Error('sin ruta')
    cache.set(key, meters / 1000)
    return meters / 1000
  } finally {
    clearTimeout(timer)
  }
}

export async function quoteDelivery(restaurant: Pick<Restaurant, 'lat' | 'lng'> | undefined, customer: Point): Promise<DeliveryQuote> {
  const origin =
    restaurant && typeof restaurant.lat === 'number' && typeof restaurant.lng === 'number'
      ? { lat: restaurant.lat, lng: restaurant.lng }
      : DEFAULT_ORIGIN
  const straight = haversineKm(origin, customer)
  const outOfRange = straight > DELIVERY.MAX_KM
  if (outOfRange) return { km: straight, fee: feeForKm(straight), outOfRange, exact: false }
  try {
    const km = await routeKm(origin, customer)
    return { km, fee: feeForKm(km), outOfRange, exact: true }
  } catch {
    const km = straight * DETOUR_FACTOR
    return { km, fee: feeForKm(km), outOfRange, exact: false }
  }
}
