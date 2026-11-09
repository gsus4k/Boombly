import { useCallback, useState } from 'react'
import type { Restaurant } from './types'
import { supabase } from '../lib/supabase'
import { eliminarRestaurante } from '../lib/productos'
import { useDatosEnVivo } from '../lib/useDatosEnVivo'

export function getRestaurantImageUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''

  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    const marker = '/storage/v1/object/public/restaurantes/'
    return url.pathname.includes(marker) && url.pathname.split(marker)[1] ? value : ''
  } catch {
    return ''
  }
}

export function useRestaurants() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loadError, setLoadError] = useState('')

  const syncAvailability = useCallback(async () => {
    const { data, error } = await supabase
      .from('restaurante')
      .select('*, categoria(nombre, emoji), detalle_producto(id_producto, precio, disponible, stock, producto(*))')
    if (error) {
      setLoadError(error.message)
      throw error
    }

    setLoadError('')
    const mapped = (data ?? []).map((row, index) => {
      const category = Array.isArray(row.categoria) ? row.categoria[0] : row.categoria
      return {
        id: String(row.id_restaurante),
        name: String(row.nombre ?? '').trim(),
        category: row.id_categoria == null ? '' : String(row.id_categoria),
        categoryName: category?.nombre ?? undefined,
        categoryEmoji: category?.emoji ?? null,
        rating: Number(row.calificacion_base ?? 4.5),
        time: String(row.tiempo_estimado ?? '20–30 min'),
        deliveryFee: 0,
        tag: row.etiqueta ?? null,
        img: getRestaurantImageUrl(row.imagen_url),
        items: (row.detalle_producto ?? []).flatMap((detail: {
          precio: number | string
          disponible: boolean
          id_producto?: string | number
          stock?: number | string | null
          producto: { nombre?: string; descripcion?: string; imagen_url?: string } | Array<{ nombre?: string; descripcion?: string; imagen_url?: string }> | null
        }) => {
          const product = Array.isArray(detail.producto) ? detail.producto[0] : detail.producto
          if (!product?.nombre) return []
          return [{
            id: detail.id_producto == null ? undefined : String(detail.id_producto),
            name: product.nombre,
            description: product.descripcion ?? undefined,
            price: Number(detail.precio),
            img: product.imagen_url ?? undefined,
            available: detail.disponible !== false,
            stock: detail.stock === null || detail.stock === undefined ? null : Number(detail.stock),
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
      }
    }) as Restaurant[]

    setRestaurants(mapped)
    return mapped
  }, [])

  const refreshLive = useCallback(async () => {
    await syncAvailability()
  }, [syncAvailability])

  useDatosEnVivo(refreshLive, ['restaurante', 'categoria', 'detalle_producto', 'producto'])

  const reload = useCallback(async () => {
    return await syncAvailability()
  }, [syncAvailability])

  const add = useCallback(async (data: Omit<Restaurant, 'id' | 'createdAt'>) => {
    const { data: session } = await supabase.auth.getSession()
    const userId = session.session?.user.id
    if (!userId) throw new Error('Inicia sesión como administrador')
    const categoryId = Number(data.category)
    if (!Number.isSafeInteger(categoryId) || categoryId <= 0) throw new Error('Selecciona una categoría válida.')
    const phone = data.whatsapp?.replace(/\D/g, '') || `0412${String(Date.now()).slice(-7)}`
    const { data: inserted, error } = await supabase.from('restaurante').insert({
      id_admin: userId,
      id_categoria: categoryId,
      nombre: data.name,
      telefono: phone.length >= 10 && phone.length <= 15 ? phone : `0412${String(Date.now()).slice(-7)}`,
      lat: data.lat ?? 10.0678,
      lng: data.lng ?? -69.3467,
      tiempo_estimado: data.time,
      etiqueta: data.tag,
      imagen_url: data.img || null,
      calificacion_base: data.rating,
      activo: data.active,
      pm_banco: data.pagoMovil?.banco || null,
      pm_telefono: data.pagoMovil?.telefono || null,
      pm_cedula_rif: data.pagoMovil?.cedula || null,
    }).select('id_restaurante').single()
    if (error) {
      console.error('[categorias] guardar restaurante', error)
      throw error
    }
    return String(inserted.id_restaurante)
  }, [])

  const update = useCallback(async (id: string, data: Partial<Restaurant>) => {
    const payload: Record<string, unknown> = {}
    if (data.active !== undefined) payload.activo = data.active
    if (data.name !== undefined) payload.nombre = data.name
    if (data.category !== undefined) {
      const categoryId = Number(data.category)
      if (!Number.isSafeInteger(categoryId) || categoryId <= 0) throw new Error('Selecciona una categoría válida.')
      payload.id_categoria = categoryId
    }
    if (data.time !== undefined) payload.tiempo_estimado = data.time
    if (data.tag !== undefined) payload.etiqueta = data.tag
    if (data.img !== undefined) payload.imagen_url = data.img || null
    if (data.rating !== undefined) payload.calificacion_base = data.rating
    if (data.lat !== undefined) payload.lat = data.lat
    if (data.lng !== undefined) payload.lng = data.lng
    if (data.whatsapp !== undefined) payload.telefono = data.whatsapp.replace(/\D/g, '')
    const { error } = await supabase.from('restaurante').update(payload).eq('id_restaurante', id)
    if (error) {
      console.error('[categorias] guardar restaurante', error)
      throw error
    }
  }, [])

  const remove = useCallback(async (id: string) => {
    const data = await eliminarRestaurante(id)
    await syncAvailability()
    return String(data)
  }, [syncAvailability])

  return { restaurants, error: loadError, reload, add, update, remove }
}
