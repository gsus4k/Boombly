import type { Order } from './orders'
import { loadDrivers } from './settings'

export const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`

export function buildOrderMessage(order: Order): string {
  const lines = order.items.map(i => `• ${i.qty}× ${i.name} — $ ${(i.qty * i.price).toFixed(2)}`)
  return [
    `🛵 *Nuevo pedido Boombly* (${order.id})`,
    `🍽️ Restaurante: ${order.restaurantName}`,
    `👤 Cliente: ${order.customerName} (${order.customerId})`,
    `📱 Teléfono: ${order.customerPhone}`,
    order.location ? `📍 Ubicación: ${mapsUrl(order.location.lat, order.location.lng)}` : '',
    order.payment ? `💳 Pago móvil — Ref: ${order.payment.reference} (capture adjunto en el pedido)` : '',
    '',
    ...lines,
    '',
    `Subtotal: $ ${order.subtotal.toFixed(2)}`,
    `Envío${order.distanceKm != null ? ` (${order.distanceKm.toFixed(1)} km)` : ''}: $ ${order.deliveryFee.toFixed(2)}`,
    `*Total: $ ${order.total.toFixed(2)}*`,
  ]
    .filter((l, i, arr) => l !== '' || arr[i - 1] !== '')
    .join('\n')
}

// Normaliza un teléfono venezolano a formato internacional sin "+": 0412-1234567 → 584121234567
export function toIntl(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.startsWith('58') && d.length >= 12) return d
  if (d.startsWith('0')) return '58' + d.slice(1)
  if (d.length === 10) return '58' + d
  return d
}

// Mensaje para el repartidor: dónde recoger, a quién entregar y el enlace de la ubicación.
export function buildDriverMessage(order: Order): string {
  const units = order.items.reduce((s, i) => s + i.qty, 0)
  return [
    `🛵 *Entrega asignada Boombly* (${order.id})`,
    `🍽️ Recoger en: ${order.restaurantName} (${units} ${units === 1 ? 'producto' : 'productos'})`,
    `👤 Entregar a: ${order.customerName}`,
    `📱 Teléfono: ${order.customerPhone}`,
    order.location ? `📍 Destino: ${mapsUrl(order.location.lat, order.location.lng)}` : '',
    order.distanceKm != null ? `📏 Distancia: ${order.distanceKm.toFixed(1)} km` : '',
    `💵 Envío: $ ${order.deliveryFee.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join('\n')
}

// Compatibilidad con la configuración anterior; los repartidores administrados
// desde el panel tienen prioridad y se almacenan en el navegador.
const LEGACY_DRIVER_PHONES = ((import.meta.env.VITE_DRIVER_PHONES as string | undefined) ?? '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean)
const RR_KEY = 'boombly:driver:rr'

function nextDriver(): string | undefined {
  const managed = loadDrivers().filter(driver => driver.active && driver.phone.trim())
  const phones = managed.length > 0
    ? managed.map(driver => driver.phone.trim())
    : LEGACY_DRIVER_PHONES
  if (phones.length === 0) return undefined
  let i = 0
  try {
    i = (Number(localStorage.getItem(RR_KEY)) || 0) % phones.length
    localStorage.setItem(RR_KEY, String(i + 1))
  } catch {
    /* ignore */
  }
  return phones[i]
}

// PUNTO ÚNICO DE INTEGRACIÓN: se llama una vez por cada pedido confirmado.
// Envía DOS avisos: uno al restaurante (qué preparar y referencia de pago) y otro al repartidor (recoger y entregar).
// El frontend NO guarda ningún token: llama a tu backend (server/whatsapp-server.mjs).
const API_URL = import.meta.env.VITE_WHATSAPP_API_URL as string | undefined

export async function notifyOrderByWhatsApp(order: Order, restaurantPhone?: string): Promise<void> {
  const messages: { to: string; message: string }[] = []
  if (restaurantPhone) messages.push({ to: toIntl(restaurantPhone), message: buildOrderMessage(order) })
  const driver = nextDriver()
  if (driver) messages.push({ to: toIntl(driver), message: buildDriverMessage(order) })

  if (!API_URL || messages.length === 0) {
    console.info('[WhatsApp] no se envió (falta VITE_WHATSAPP_API_URL, WhatsApp del restaurante o VITE_DRIVER_PHONES)', messages)
    return
  }
  try {
    const r = await fetch(`${API_URL}/api/notify-order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) })
    if (!r.ok) throw new Error(String(r.status))
  } catch (e) {
    console.error('[WhatsApp] no se pudo notificar el pedido', order.id, e)
  }
}
