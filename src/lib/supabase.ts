import { createClient } from '@supabase/supabase-js'

// Estas dos variables son PÚBLICAS por diseño (la seguridad la da RLS en la base de datos).
// NUNCA pongas aquí la "secret key" ni la "service_role": esas solo viven en la Edge Function.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

export const supabaseConfigurado = Boolean(url && key)

export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'sin-configurar', {
  auth: { persistSession: true, autoRefreshToken: true },
})

// Llama a la Edge Function que crea el pedido de forma segura (recalcula precios y envío en el servidor).
export type NuevoPedido = {
  codigo: string // código del cliente, p. ej. CL-A1B2C3
  telefono: string // teléfono del cliente (formato internacional, sin "+")
  id_restaurante: string
  lat: number
  lng: number
  precision_m?: number
  items: { id_producto: string; cantidad: number }[]
  referencia: string // referencia del pago móvil
  comprobante_path?: string // ruta en Storage (bucket "comprobantes")
}

export async function crearPedido(p: NuevoPedido) {
  if (!supabaseConfigurado) throw new Error('Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en .env')
  const r = await fetch(`${url}/functions/v1/crear-pedido`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key! },
    body: JSON.stringify(p),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`)
  return j as { ok: true; pedido: { codigo: string; subtotal: number; costo_envio: number; total: number; distancia_km: number }; avisos: { restaurante: boolean; repartidor: boolean } }
}
