import { useCallback, useEffect, useRef, useState } from 'react'
import { TAGS } from '../data/seed'
import type { Restaurant } from '../data/types'
import type { useAdminAuth } from '../data/auth'
import ForgotPassword from './ForgotPassword'
import type { useRestaurants } from '../data/repository'
import type { useOrders } from '../data/orders'
import type { Customer } from '../data/customer'
import { useCategories, type Categoria } from '../data/categories'
import Reports from './Reports'
import Customers from './Customers'
import AccountSettings from './AccountSettings'
import CuentasRestaurantes from './CuentasRestaurantes'
import { getRestaurantImageUrl } from '../data/repository'
import { supabase } from '../lib/supabase'
import { useDatosEnVivo } from '../lib/useDatosEnVivo'
import {
  cambiarEstadoRestaurante,
  eliminarProducto,
  eliminarRestaurante,
  guardarProducto,
  ajustarStock,
  marcarDisponibilidad,
  ImagenFallida,
  listarProductos,
  nuevoIdProducto,
  type ProductoRestaurante,
} from '../lib/productos'

type Auth = ReturnType<typeof useAdminAuth>
type Repo = ReturnType<typeof useRestaurants>
type OrdersRepo = ReturnType<typeof useOrders>

const inputCls =
  'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#2563eb] transition-colors placeholder:text-[#555]'
const labelCls = 'block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-1.5'

const RESTAURANT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const RESTAURANT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function resizeRestaurantImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const im = new Image()
    im.onload = () => {
      const scale = Math.min(1, 1200 / Math.max(im.width, im.height))
      const c = document.createElement('canvas')
      c.width = Math.round(im.width * scale)
      c.height = Math.round(im.height * scale)
      const context = c.getContext('2d')
      if (!context) {
        URL.revokeObjectURL(url)
        reject(new Error('No se pudo procesar la imagen'))
        return
      }
      context.drawImage(im, 0, 0, c.width, c.height)
      c.toBlob(blob => {
        URL.revokeObjectURL(url)
        if (!blob || blob.type !== 'image/webp') {
          reject(new Error('No se pudo convertir la imagen a WebP'))
          return
        }
        resolve(blob)
      }, 'image/webp', 0.85)
    }

    im.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Imagen no válida'))
    }
    im.src = url
  })
}

type FormState = {
  name: string
  category: string
  rating: string
  time: string
  whatsapp: string
  lat: string
  lng: string
  tag: string
  img: string
  active: boolean
  pmBanco: string
  pmTelefono: string
  pmCedula: string
}

const emptyForm: FormState = {
  name: '',
  category: '',
  rating: '4.5',
  time: '20–30 min',
  whatsapp: '',
  lat: '10.0678',
  lng: '-69.3467',
  tag: 'NUEVO',
  img: '',
  active: true,
  pmBanco: '',
  pmTelefono: '',
  pmCedula: '',
}

const toForm = (r: Restaurant): FormState => ({
  name: r.name,
  category: r.category,
  rating: String(r.rating),
  time: r.time,
  whatsapp: r.whatsapp ?? '',
  lat: String(r.lat ?? 10.0678),
  lng: String(r.lng ?? -69.3467),
  tag: r.tag ?? '',
  img: getRestaurantImageUrl(r.img),
  active: r.active,
  pmBanco: r.pagoMovil?.banco ?? '',
  pmTelefono: r.pagoMovil?.telefono ?? '',
  pmCedula: r.pagoMovil?.cedula ?? '',
})

function Login({ auth, onClose }: { auth: Auth; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const loginLock = useRef(false)

  return (
    <div className="w-full max-w-sm bg-[#111] border border-[#1e1e1e] rounded-2xl p-6 slide-up" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#2563eb] rounded-lg flex items-center justify-center font-display font-black text-sm">B</div>
          <h2 className="font-display font-black text-xl">Acceso admin</h2>
        </div>
        <button onClick={onClose} className="text-[#555] hover:text-white text-xl" aria-label="Cerrar">✕</button>
      </div>
      <form
        onSubmit={async e => {
          e.preventDefault()
          if (loginLock.current) return
          loginLock.current = true
          setError('')
          try {
            await auth.login(email, pass)
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Usuario o clave incorrectos.')
          } finally {
            setPass('')
            loginLock.current = false
          }
        }}
        className="space-y-4"
      >
        <div>
          <label className={labelCls}>Correo</label>
          <input className={inputCls} type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" autoFocus />
        </div>
        <div>
          <label className={labelCls}>Clave</label>
          <input className={inputCls} type="password" value={pass} onChange={e => setPass(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors py-3 rounded-xl font-display font-black">
          Entrar
        </button>
      </form>
      <div className="text-center"><ForgotPassword panel="admin" /></div>
    </div>
  )
}

function RestaurantForm({
  initial,
  onSave,
  onCancel,
  saving,
  saveError,
}: {
  initial: FormState
  onSave: (data: Omit<Restaurant, 'id' | 'createdAt'>, imageFile: File | null) => void | Promise<void>
  onCancel: () => void
  saving?: boolean
  saveError?: string
}) {
  const [f, setF] = useState<FormState>(initial)
  const [error, setError] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [preview, setPreview] = useState(initial.img)
  const previewObjectUrl = useRef<string | null>(null)
  const { categories, loading: categoriesLoading, error: categoriesError, reload: reloadCategories } = useCategories()
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF(p => ({ ...p, [k]: v }))

  useEffect(() => () => {
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current)
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const rating = parseFloat(f.rating)
    const lat = parseFloat(f.lat.replace(',', '.'))
    const lng = parseFloat(f.lng.replace(',', '.'))
    if (!f.name.trim()) return setError('El nombre es obligatorio.')
    if (!f.category || !categories.some(category => String(category.id_categoria) === f.category)) {
      return setError(categories.length ? 'Selecciona una categoría.' : 'Crea primero una categoría en la pestaña Categorías')
    }
    if (!(rating >= 0 && rating <= 5)) return setError('La valoración debe estar entre 0 y 5.')
    if (f.whatsapp.trim() && f.whatsapp.replace(/\D/g, '').length < 10) return setError('El WhatsApp del restaurante no es válido (mínimo 10 dígitos).')
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return setError('Las coordenadas del restaurante no son válidas.')
    const pm = { banco: f.pmBanco.trim(), telefono: f.pmTelefono.trim(), cedula: f.pmCedula.trim() }
    const hasPm = pm.banco || pm.telefono || pm.cedula
    if (hasPm && !(pm.banco && pm.telefono && pm.cedula)) return setError('Completa banco, teléfono y cédula del pago móvil (o deja los tres vacíos).')
    await onSave({
      pagoMovil: hasPm ? pm : undefined,
      name: f.name.trim(),
      category: f.category,
      rating,
      time: f.time.trim() || '20–30 min',
      deliveryFee: 0,
      whatsapp: f.whatsapp.trim() || undefined,
      lat,
      lng,
      tag: f.tag || null,
      img: getRestaurantImageUrl(f.img),
      items: [],
      active: f.active,
    }, imageFile)
  }

  return (
    <form onSubmit={submit} className="grid md:grid-cols-2 gap-4">
      <div className="md:col-span-2">
        <label className={labelCls}>Nombre</label>
        <input className={inputCls} value={f.name} onChange={e => set('name', e.target.value)} placeholder="Ej: Arepera La Esquina" />
      </div>
      <div>
        <label className={labelCls}>Categoría</label>
        {categoriesLoading ? (
          <p className="text-xs text-[#888] py-3">Cargando categorías…</p>
        ) : categories.length === 0 ? (
          <p className="text-xs text-amber-400 py-3">Crea primero una categoría en la pestaña Categorías</p>
        ) : (
          <select required className={inputCls} value={f.category} onChange={e => set('category', e.target.value)}>
            <option value="">Selecciona una categoría</option>
            {categories.map(category => (
              <option key={category.id_categoria} value={String(category.id_categoria)}>
                {category.emoji ? `${category.emoji} ` : ''}{category.nombre}
              </option>
            ))}
          </select>
        )}
        {categoriesError && (
          <div className="mt-2">
            <p className="text-red-400 text-xs">No se pudieron cargar las categorías: {categoriesError}</p>
            <button type="button" onClick={() => void reloadCategories()} className="text-xs text-[#3b82f6] hover:text-white mt-1">Reintentar</button>
          </div>
        )}
      </div>
      <div>
        <label className={labelCls}>Etiqueta</label>
        <select className={inputCls} value={f.tag} onChange={e => set('tag', e.target.value)}>
          <option value="">Sin etiqueta</option>
          {TAGS.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label className={labelCls}>Tiempo de entrega</label>
        <input className={inputCls} value={f.time} onChange={e => set('time', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Ubicación (lat, lng)</label>
          <div className="flex gap-2">
            <input className={inputCls} inputMode="decimal" value={f.lat} onChange={e => set('lat', e.target.value)} placeholder="10.0678" />
            <input className={inputCls} inputMode="decimal" value={f.lng} onChange={e => set('lng', e.target.value)} placeholder="-69.3467" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Valoración</label>
          <input className={inputCls} inputMode="decimal" value={f.rating} onChange={e => set('rating', e.target.value)} />
        </div>
      </div>
      <div className="md:col-span-2">
        <label className={labelCls}>WhatsApp del restaurante (recibe los pedidos)</label>
        <input className={inputCls} inputMode="tel" value={f.whatsapp} onChange={e => set('whatsapp', e.target.value)} placeholder="0412-1234567" />
      </div>
      <div className="md:col-span-2 border border-[#1e1e1e] rounded-xl p-4 bg-[#0d0d0d]">
        <p className="font-display font-bold text-sm mb-1">💳 Pago móvil de este restaurante</p>
        <p className="text-[11px] text-[#666] mb-3">Son los datos que verá el cliente al pagar sus platos. Si los dejas vacíos se usan los datos generales de Boombly.</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Banco</label>
            <input className={inputCls} value={f.pmBanco} onChange={e => set('pmBanco', e.target.value)} placeholder="Banesco (0134)" />
          </div>
          <div>
            <label className={labelCls}>Teléfono</label>
            <input className={inputCls} inputMode="tel" value={f.pmTelefono} onChange={e => set('pmTelefono', e.target.value)} placeholder="0414-0000000" />
          </div>
          <div>
            <label className={labelCls}>Cédula / RIF</label>
            <input className={inputCls} value={f.pmCedula} onChange={e => set('pmCedula', e.target.value)} placeholder="V-12.345.678" />
          </div>
        </div>
      </div>
      <div className="md:col-span-2">
        <label className={labelCls}>Foto del restaurante</label>
        <div className="flex gap-3 items-center">
          <label className="shrink-0 cursor-pointer border border-[#2563eb] text-[#3b82f6] hover:bg-[#2563eb] hover:text-white transition-colors px-3 py-2.5 rounded-xl text-sm font-display font-semibold">
            Subir foto
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (!file) return
                if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current)
                previewObjectUrl.current = URL.createObjectURL(file)
                setPreview(previewObjectUrl.current)
                setImageFile(file)
                setError('')
                e.target.value = ''
              }}
            />
          </label>
          <span className="min-w-0 flex-1 truncate text-xs text-[#888]">
            {imageFile?.name ?? (preview ? 'Foto guardada' : 'Sin foto')}
          </span>
          {preview ? (
            <img src={preview} alt="Vista previa del restaurante" className="w-16 h-10 rounded-lg object-cover bg-[#1c1c1c] shrink-0" />
          ) : (
            <div className="w-16 h-10 rounded-lg bg-[#1c1c1c] grid place-items-center text-[#777] shrink-0">
              {f.name.trim().charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </div>
      <label className="md:col-span-2 flex items-center gap-2 text-sm text-[#ccc] cursor-pointer">
        <input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} className="accent-[#2563eb] w-4 h-4" />
        Visible para los clientes
      </label>
      {(error || saveError) && <p className="md:col-span-2 text-red-400 text-sm">{error || saveError}</p>}
      <div className="md:col-span-2 flex gap-3 justify-end">
        <button type="button" onClick={onCancel} className="px-5 py-2.5 rounded-xl border border-[#2a2a2a] text-[#888] hover:text-white font-display font-semibold text-sm">
          Cancelar
        </button>
        <button disabled={saving || categoriesLoading || categories.length === 0} className="px-5 py-2.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 transition-colors font-display font-black text-sm">
          {saving ? 'Guardando…' : 'Guardar restaurante'}
        </button>
      </div>
    </form>
  )
}

type Repartidor = { id_repartidor: number; nombre: string; telefono: string; disponible: boolean; creado_en: string }

async function requireAdminSession() {
  const { data } = await supabase.auth.getSession()
  return Boolean(data.session)
}

function CategoriesManager() {
  const { categories: items, loading, error: loadError, reload } = useCategories()
  const [nombre, setNombre] = useState('')
  const [emoji, setEmoji] = useState('')
  const [editing, setEditing] = useState<Categoria | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanName = nombre.trim()
    if (!cleanName) return setError('El nombre es obligatorio.')
    const operation = editing ? 'editar categoría' : 'agregar categoría'
    setSaving(true)
    setError('')
    try {
      if (!(await requireAdminSession())) {
        setError('Inicia sesión como administrador')
        return
      }
      const payload = { nombre: cleanName, emoji: emoji.trim() || null }
      const result = editing
        ? await supabase.from('categoria').update(payload).eq('id_categoria', editing.id_categoria)
        : await supabase.from('categoria').insert(payload)
      if (result.error) {
        console.error(`[categorias] ${operation}`, result.error)
        setError(result.error.code === '23505' ? 'Ya existe una categoría con ese nombre' : result.error.message)
        return
      }
      setNombre('')
      setEmoji('')
      setEditing(null)
      await reload()
    } catch (saveError) {
      console.error(`[categorias] ${operation}`, saveError)
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: Categoria) => {
    if (!confirm(`¿Eliminar ${item.nombre}?`)) return
    setSaving(true)
    setError('')
    try {
      if (!(await requireAdminSession())) {
        setError('Inicia sesión como administrador')
        return
      }
      const { count, error: removeError } = await supabase
        .from('categoria')
        .delete({ count: 'exact' })
        .eq('id_categoria', item.id_categoria)
      if (removeError) {
        console.error('[categorias] eliminar categoría', removeError)
        setError(removeError.code === '23503'
          ? 'No se puede eliminar: hay restaurantes en esta categoría'
          : removeError.message)
        return
      }
      if (!count) {
        const missingError = new Error('La categoría ya no existe o no se pudo eliminar.')
        console.error('[categorias] eliminar categoría', missingError)
        setError(missingError.message)
        return
      }
      await reload()
    } catch (removeError) {
      console.error('[categorias] eliminar categoría', removeError)
      setError(removeError instanceof Error ? removeError.message : String(removeError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={save} className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-4 grid sm:grid-cols-[1fr_120px_auto] gap-3 items-end">
        <div>
          <label className={labelCls}>Nombre</label>
          <input className={inputCls} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Comida rápida" />
        </div>
        <div>
          <label className={labelCls}>Emoji</label>
          <input className={inputCls} value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="🍔" />
        </div>
        <button disabled={saving || !nombre.trim()} className="px-5 py-2.5 rounded-xl bg-[#2563eb] disabled:opacity-50 font-display font-black text-sm">
          {editing ? 'Guardar cambios' : 'Agregar'}
        </button>
      </form>
      {editing && (
        <button type="button" onClick={() => { setEditing(null); setNombre(''); setEmoji('') }} className="text-xs text-[#888] hover:text-white">
          Cancelar edición
        </button>
      )}
      {(error || loadError) && <p className="text-red-400 text-sm">{error || `No se pudieron cargar las categorías: ${loadError}`}</p>}
      {loading ? <p className="text-[#888] text-sm py-6">Cargando…</p> : (
        <div className="space-y-2">
          {items.length === 0 && <p className="text-center text-[#555] py-10 text-sm">No hay categorías.</p>}
          {items.map(item => (
            <div key={item.id_categoria} className="flex items-center gap-3 bg-[#141414] border border-[#1e1e1e] rounded-xl p-3">
              <span className="text-xl w-8 text-center">{item.emoji ?? ''}</span>
              <p className="font-display font-bold flex-1">{item.nombre}</p>
              <button disabled={saving} onClick={() => { setEditing(item); setNombre(item.nombre); setEmoji(item.emoji ?? '') }} className="text-xs text-[#3b82f6] hover:text-white px-2 py-1.5">Editar</button>
              <button disabled={saving} onClick={() => void remove(item)} className="text-xs text-[#666] hover:text-red-400 px-2 py-1.5">Eliminar</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const normalizePhone = (phone: string) => {
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `58${digits.slice(1)}`
  else if (!digits.startsWith('58')) digits = `58${digits}`
  return digits
}

function DriversManager() {
  const [items, setItems] = useState<Repartidor[]>([])
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [editing, setEditing] = useState<Repartidor | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const normalizedPhone = normalizePhone(telefono)
  const validPhone = /^[0-9]{10,15}$/.test(normalizedPhone)

  const load = async () => {
    setLoading(true)
    const { data, error: loadError } = await supabase.from('repartidor').select('*').order('creado_en')
    if (loadError) setError(loadError.message)
    else setItems(data ?? [])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nombre.trim()) return setError('El nombre es obligatorio.')
    if (!validPhone) return setError('El teléfono no tiene un formato válido.')
    if (!(await requireAdminSession())) return setError('Inicia sesión como administrador')
    setSaving(true)
    setError('')
    const payload = { nombre: nombre.trim(), telefono: normalizedPhone }
    const result = editing
      ? await supabase.from('repartidor').update(payload).eq('id_repartidor', editing.id_repartidor)
      : await supabase.from('repartidor').insert({ ...payload, disponible: true })
    setSaving(false)
    if (result.error) {
      if (result.error.code === '23505') return setError('Ese teléfono ya está registrado')
      return setError(result.error.message)
    }
    setNombre('')
    setTelefono('')
    setEditing(null)
    await load()
  }

  const toggle = async (item: Repartidor) => {
    if (!(await requireAdminSession())) return setError('Inicia sesión como administrador')
    setSaving(true)
    const { error: updateError } = await supabase.from('repartidor').update({ disponible: !item.disponible }).eq('id_repartidor', item.id_repartidor)
    setSaving(false)
    if (updateError) return setError(updateError.message)
    await load()
  }

  const remove = async (item: Repartidor) => {
    if (!confirm(`¿Eliminar a ${item.nombre}? Si solo quieres que deje de recibir pedidos, márcalo como No disponible.`)) return
    if (!(await requireAdminSession())) return setError('Inicia sesión como administrador')
    setSaving(true)
    setError('')
    const { count, error: removeError } = await supabase
      .from('repartidor')
      .delete({ count: 'exact' })
      .eq('id_repartidor', item.id_repartidor)
    setSaving(false)
    if (removeError) {
      console.error('[admin] eliminar repartidor', removeError)
      return setError(removeError.message)
    }
    if (!count) return setError('El repartidor ya no existe o no se pudo eliminar.')
    await load()
  }

  return (
    <div className="space-y-5">
      <form onSubmit={save} className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-4 grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div>
          <label className={labelCls}>Nombre</label>
          <input className={inputCls} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre del repartidor" />
        </div>
        <div>
          <label className={labelCls}>Teléfono</label>
          <input className={inputCls} inputMode="tel" value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="0412-1234567" />
          <p className={`text-[11px] mt-1.5 ${validPhone ? 'text-[#888]' : 'text-red-400'}`}>Se guardará como: {normalizedPhone || '—'}</p>
        </div>
        <button disabled={saving || !nombre.trim() || !validPhone} className="px-5 py-2.5 rounded-xl bg-[#2563eb] disabled:opacity-50 font-display font-black text-sm">
          {editing ? 'Guardar cambios' : 'Agregar'}
        </button>
      </form>
      {editing && (
        <button type="button" onClick={() => { setEditing(null); setNombre(''); setTelefono('') }} className="text-xs text-[#888] hover:text-white">
          Cancelar edición
        </button>
      )}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {loading ? <p className="text-[#888] text-sm py-6">Cargando…</p> : (
        <div className="space-y-2">
          {items.length === 0 && <p className="text-center text-[#555] py-10 text-sm">No hay repartidores.</p>}
          {items.map(item => (
            <div key={item.id_repartidor} className="flex items-center gap-3 bg-[#141414] border border-[#1e1e1e] rounded-xl p-3">
              <div className="flex-1 min-w-0">
                <p className="font-display font-bold truncate">{item.nombre}</p>
                <p className="text-xs text-[#666]">{item.telefono}</p>
              </div>
              <button disabled={saving} onClick={() => void toggle(item)} className={`text-xs font-display font-semibold px-3 py-1.5 rounded-lg ${item.disponible ? 'bg-green-500/15 text-green-400' : 'bg-[#1c1c1c] text-[#666]'}`}>
                {item.disponible ? 'Disponible' : 'No disponible'}
              </button>
              <button disabled={saving} onClick={() => { setEditing(item); setNombre(item.nombre); setTelefono(item.telefono) }} className="text-xs text-[#3b82f6] hover:text-white px-2 py-1.5">Editar</button>
              <button disabled={saving} onClick={() => void remove(item)} className="text-xs text-[#666] hover:text-red-400 px-2 py-1.5">Eliminar</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RestaurantProducts({ restaurantId }: { restaurantId: string }) {
  const [items, setItems] = useState<ProductoRestaurante[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProductoRestaurante | null>(null)
  const productIdRef = useRef('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [available, setAvailable] = useState(true)
  const [stock, setStock] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [imageFailed, setImageFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const saveLock = useRef(false)

  const load = useCallback(async () => {
    setError('')
    try {
      setItems(await listarProductos(restaurantId))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
      throw loadError
    } finally {
      setLoading(false)
    }
  }, [restaurantId])

  useDatosEnVivo(load, ['detalle_producto', 'producto'])

  const openNew = () => {
    productIdRef.current = nuevoIdProducto()
    setEditing(null)
    setName('')
    setDescription('')
    setPrice('')
    setAvailable(true)
    setStock('')
    setSelectedFile(null)
    setPreview('')
    setImageFailed(false)
    setError('')
    setFormOpen(true)
  }

  const openEdit = (item: ProductoRestaurante) => {
    productIdRef.current = String(item.id_producto)
    setEditing(item)
    setName(item.nombre)
    setDescription(item.descripcion ?? '')
    setPrice(item.precio.toFixed(2))
    setAvailable(item.disponible)
    setStock(item.stock === null ? '' : String(item.stock))
    setSelectedFile(null)
    setPreview(item.imagen_url ?? '')
    setImageFailed(false)
    setError('')
    setFormOpen(true)
  }

  const save = async (imageOnly = false) => {
    if (saveLock.current) return
    saveLock.current = true
    setSaving(true)
    setError('')
    try {
      const cleanName = name.trim().replace(/\s+/g, ' ')
      const cleanDescription = description.trim()
      const numericPrice = Number(price.replace(',', '.'))
      if (!imageOnly) {
        if (!cleanName) throw new Error('El nombre es obligatorio.')
        if (!cleanDescription) throw new Error('La descripción es obligatoria.')
        if (cleanDescription.length > 300) throw new Error('La descripción no puede superar 300 caracteres.')
        if (!Number.isFinite(numericPrice) || numericPrice < 0) throw new Error('El precio debe ser mayor o igual a 0.')
      }

      await guardarProducto({
        idRestaurante: restaurantId,
        idProducto: productIdRef.current,
        nombre: cleanName,
        descripcion: cleanDescription,
        precio: Number(numericPrice.toFixed(2)),
        disponible: available,
        imagenUrl: editing?.imagen_url ?? null,
        archivoImagen: selectedFile,
      })
      if (stock.trim() !== '') {
        const numericStock = Number(stock)
        if (!Number.isInteger(numericStock) || numericStock < 0 || numericStock > 100000) throw new Error('La cantidad debe ser un entero entre 0 y 100000.')
        console.log('[stock] guardando', { idRestaurante: restaurantId, idProducto: productIdRef.current, numero: numericStock })
        await ajustarStock(restaurantId, productIdRef.current, numericStock)
      } else {
        throw new Error('Escribe una cantidad')
      }
      await load()
      setFormOpen(false)
      setImageFailed(false)
    } catch (saveError) {
      console.error('[stock] guardar producto', saveError)
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      if (saveError instanceof ImagenFallida) {
        setImageFailed(true)
        await load()
      }
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }

  const remove = async (idProducto: string) => {
    if (!confirm('¿Eliminar este producto?')) return
    try {
      const result = await eliminarProducto(restaurantId, idProducto)
      if (result === 'archivado') setError('Este producto ya está en pedidos: se marcó como No disponible')
      if (result === 'eliminado' || result === 'no_existia') setError('')
      await load()
    } catch (removeError) {
      console.error('[admin] eliminar producto', removeError)
      setError(removeError instanceof Error ? removeError.message : String(removeError))
    }
  }

  const toggle = async (item: ProductoRestaurante, disponible: boolean) => {
    if (saveLock.current) return
    saveLock.current = true
    setSaving(true)
    setError('')
    try {
      await marcarDisponibilidad(restaurantId, item.id_producto, disponible)
      await load()
      setError('')
    } catch (toggleError) {
      console.error('[stock] marcar disponibilidad', toggleError)
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError))
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }

  const setUnlimited = async () => {
    if (!editing || saveLock.current) return
    saveLock.current = true
    setSaving(true)
    setError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) throw new Error('Inicia sesión para cambiar la cantidad.')
      console.log('[stock] guardando', { idRestaurante: restaurantId, idProducto: productIdRef.current, numero: null })
      await ajustarStock(restaurantId, productIdRef.current, null)
      await load()
      setStock('')
    } catch (stockError) {
      console.error('[stock] sin límite', stockError)
      setError(stockError instanceof Error ? stockError.message : String(stockError))
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 border-t border-[#262626] pt-3">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-display font-bold">Productos</h4>
        <button type="button" onClick={openNew} className="text-xs text-[#3b82f6] hover:text-white">+ Agregar producto</button>
      </div>
      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
      {loading ? <p className="text-[#777] text-sm">Cargando productos…</p> : (
        <div className="grid gap-2">
          {items.map(item => (
            <div key={item.id_producto} className="flex items-start gap-3 bg-[#0d0d0d] border border-[#222] rounded-xl p-3">
              {item.imagen_url ? <img src={item.imagen_url} alt="" className="w-14 h-14 rounded-lg object-cover" /> : (
                <div className="w-14 h-14 rounded-lg bg-[#1c1c1c] grid place-items-center font-display font-black">{item.nombre.charAt(0).toUpperCase()}</div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-display font-bold">{item.nombre}</p>
                <p className="text-xs text-[#777] line-clamp-2">{item.descripcion}</p>
                <p className="text-sm text-[#3b82f6] mt-1">$ {item.precio.toFixed(2)}</p>
                <p className="text-xs text-[#aaa] mt-1">{item.stock === null ? 'Sin límite' : item.stock === 0 ? 'Agotado' : `Quedan ${item.stock}`}</p>
              </div>
              <label className="text-[11px] text-[#888] text-center">
                <input type="checkbox" checked={item.disponible} onChange={event => void toggle(item, event.target.checked)} />
                <span className="block mt-1">{item.disponible ? 'Disponible' : 'No disponible'}</span>
              </label>
              <button type="button" onClick={() => openEdit(item)} className="text-xs text-[#3b82f6]">Editar</button>
              <button type="button" onClick={() => void remove(item.id_producto)} className="text-xs text-red-400">Eliminar</button>
            </div>
          ))}
          {items.length === 0 && <p className="text-center text-[#666] text-sm py-4">No hay productos.</p>}
        </div>
      )}
      {formOpen && (
        <form onSubmit={event => { event.preventDefault(); void save() }} className="mt-3 bg-[#0d0d0d] border border-[#222] rounded-xl p-4 grid gap-3">
          <div>
            <label className={labelCls}>Nombre *</label>
            <input className={inputCls} value={name} onChange={event => setName(event.target.value)} maxLength={100} required />
          </div>
          <div>
            <label className={labelCls}>Descripción *</label>
            <textarea className={`${inputCls} resize-y min-h-24`} value={description} maxLength={300} onChange={event => setDescription(event.target.value)} required />
            <p className="text-right text-[11px] text-[#777]">{description.length}/300</p>
          </div>
          <div>
            <label className={labelCls}>Precio *</label>
            <input className={inputCls} type="number" min="0" step="0.01" value={price} onChange={event => setPrice(event.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>Cantidad disponible</label>
            <input className={inputCls} type="number" min="0" max="100000" step="1" value={stock} onChange={event => setStock(event.target.value)} placeholder="Cantidad" />
          </div>
          <div className="flex items-center gap-3">
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
              const file = event.target.files?.[0] ?? null
              setSelectedFile(file)
              if (file) setPreview(URL.createObjectURL(file))
              else if (!editing) setPreview('')
            }} />
            {preview && <img src={preview} alt="Vista previa" className="w-16 h-16 rounded-lg object-cover" />}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={available} onChange={event => setAvailable(event.target.checked)} /> Disponible</label>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="bg-[#2563eb] disabled:opacity-60 px-4 py-2 rounded-lg text-sm font-bold">{saving ? 'Guardando…' : 'Guardar'}</button>
            {editing && <button type="button" disabled={saving} onClick={() => void setUnlimited()} className="border border-[#333] disabled:opacity-60 px-4 py-2 rounded-lg text-sm">Sin límite</button>}
            {imageFailed && selectedFile && <button type="button" disabled={saving} onClick={() => void save(true)} className="text-sm text-[#3b82f6]">Reintentar solo imagen</button>}
            <button type="button" disabled={saving} onClick={() => setFormOpen(false)} className="px-4 py-2 text-sm text-[#888]">Cancelar</button>
          </div>
        </form>
      )}
    </div>
  )
}

function Dashboard({ auth, repo, ordersRepo, customers, onClose }: { auth: Auth; repo: Repo; ordersRepo: OrdersRepo; customers: Customer[]; onClose: () => void }) {
  const [tab, setTab] = useState<'restaurantes' | 'clientes' | 'reportes' | 'categorias' | 'repartidores' | 'cuenta'>('restaurantes')
  const [editing, setEditing] = useState<Restaurant | 'new' | null>(null)
  const [query, setQuery] = useState('')
  const [savingMenu, setSavingMenu] = useState(false)
  const [menuError, setMenuError] = useState('')
  const [expandedProducts, setExpandedProducts] = useState<string[]>([])
  const [pendingRestaurantId, setPendingRestaurantId] = useState<string | null>(null)

  useEffect(() => {
    const refreshAccount = () => void auth.refreshRole()
    window.addEventListener('boombly:cuenta-actualizada', refreshAccount)
    return () => window.removeEventListener('boombly:cuenta-actualizada', refreshAccount)
  }, [auth])

  const list = repo.restaurants.filter(r => r.name.toLowerCase().includes(query.toLowerCase()))

  const saveMenu = async (restaurant: Omit<Restaurant, 'id' | 'createdAt'>, imageFile: File | null) => {
    setSavingMenu(true)
    setMenuError('')

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) throw new Error('Inicia sesión como administrador')
      let idRestaurante = ''
      if (editing === 'new') {
        if (pendingRestaurantId) {
          idRestaurante = pendingRestaurantId
          await repo.update(idRestaurante, restaurant)
        } else {
          idRestaurante = await repo.add(restaurant)
          setPendingRestaurantId(idRestaurante)
        }
      }
      else if (editing) {
        idRestaurante = editing.id
        await repo.update(idRestaurante, restaurant)
      }

      if (!idRestaurante) throw new Error('No se pudo identificar el restaurante.')

      if (imageFile) {
        if (!RESTAURANT_IMAGE_TYPES.has(imageFile.type) || imageFile.size > RESTAURANT_IMAGE_MAX_BYTES) {
          const validationError = new Error('Formato no válido o archivo demasiado grande')
          console.error('[foto] validar foto del restaurante', validationError)
          throw validationError
        }

        let blob: Blob
        try {
          blob = await resizeRestaurantImage(imageFile)
        } catch (resizeError) {
          console.error('[foto] procesar foto del restaurante', resizeError)
          throw resizeError
        }

        const previousImageUrl = editing && editing !== 'new' ? getRestaurantImageUrl(editing.img) : ''
        const imagePath = `${idRestaurante}/${Date.now()}.webp`
        const { error: uploadError } = await supabase.storage
          .from('restaurantes')
          .upload(imagePath, blob, { contentType: 'image/webp', upsert: false })
        if (uploadError) {
          console.error('[foto] subir foto del restaurante', uploadError)
          throw uploadError
        }

        const { data: publicUrlData } = supabase.storage.from('restaurantes').getPublicUrl(imagePath)
        const { data: updatedRows, error: imageUpdateError } = await supabase
          .from('restaurante')
          .update({ imagen_url: publicUrlData.publicUrl })
          .eq('id_restaurante', idRestaurante)
          .select('id_restaurante')
        if (imageUpdateError) {
          console.error('[foto] guardar URL de la foto', imageUpdateError)
          throw imageUpdateError
        }
        if (!updatedRows?.length) {
          const noRowsError = new Error('No se guardó la foto')
          console.error('[foto] guardar URL de la foto', noRowsError)
          throw noRowsError
        }

        if (previousImageUrl && previousImageUrl !== publicUrlData.publicUrl) {
          const marker = '/object/public/restaurantes/'
          const previousPath = previousImageUrl.split(marker)[1]?.split(/[?#]/, 1)[0]
          if (previousPath) {
            const { error: removeError } = await supabase.storage.from('restaurantes').remove([previousPath])
            if (removeError) {
              console.error('[foto] borrar foto anterior', removeError)
              setMenuError('La foto se guardó, pero no se pudo borrar la imagen anterior.')
            }
          }
        }
      }

      await repo.reload()
      setEditing(null)
      setPendingRestaurantId(null)
    } catch (error) {
      console.error('[foto] guardar restaurante', error)
      setMenuError(error instanceof Error ? error.message : 'No se pudo guardar el restaurante.')
    } finally {
      setSavingMenu(false)
    }
  }

  return (
    <div className="w-full max-w-5xl max-h-[92vh] overflow-y-auto bg-[#111] border border-[#1e1e1e] rounded-2xl slide-up" onClick={e => e.stopPropagation()}>
      <div className="sticky top-0 z-10 bg-[#111]/95 backdrop-blur border-b border-[#1e1e1e] p-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-black text-xl">Panel de administración</h2>
          <p className="text-xs text-[#666]">{repo.restaurants.length} restaurantes · Sesión de {auth.currentUser} · {auth.role ?? 'sin rol'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={auth.logout} className="text-xs text-[#888] hover:text-white px-3 py-2 rounded-lg border border-[#2a2a2a]">
            Salir
          </button>
          <button onClick={onClose} className="text-[#555] hover:text-white text-xl px-1" aria-label="Cerrar">✕</button>
        </div>
      </div>

      <div className="px-5 pt-4 flex gap-2">
        {(['restaurantes', 'clientes', 'reportes', 'categorias', 'repartidores', 'cuenta'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-display font-semibold capitalize transition-colors ${tab === t ? 'bg-[#2563eb] text-white' : 'bg-[#141414] text-[#888] hover:text-white border border-[#2a2a2a]'}`}
          >
            {t === 'reportes' ? `Reportes (${ordersRepo.orders.length})` : t === 'clientes' ? `Clientes (${customers.length})` : t === 'categorias' ? 'Categorías' : t === 'repartidores' ? 'Repartidores' : t === 'cuenta' ? 'Mi cuenta' : 'Restaurantes'}
          </button>
        ))}
      </div>

      {tab === 'cuenta' ? (
        <div className="p-5"><AccountSettings /></div>
      ) : tab === 'categorias' ? (
        <div className="p-5"><CategoriesManager /></div>
      ) : tab === 'repartidores' ? (
        <div className="p-5"><DriversManager /></div>
      ) : tab === 'clientes' ? (
        <div className="p-5">
          <Customers restaurants={repo.restaurants} customers={customers} orders={ordersRepo.orders} />
        </div>
      ) : tab === 'reportes' ? (
        <div className="p-5">
          <Reports restaurants={repo.restaurants} ordersRepo={ordersRepo} />
        </div>
      ) : (
      <div className="p-5 space-y-5">
        {editing ? (
          <div className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-5">
            <h3 className="font-display font-black text-lg mb-4">
              {editing === 'new' ? 'Nuevo restaurante' : `Editar ${editing.name}`}
            </h3>
            <RestaurantForm
              key={editing === 'new' ? 'new' : editing.id}
              initial={editing === 'new' ? emptyForm : toForm(editing)}
              onCancel={() => { setEditing(null); setPendingRestaurantId(null) }}
              saving={savingMenu}
              saveError={menuError}
              onSave={(data, imageFile) => saveMenu(data, imageFile)}
            />
          </div>
        ) : (
          <>
            {(menuError || repo.error) && <p className="text-red-400 text-sm">{menuError || repo.error}</p>}
            <div className="flex gap-3">
              <input className={inputCls} placeholder="Buscar restaurante..." value={query} onChange={e => setQuery(e.target.value)} />
              <button
                type="button"
                onClick={async () => {
                  setMenuError('')
                  try {
                    await repo.reload()
                  } catch (refreshError) {
                    console.error('[foto] actualizar lista de restaurantes', refreshError)
                    setMenuError(refreshError instanceof Error ? refreshError.message : String(refreshError))
                  }
                }}
                className="shrink-0 border border-[#2a2a2a] hover:border-[#2563eb] px-4 rounded-xl text-sm"
              >
                Actualizar
              </button>
              <button
                onClick={() => { setMenuError(''); setPendingRestaurantId(null); setEditing('new') }}
                className="shrink-0 bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors px-5 rounded-xl font-display font-black text-sm"
              >
                + Agregar
              </button>
            </div>

            <CuentasRestaurantes />
            <div className="space-y-2">
              {list.length === 0 && <p className="text-center text-[#555] py-10 text-sm">No hay restaurantes.</p>}
              {list.map(r => (
                <div key={r.id} className="bg-[#141414] border border-[#1e1e1e] rounded-xl p-3">
                  <div className="flex items-center gap-3">
                  <div className="relative w-16 h-12 rounded-lg bg-[#1c1c1c] shrink-0 grid place-items-center font-display font-black text-[#777]">
                    {r.name.charAt(0).toUpperCase()}
                    {r.img && (
                      <img
                        src={r.img}
                        alt={r.name}
                        onError={event => {
                          console.error('[foto] mostrar foto en lista admin', new Error(`No se pudo cargar la foto de ${r.name}`))
                          event.currentTarget.style.display = 'none'
                        }}
                        className="absolute inset-0 w-full h-full rounded-lg object-cover"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-bold truncate">{r.name}</p>
                    {!r.active && <span className="text-[11px] text-amber-400">Inactivo</span>}
                    <p className="text-xs text-[#666] truncate">
                      {r.categoryEmoji ? `${r.categoryEmoji} ` : ''}{r.categoryName || 'Sin categoría'} · {r.items.length} platos · ★ {r.rating}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      if (r.active) return
                      try {
                        await cambiarEstadoRestaurante(r.id, true)
                        await repo.reload()
                      } catch (activationError) {
                        console.error('[admin] activar restaurante', activationError)
                        setMenuError(activationError instanceof Error ? activationError.message : String(activationError))
                      }
                    }}
                    className={`text-xs font-display font-semibold px-3 py-1.5 rounded-lg ${r.active ? 'bg-green-500/15 text-green-400' : 'bg-[#1c1c1c] text-[#666]'}`}
                  >
                    {r.active ? 'Visible' : 'Activar'}
                  </button>
                  <button onClick={() => setEditing(r)} className="text-xs text-[#3b82f6] hover:text-white px-2 py-1.5">Editar</button>
                  <button
                    onClick={async () => {
                      if (!confirm('¿Eliminar este restaurante?')) return
                      console.count('[admin] eliminar restaurante')
                      try {
                        const result = await eliminarRestaurante(r.id)
                        if (result === 'desactivado') setMenuError('Este restaurante tiene pedidos y no se puede eliminar: se desactivó')
                        else if (result === 'eliminado' || result === 'no_existia') setMenuError('')
                        await repo.reload()
                      } catch (error) {
                        console.error('[admin] eliminar restaurante', error)
                        setMenuError(error instanceof Error ? error.message : String(error))
                      }
                    }}
                    className="text-xs text-[#666] hover:text-red-400 px-2 py-1.5"
                  >
                    Eliminar
                  </button>
                  <button onClick={() => setExpandedProducts(ids => ids.includes(r.id) ? ids.filter(id => id !== r.id) : [...ids, r.id])} className="text-xs text-[#888]">
                    {expandedProducts.includes(r.id) ? 'Ocultar productos' : 'Productos'}
                  </button>
                  </div>
                  {expandedProducts.includes(r.id) && <RestaurantProducts restaurantId={r.id} />}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      )}
    </div>
  )
}

export default function AdminPanel({ auth, repo, ordersRepo, customers, onClose }: { auth: Auth; repo: Repo; ordersRepo: OrdersRepo; customers: Customer[]; onClose: () => void }) {
  const mismatch = auth.loggedIn && auth.roleChecked && auth.role !== 'admin'
  const loadingRole = auth.loggedIn && !auth.roleChecked
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      {mismatch ? (
        <div className="w-full max-w-sm rounded-2xl border border-[#1e1e1e] bg-[#111] p-6 text-center">
          <p className="mb-5 text-red-400">Hay una sesión de {auth.currentUser} ({auth.role ?? 'sin rol'}) abierta en este navegador. Este panel es para cuentas de admin.</p>
          <button onClick={() => void auth.logout()} className="w-full rounded-xl bg-[#2563eb] py-3 font-bold">Cerrar sesión y entrar con otra cuenta</button>
          <button onClick={onClose} className="mt-3 w-full rounded-xl border border-[#2a2a2a] py-3 font-bold text-[#aaa]">Cancelar</button>
        </div>
      ) : loadingRole ? (
        <p className="text-sm text-[#888]">Verificando acceso…</p>
      ) : auth.loggedIn ? (
        <>
          {auth.sessionNotice && <div className="fixed top-4 left-1/2 z-[80] -translate-x-1/2 rounded-xl bg-[#2563eb] px-4 py-3 text-sm text-white shadow-xl">{auth.sessionNotice}</div>}
          <Dashboard auth={auth} repo={repo} ordersRepo={ordersRepo} customers={customers} onClose={onClose} />
        </>
      ) : (
        <>
          {auth.expired && <p className="absolute top-8 rounded-xl bg-[#111] px-4 py-3 text-sm text-red-400">Tu sesión venció: vuelve a entrar</p>}
          <Login auth={auth} onClose={onClose} />
        </>
      )}
    </div>
  )
}
