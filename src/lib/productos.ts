// src/lib/productos.ts
// ÚNICO lugar donde la app crea, edita o elimina productos y restaurantes.
// Usa las funciones de la base de datos (guardar_producto_restaurante,
// eliminar_producto_restaurante, eliminar_restaurante): un producto SOLO existe dentro de un restaurante.
//
// Si tu src/lib/supabase.ts exporta el cliente con otro nombre, cambia SOLO esta línea:
import { supabase } from './supabase'

export type ProductoRestaurante = {
  id_producto: string
  precio: number
  disponible: boolean
  nombre: string
  descripcion: string | null
  imagen_url: string | null
}

export type DatosProducto =  
{
  idRestaurante: string
  idProducto: string // créalo UNA vez con nuevoIdProducto() al abrir el formulario y reutilízalo en cada guardado
  nombre: string
  descripcion: string
  precio: number
  disponible: boolean
  imagenUrl?: string | null
  archivoImagen?: File | null
}

export class ImagenFallida extends Error {}

/** Llamar UNA sola vez al abrir el formulario de un producto nuevo. */
export const nuevoIdProducto = () => crypto.randomUUID()

function mensajeError(error: { code?: string; message?: string }): string {
  if (error.code === '23505') return 'Ya existe un producto con ese nombre en este restaurante'
  return error.message ?? 'Error desconocido'
}

/** Productos de UN restaurante (con descripción e imagen). */
export async function listarProductos(idRestaurante: string): Promise<ProductoRestaurante[]> {
  const { data, error } = await supabase
    .from('detalle_producto')
    .select('id_producto, precio, disponible, producto(nombre, descripcion, imagen_url)')
    .eq('id_restaurante', idRestaurante)
  if (error) throw new Error(mensajeError(error))
  return (data ?? [])
    .map((d: any) => {
      const p = Array.isArray(d.producto) ? d.producto[0] : d.producto
      return {
        id_producto: d.id_producto as string,
        precio: Number(d.precio),
        disponible: Boolean(d.disponible),
        nombre: (p?.nombre ?? '') as string,
        descripcion: (p?.descripcion ?? null) as string | null,
        imagen_url: (p?.imagen_url ?? null) as string | null,
      }
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
}

async function comprimirImagen(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error('Formato no válido o archivo demasiado grande (JPG, PNG o WebP de máximo 5 MB)')
  }
  const bmp = await createImageBitmap(file)
  const escala = Math.min(1, 800 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * escala))
  canvas.height = Math.max(1, Math.round(bmp.height * escala))
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return await new Promise<Blob>((ok, fail) =>
    canvas.toBlob(b => (b ? ok(b) : fail(new Error('No se pudo procesar la imagen'))), 'image/webp', 0.85),
  )
}

async function subirImagen(idProducto: string, file: File): Promise<string> {
  const blob = await comprimirImagen(file)
  const ruta = `${idProducto}/${Date.now()}.webp`
  const { error } = await supabase.storage.from('productos').upload(ruta, blob, { contentType: 'image/webp', upsert: false })
  if (error) throw new Error(error.message)
  return supabase.storage.from('productos').getPublicUrl(ruta).data.publicUrl
}

async function rpcGuardar(d: DatosProducto, imagenUrl: string | null): Promise<void> {
  const { error } = await supabase.rpc('guardar_producto_restaurante', {
    p_id_restaurante: d.idRestaurante,
    p_id_producto: d.idProducto,
    p_nombre: d.nombre,
    p_descripcion: d.descripcion,
    p_precio: d.precio,
    p_disponible: d.disponible,
    p_imagen_url: imagenUrl,
  })
  if (error) throw new Error(mensajeError(error))
}

/**
 * Crea o edita un producto dentro de un restaurante, en una sola operación e idempotente:
 * llamarla otra vez con el mismo idProducto actualiza el MISMO producto, nunca crea otro.
 * Si la imagen falla, el producto igual queda guardado y se lanza ImagenFallida (para reintentar solo la imagen).
 */
export async function guardarProducto(d: DatosProducto): Promise<void> {
  await rpcGuardar(d, d.imagenUrl ?? null)
  if (d.archivoImagen) {
    try {
      const url = await subirImagen(d.idProducto, d.archivoImagen)
      await rpcGuardar(d, url)
    } catch (e) {
      throw new ImagenFallida(`El producto se guardó, pero la imagen falló: ${(e as Error).message}`)
    }
  }
}

/** 'eliminado' | 'archivado' (ya está en pedidos: queda como no disponible) | 'no_existia' */
export async function eliminarProducto(idRestaurante: string, idProducto: string) {
  const { data, error } = await supabase.rpc('eliminar_producto_restaurante', {
    p_id_restaurante: idRestaurante,
    p_id_producto: idProducto,
  })
  if (error) throw new Error(mensajeError(error))
  return data as 'eliminado' | 'archivado' | 'no_existia'
}

/** 'eliminado' | 'desactivado' (tiene pedidos: queda inactivo) | 'no_existia' */
export async function eliminarRestaurante(idRestaurante: string) {
  const { data, error } = await supabase.rpc('eliminar_restaurante', { p_id_restaurante: idRestaurante })
  if (error) throw new Error(mensajeError(error))
  return data as 'eliminado' | 'desactivado' | 'no_existia'
}

/** Activa o desactiva un restaurante (el admin ve todos; los clientes solo los activos). */
export async function cambiarEstadoRestaurante(idRestaurante: string, activo: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('restaurante')
    .update({ activo })
    .eq('id_restaurante', idRestaurante)
    .select('id_restaurante')
  if (error) throw new Error(mensajeError(error))
  if (!data || data.length === 0) throw new Error('No se pudo cambiar el estado: sin permiso o el restaurante no existe')
}
