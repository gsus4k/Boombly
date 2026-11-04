import { useState } from 'react'
import { CATEGORIES, TAGS } from '../data/seed'
import type { MenuItem, Restaurant } from '../data/types'
import type { useAdminAuth } from '../data/auth'
import type { useRestaurants } from '../data/repository'
import type { useOrders } from '../data/orders'
import type { Customer } from '../data/customer'
import Reports from './Reports'
import Customers from './Customers'

type Auth = ReturnType<typeof useAdminAuth>
type Repo = ReturnType<typeof useRestaurants>
type OrdersRepo = ReturnType<typeof useOrders>

const FALLBACK_IMG = 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&h=400&fit=crop&auto=format'

const inputCls =
  'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#2563eb] transition-colors placeholder:text-[#555]'
const labelCls = 'block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-1.5'

type ItemRow = { name: string; price: string; img: string }

const toRows = (items: MenuItem[]): ItemRow[] =>
  items.map(i => ({ name: i.name, price: String(i.price), img: i.img ?? '' }))

function resizeImage(file: File, max = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const im = new Image()
    im.onload = () => {
      const scale = Math.min(1, max / Math.max(im.width, im.height))
      const c = document.createElement('canvas')
      c.width = Math.round(im.width * scale)
      c.height = Math.round(im.height * scale)
      c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.8))
    }
    im.onerror = () => reject(new Error('Imagen no válida'))
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
  items: ItemRow[]
  active: boolean
  pmBanco: string
  pmTelefono: string
  pmCedula: string
}

const emptyForm: FormState = {
  name: '',
  category: 'burgers',
  rating: '4.5',
  time: '20–30 min',
  whatsapp: '',
  lat: '10.0678',
  lng: '-69.3467',
  tag: 'NUEVO',
  img: '',
  items: [
    { name: 'Plato estrella', price: '5.99', img: '' },
    { name: 'Plato clásico', price: '4.99', img: '' },
  ],
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
  img: r.img,
  items: toRows(r.items),
  active: r.active,
  pmBanco: r.pagoMovil?.banco ?? '',
  pmTelefono: r.pagoMovil?.telefono ?? '',
  pmCedula: r.pagoMovil?.cedula ?? '',
})

function Login({ auth, onClose }: { auth: Auth; onClose: () => void }) {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState(false)

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
        onSubmit={e => {
          e.preventDefault()
          setError(!auth.login(user, pass))
        }}
        className="space-y-4"
      >
        <div>
          <label className={labelCls}>Usuario</label>
          <input className={inputCls} value={user} onChange={e => setUser(e.target.value)} autoComplete="username" autoFocus />
        </div>
        <div>
          <label className={labelCls}>Clave</label>
          <input className={inputCls} type="password" value={pass} onChange={e => setPass(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <p className="text-red-400 text-sm">Usuario o clave incorrectos.</p>}
        <button className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors py-3 rounded-xl font-display font-black">
          Entrar
        </button>
        <p className="text-xs text-[#555] text-center">
          Por defecto: <span className="text-[#888]">admin</span> / <span className="text-[#888]">boombly2026</span> — cámbiala dentro del panel.
        </p>
      </form>
    </div>
  )
}

function RestaurantForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: FormState
  onSave: (data: Omit<Restaurant, 'id' | 'createdAt'>) => void
  onCancel: () => void
}) {
  const [f, setF] = useState<FormState>(initial)
  const [error, setError] = useState('')
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF(p => ({ ...p, [k]: v }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const items: MenuItem[] = f.items
      .filter(r => r.name.trim())
      .map(r => {
        const p = parseFloat(r.price.replace(',', '.'))
        return { name: r.name.trim(), price: Number.isFinite(p) && p >= 0 ? p : 0, img: r.img || undefined }
      })
    const rating = parseFloat(f.rating)
    const lat = parseFloat(f.lat.replace(',', '.'))
    const lng = parseFloat(f.lng.replace(',', '.'))
    if (!f.name.trim()) return setError('El nombre es obligatorio.')
    if (items.length === 0) return setError('Agrega al menos un plato .')
    if (!(rating >= 0 && rating <= 5)) return setError('La valoración debe estar entre 0 y 5.')
    if (f.whatsapp.trim() && f.whatsapp.replace(/\D/g, '').length < 10) return setError('El WhatsApp del restaurante no es válido (mínimo 10 dígitos).')
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return setError('Las coordenadas del restaurante no son válidas.')
    const pm = { banco: f.pmBanco.trim(), telefono: f.pmTelefono.trim(), cedula: f.pmCedula.trim() }
    const hasPm = pm.banco || pm.telefono || pm.cedula
    if (hasPm && !(pm.banco && pm.telefono && pm.cedula)) return setError('Completa banco, teléfono y cédula del pago móvil (o deja los tres vacíos).')
    onSave({
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
      img: f.img.trim() || FALLBACK_IMG,
      items,
      active: f.active,
    })
  }

  return (
    <form onSubmit={submit} className="grid md:grid-cols-2 gap-4">
      <div className="md:col-span-2">
        <label className={labelCls}>Nombre</label>
        <input className={inputCls} value={f.name} onChange={e => set('name', e.target.value)} placeholder="Ej: Arepera La Esquina" />
      </div>
      <div>
        <label className={labelCls}>Categoría</label>
        <select className={inputCls} value={f.category} onChange={e => set('category', e.target.value)}>
          {CATEGORIES.filter(c => c.id !== 'all').map(c => (
            <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
          ))}
        </select>
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
          <input
            className={inputCls}
            value={f.img.startsWith('data:') ? '' : f.img}
            onChange={e => set('img', e.target.value)}
            placeholder={f.img.startsWith('data:') ? 'Foto subida desde tu dispositivo' : 'Pega la URL (https://...)'}
          />
          <label className="shrink-0 cursor-pointer border border-[#2563eb] text-[#3b82f6] hover:bg-[#2563eb] hover:text-white transition-colors px-3 py-2.5 rounded-xl text-sm font-display font-semibold">
            Subir foto
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async e => {
                const file = e.target.files?.[0]
                if (!file) return
                try {
                  set('img', await resizeImage(file, 800))
                } catch {
                  setError('No se pudo leer la imagen.')
                }
                e.target.value = ''
              }}
            />
          </label>
          <img src={f.img || FALLBACK_IMG} alt="Vista previa" className="w-16 h-10 rounded-lg object-cover bg-[#1c1c1c] shrink-0" />
        </div>
      </div>
      <div className="md:col-span-2">
        <div className="flex items-center justify-between mb-2">
          <label className={`${labelCls} mb-0`}>Productos del menú</label>
          <button
            type="button"
            onClick={() => set('items', [...f.items, { name: '', price: '', img: '' }])}
            className="text-xs text-[#3b82f6] hover:text-white font-display font-semibold"
          >
            + Añadir producto
          </button>
        </div>
        <div className="space-y-3">
          {f.items.map((row, idx) => {
            const upd = (patch: Partial<ItemRow>) =>
              set('items', f.items.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
            return (
              <div key={idx} className="flex gap-3 bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl p-3">
                <div className="shrink-0 w-20">
                  <div className="w-20 h-20 rounded-lg bg-[#1c1c1c] overflow-hidden flex items-center justify-center text-2xl">
                    {row.img ? <img src={row.img} alt="" className="w-full h-full object-cover" /> : '🍽️'}
                  </div>
                  <label className="block mt-1.5 text-center text-[11px] text-[#3b82f6] hover:text-white cursor-pointer font-display font-semibold">
                    Subir foto
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async e => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        try {
                          upd({ img: await resizeImage(file) })
                        } catch {
                          setError('No se pudo leer la imagen.')
                        }
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>
                <div className="flex-1 grid grid-cols-[1fr_90px] gap-2 content-start min-w-0">
                  <input className={inputCls} placeholder="Nombre del producto" value={row.name} onChange={e => upd({ name: e.target.value })} />
                  <input className={inputCls} placeholder="USD" inputMode="decimal" value={row.price} onChange={e => upd({ price: e.target.value })} />
                  <input
                    className={`${inputCls} col-span-2`}
                    placeholder="o pega la URL de la foto (https://...)"
                    value={row.img.startsWith('data:') ? '' : row.img}
                    onChange={e => upd({ img: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => set('items', f.items.filter((_, i) => i !== idx))}
                  className="self-start text-[#555] hover:text-red-400 px-1"
                  aria-label="Quitar producto"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      </div>
      <label className="md:col-span-2 flex items-center gap-2 text-sm text-[#ccc] cursor-pointer">
        <input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} className="accent-[#2563eb] w-4 h-4" />
        Visible para los clientes
      </label>
      {error && <p className="md:col-span-2 text-red-400 text-sm">{error}</p>}
      <div className="md:col-span-2 flex gap-3 justify-end">
        <button type="button" onClick={onCancel} className="px-5 py-2.5 rounded-xl border border-[#2a2a2a] text-[#888] hover:text-white font-display font-semibold text-sm">
          Cancelar
        </button>
        <button className="px-5 py-2.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors font-display font-black text-sm">
          Guardar restaurante
        </button>
      </div>
    </form>
  )
}

function Credentials({ auth }: { auth: Auth }) {
  const [user, setUser] = useState(auth.currentUser)
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState('')

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        if (!user.trim() || pass.length < 6) return setMsg('Usuario requerido y clave de mínimo 6 caracteres.')
        auth.changeCredentials(user, pass)
        setPass('')
        setMsg('Credenciales actualizadas.')
      }}
      className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end"
    >
      <div>
        <label className={labelCls}>Usuario</label>
        <input className={inputCls} value={user} onChange={e => setUser(e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>Nueva clave</label>
        <input className={inputCls} type="password" value={pass} onChange={e => setPass(e.target.value)} autoComplete="new-password" />
      </div>
      <button className="px-5 py-2.5 rounded-xl bg-[#1c1c1c] hover:bg-[#2563eb] transition-colors font-display font-semibold text-sm">
        Actualizar
      </button>
      {msg && <p className="sm:col-span-3 text-xs text-[#3b82f6]">{msg}</p>}
    </form>
  )
}

function Dashboard({ auth, repo, ordersRepo, customers, onClose }: { auth: Auth; repo: Repo; ordersRepo: OrdersRepo; customers: Customer[]; onClose: () => void }) {
  const [tab, setTab] = useState<'restaurantes' | 'clientes' | 'reportes'>('restaurantes')
  const [editing, setEditing] = useState<Restaurant | 'new' | null>(null)
  const [showCred, setShowCred] = useState(false)
  const [query, setQuery] = useState('')

  const list = repo.restaurants.filter(r => r.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="w-full max-w-5xl max-h-[92vh] overflow-y-auto bg-[#111] border border-[#1e1e1e] rounded-2xl slide-up" onClick={e => e.stopPropagation()}>
      <div className="sticky top-0 z-10 bg-[#111]/95 backdrop-blur border-b border-[#1e1e1e] p-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-black text-xl">Panel de administración</h2>
          <p className="text-xs text-[#666]">{repo.restaurants.length} restaurantes · sesión de {auth.currentUser}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCred(s => !s)} className="text-xs text-[#888] hover:text-white px-3 py-2 rounded-lg border border-[#2a2a2a]">
            Credenciales
          </button>
          <button onClick={auth.logout} className="text-xs text-[#888] hover:text-white px-3 py-2 rounded-lg border border-[#2a2a2a]">
            Salir
          </button>
          <button onClick={onClose} className="text-[#555] hover:text-white text-xl px-1" aria-label="Cerrar">✕</button>
        </div>
      </div>

      <div className="px-5 pt-4 flex gap-2">
        {(['restaurantes', 'clientes', 'reportes'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-display font-semibold capitalize transition-colors ${tab === t ? 'bg-[#2563eb] text-white' : 'bg-[#141414] text-[#888] hover:text-white border border-[#2a2a2a]'}`}
          >
            {t === 'reportes' ? `Reportes (${ordersRepo.orders.length})` : t === 'clientes' ? `Clientes (${customers.length})` : 'Restaurantes'}
          </button>
        ))}
      </div>

      {tab === 'clientes' ? (
        <div className="p-5">
          <Customers restaurants={repo.restaurants} customers={customers} orders={ordersRepo.orders} />
        </div>
      ) : tab === 'reportes' ? (
        <div className="p-5">
          <Reports restaurants={repo.restaurants} ordersRepo={ordersRepo} />
        </div>
      ) : (
      <div className="p-5 space-y-5">
        {showCred && (
          <div className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-4">
            <Credentials auth={auth} />
          </div>
        )}

        {editing ? (
          <div className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-5">
            <h3 className="font-display font-black text-lg mb-4">
              {editing === 'new' ? 'Nuevo restaurante' : `Editar ${editing.name}`}
            </h3>
            <RestaurantForm
              initial={editing === 'new' ? emptyForm : toForm(editing)}
              onCancel={() => setEditing(null)}
              onSave={data => {
                if (editing === 'new') repo.add(data)
                else repo.update(editing.id, data)
                setEditing(null)
              }}
            />
          </div>
        ) : (
          <>
            <div className="flex gap-3">
              <input className={inputCls} placeholder="Buscar restaurante..." value={query} onChange={e => setQuery(e.target.value)} />
              <button
                onClick={() => setEditing('new')}
                className="shrink-0 bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors px-5 rounded-xl font-display font-black text-sm"
              >
                + Agregar
              </button>
            </div>

            <div className="space-y-2">
              {list.length === 0 && <p className="text-center text-[#555] py-10 text-sm">No hay restaurantes.</p>}
              {list.map(r => (
                <div key={r.id} className="flex items-center gap-3 bg-[#141414] border border-[#1e1e1e] rounded-xl p-3">
                  <img src={r.img} alt={r.name} className="w-16 h-12 rounded-lg object-cover bg-[#1c1c1c] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-bold truncate">{r.name}</p>
                    <p className="text-xs text-[#666] truncate">
                      {CATEGORIES.find(c => c.id === r.category)?.label} · {r.items.length} platos · ★ {r.rating}
                    </p>
                  </div>
                  <button
                    onClick={() => repo.update(r.id, { active: !r.active })}
                    className={`text-xs font-display font-semibold px-3 py-1.5 rounded-lg ${r.active ? 'bg-green-500/15 text-green-400' : 'bg-[#1c1c1c] text-[#666]'}`}
                  >
                    {r.active ? 'Visible' : 'Oculto'}
                  </button>
                  <button onClick={() => setEditing(r)} className="text-xs text-[#3b82f6] hover:text-white px-2 py-1.5">Editar</button>
                  <button
                    onClick={() => confirm(`¿Eliminar ${r.name}?`) && repo.remove(r.id)}
                    className="text-xs text-[#666] hover:text-red-400 px-2 py-1.5"
                  >
                    Eliminar
                  </button>
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
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      {auth.loggedIn ? <Dashboard auth={auth} repo={repo} ordersRepo={ordersRepo} customers={customers} onClose={onClose} /> : <Login auth={auth} onClose={onClose} />}
    </div>
  )
}
