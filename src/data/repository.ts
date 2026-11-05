import { useCallback, useEffect, useState } from 'react'
import type { Restaurant } from './types'
import { supabase } from '../lib/supabase'
import { eliminarRestaurante } from '../lib/productos'

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&h=400&fit=crop&auto=format'

export function useRestaurants() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])

  const syncAvailability = useCallback(async () => {
    const { data, error } = await supabase
      .from('restaurante')
      .select('*, detalle_producto(precio, disponible, producto(*))')
    if (error) {
      console.error('[restaurants] cargar', error)
      return
    }

    const mapped = (data ?? []).map((row, index) => ({
      id: String(row.id_restaurante),
      name: String(row.nombre ?? '').trim(),
      category: inferCategory(String(row.nombre ?? '')),
      rating: Number(row.calificacion_base ?? 4.5),
      time: String(row.tiempo_estimado ?? '20–30 min'),
      deliveryFee: 0,
      tag: row.etiqueta ?? null,
      img: row.imagen_url ?? FALLBACK_IMAGE,
      items: (row.detalle_producto ?? []).flatMap((detail: {
        precio: number | string
        disponible: boolean
        producto: { nombre?: string; descripcion?: string; imagen_url?: string } | Array<{ nombre?: string; descripcion?: string; imagen_url?: string }> | null
      }) => {
        const product = Array.isArray(detail.producto) ? detail.producto[0] : detail.producto
        if (!product?.nombre) return []
        return [{
          name: product.nombre,
          description: product.descripcion ?? undefined,
          price: Number(detail.precio),
          img: product.imagen_url ?? undefined,
          available: detail.disponible !== false,
        }]
      }),
      active: row.activo !== false,
      pagoMovil: row.pm_banco || row.pm_telefono || row.pm_cedula_rif ? {
        banco: String(row.pm_banco ?? ''),
        telefono: String(row.pm_telefono ?? ''),
        cedula: String(row.pm_cedula_rif ?? ''),
      } : undefined,
      whatsapp: row.telefono ?? undefined,
      lat: row.lat == null ? undefined : Number(row.lat),
      lng: row.lng == null ? undefined : Number(row.lng),
      createdAt: -(Date.now() + index),
    })) as Restaurant[]

    setRestaurants(mapped)
  }, [])

  useEffect(() => {
    void syncAvailability()
    const interval = window.setInterval(() => { void syncAvailability() }, 5000)
    const channel = supabase.channel('restaurant-catalog')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'detalle_producto' }, () => { void syncAvailability() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'producto' }, () => { void syncAvailability() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurante' }, () => { void syncAvailability() })
      .subscribe()

    return () => {
      window.clearInterval(interval)
      void supabase.removeChannel(channel)
    }
  }, [syncAvailability])

  const reload = useCallback(async () => {
    await syncAvailability()
  }, [syncAvailability])

  const add = useCallback(async (data: Omit<Restaurant, 'id' | 'createdAt'>) => {
    const { data: session } = await supabase.auth.getSession()
    const userId = session.session?.user.id
    if (!userId) throw new Error('Inicia sesión como administrador')
    const { data: category } = await supabase.from('categoria').select('id_categoria').ilike('nombre', data.category).limit(1).maybeSingle()
    const phone = data.whatsapp?.replace(/\D/g, '') || `0412${String(Date.now()).slice(-7)}`
    const { error } = await supabase.from('restaurante').insert({
      id_admin: userId,
      id_categoria: category?.id_categoria ?? 1,
      nombre: data.name,
      telefono: phone.length >= 10 && phone.length <= 15 ? phone : `0412${String(Date.now()).slice(-7)}`,
      lat: data.lat ?? 10.0678,
      lng: data.lng ?? -69.3467,
      tiempo_estimado: data.time,
      etiqueta: data.tag,
      imagen_url: data.img,
      calificacion_base: data.rating,
      activo: data.active,
      pm_banco: data.pagoMovil?.banco || null,
      pm_telefono: data.pagoMovil?.telefono || null,
      pm_cedula_rif: data.pagoMovil?.cedula || null,
    })
    if (error) throw error
    await syncAvailability()
  }, [syncAvailability])

  const update = useCallback(async (id: string, data: Partial<Restaurant>) => {
    const payload: Record<string, unknown> = {}
    if (data.active !== undefined) payload.activo = data.active
    if (data.name !== undefined) payload.nombre = data.name
    if (data.time !== undefined) payload.tiempo_estimado = data.time
    if (data.tag !== undefined) payload.etiqueta = data.tag
    if (data.img !== undefined) payload.imagen_url = data.img
    if (data.rating !== undefined) payload.calificacion_base = data.rating
    if (data.lat !== undefined) payload.lat = data.lat
    if (data.lng !== undefined) payload.lng = data.lng
    if (data.whatsapp !== undefined) payload.telefono = data.whatsapp.replace(/\D/g, '')
    const { error } = await supabase.from('restaurante').update(payload).eq('id_restaurante', id)
    if (error) throw error
    await syncAvailability()
  }, [syncAvailability])

  const remove = useCallback(async (id: string) => {
    const data = await eliminarRestaurante(id)
    await syncAvailability()
    return String(data)
  }, [syncAvailability])

  return { restaurants, reload, add, update, remove }
}

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
