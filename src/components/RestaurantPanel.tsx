import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { guardarProducto, listarProductos } from '../lib/productos'

const inputCls =
  'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-3 text-sm outline-none focus:border-[#2563eb] transition-colors placeholder:text-[#555]'

type RestaurantRelation = { nombre?: string | null } | Array<{ nombre?: string | null }> | null
type AssignedRestaurant = {
  id_restaurante: string
  restaurante: RestaurantRelation
}
type Product = {
  id_producto: string
  precio: number
  disponible: boolean
  nombre: string
  descripcion: string | null
  imagen_url: string | null
}

const relatedName = (relation: RestaurantRelation | undefined) =>
  (Array.isArray(relation) ? relation[0]?.nombre : relation?.nombre) ?? 'Restaurante'

export default function RestaurantPanel({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const [loadingRestaurants, setLoadingRestaurants] = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [error, setError] = useState('')
  const [restaurants, setRestaurants] = useState<AssignedRestaurant[]>([])
  const [restaurantId, setRestaurantId] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [updatingIds, setUpdatingIds] = useState<string[]>([])

  const loadProducts = async (idRestaurante: string) => {
    setLoadingProducts(true)
    setError('')
    let loaded: Product[] = []
    try {
      loaded = (await listarProductos(idRestaurante)).map(item => ({ ...item }))
    } catch (queryError) {
      setLoadingProducts(false)
      console.error('[restaurant] cargar productos', queryError)
      setError(queryError instanceof Error ? queryError.message : String(queryError))
      return
    }
    setLoadingProducts(false)
    setProducts(loaded)
  }

  const loadRestaurants = async () => {
    setLoadingRestaurants(true)
    setError('')
    const { data, error: queryError } = await supabase
      .from('restaurante_gestor')
      .select('id_restaurante, restaurante(nombre)')

    setLoadingRestaurants(false)
    if (queryError) {
      setError(queryError.message)
      return
    }

    const assigned = (data ?? []) as AssignedRestaurant[]
    setRestaurants(assigned)
    setRestaurantId('')
    setProducts([])
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setLoggedIn(true)
        void loadRestaurants()
      }
    })
  }, [])

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault()
    setAuthLoading(true)
    setError('')
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setAuthLoading(false)
    if (signInError) {
      setError(signInError.message)
      return
    }
    setLoggedIn(true)
    await loadRestaurants()
  }

  const signOut = async () => {
    setError('')
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) {
      setError(signOutError.message)
      return
    }
    setLoggedIn(false)
    setRestaurants([])
    setRestaurantId('')
    setProducts([])
  }

  const changeRestaurant = (id: string) => {
    setRestaurantId(id)
    setProducts([])
    void loadProducts(id)
  }

  useEffect(() => {
    const channel = supabase
      .channel('productos-imagenes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'producto' }, payload => {
        const updated = payload.new as { id_producto?: string | number; nombre?: string | null; descripcion?: string | null; imagen_url?: string | null }
        if (updated.id_producto == null) return
        setProducts(items => items.map(item =>
          String(item.id_producto) === String(updated.id_producto)
            ? {
                ...item,
                nombre: updated.nombre ?? item.nombre,
                descripcion: updated.descripcion ?? item.descripcion,
                imagen_url: updated.imagen_url ?? item.imagen_url,
              }
            : item,
        ))
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    const refreshOnFocus = () => {
      if (restaurantId) void loadProducts(restaurantId)
    }
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
  }, [restaurantId])

  const toggleAvailability = async (productId: string, disponible: boolean) => {
    setUpdatingIds(ids => [...ids, productId])
    setError('')

    const item = products.find(product => product.id_producto === productId)
    try {
      if (!item) throw new Error('El producto ya no existe.')
      await guardarProducto({
        idRestaurante: restaurantId,
        idProducto: productId,
        nombre: item.nombre,
        descripcion: item.descripcion ?? '',
        precio: item.precio,
        disponible,
        imagenUrl: item.imagen_url,
      })
      await loadProducts(restaurantId)
      window.dispatchEvent(new Event('boombly:products-updated'))
    } catch (updateError) {
      console.error('[restaurant] disponibilidad producto', updateError)
      setError(updateError instanceof Error ? updateError.message : String(updateError))
    } finally {
      setUpdatingIds(ids => ids.filter(id => id !== productId))
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[92dvh] overflow-y-auto bg-[#111] border border-[#1e1e1e] rounded-t-3xl sm:rounded-3xl p-5 sm:p-6" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 mb-5">
          <div>
            <p className="text-[#3b82f6] text-xs uppercase tracking-widest font-bold">Restaurante</p>
            <h2 className="font-display font-black text-xl sm:text-2xl">Panel del restaurante</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-[#777] hover:text-white text-xl">✕</button>
        </div>

        {!loggedIn ? (
          <form onSubmit={signIn} className="max-w-md mx-auto py-4">
            <label className="block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-1.5">Correo</label>
            <input
              className={`${inputCls} mb-4`}
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="correo@restaurante.com"
              required
            />
            <label className="block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-1.5">Contraseña</label>
            <input
              className={inputCls}
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
            {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
            <button disabled={authLoading} type="submit" className="w-full mt-5 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-60 py-3.5 rounded-xl font-display font-black">
              {authLoading ? 'Cargando…' : 'Iniciar sesión'}
            </button>
          </form>
        ) : (
          <>
            <div className="flex items-center justify-end mb-4">
              {restaurantId && (
                <button
                  type="button"
                  onClick={() => void loadProducts(restaurantId)}
                  disabled={loadingProducts}
                  className="mr-auto text-xs text-[#888] hover:text-white border border-[#2a2a2a] disabled:opacity-50 rounded-xl px-3 py-2"
                >
                  Actualizar
                </button>
              )}
              <button onClick={() => void signOut()} className="text-xs text-[#888] hover:text-white border border-[#2a2a2a] rounded-xl px-3 py-2">
                Cerrar sesión
              </button>
            </div>

            {(loadingRestaurants || loadingProducts) && <p className="text-sm text-[#888] text-center py-5">Cargando…</p>}
            {error && <p className="text-red-400 text-xs mb-4">{error}</p>}

            {!loadingRestaurants && restaurants.length === 0 && (
              <p className="text-[#aaa] text-sm text-center py-10">Tu usuario no tiene un restaurante asignado</p>
            )}

            {restaurants.length > 0 && (
              <>
                {!restaurantId && (
                  <>
                    <p className="text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-3">
                      Restaurantes agregados
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {restaurants.map(item => (
                        <button
                          key={item.id_restaurante}
                          type="button"
                          onClick={() => changeRestaurant(item.id_restaurante)}
                          className="text-left bg-[#141414] border border-[#1e1e1e] hover:border-[#2563eb] transition-colors rounded-2xl p-4"
                        >
                          <span className="text-2xl block mb-2">🍽️</span>
                          <span className="font-display font-bold">{relatedName(item.restaurante)}</span>
                          <span className="block text-xs text-[#777] mt-1">Ver productos →</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {restaurantId && (
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <p className="text-xs text-[#777]">Productos de</p>
                      <h3 className="font-display font-bold text-lg">
                        {relatedName(restaurants.find(item => item.id_restaurante === restaurantId)?.restaurante)}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setRestaurantId('')
                        setProducts([])
                      }}
                      className="text-xs text-[#888] hover:text-white border border-[#2a2a2a] rounded-xl px-3 py-2"
                    >
                      ← Restaurantes
                    </button>
                  </div>
                )}

                {!loadingProducts && products.length === 0 && (
                  restaurantId && <p className="text-[#777] text-sm text-center py-8">Este restaurante no tiene productos disponibles.</p>
                )}

                <div className="grid gap-3">
                  {products.map(item => {
                    return (
                      <div key={item.id_producto} className="flex items-center gap-4 bg-[#141414] border border-[#1e1e1e] rounded-2xl p-3">
                        {item.imagen_url ? (
                          <img src={item.imagen_url} alt={item.nombre} loading="lazy" className="w-16 h-16 rounded-xl object-cover shrink-0" />
                        ) : (
                          <div className="w-16 h-16 rounded-xl bg-[#1c1c1c] grid place-items-center text-xl font-display font-black shrink-0">
                            {(item.nombre.trim().charAt(0) || 'P').toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <h3 className="font-display font-bold truncate">{item.nombre}</h3>
                          {item.descripcion && <p className="text-xs text-[#777] line-clamp-2 mt-1">{item.descripcion}</p>}
                          <p className="text-sm text-[#3b82f6] font-bold mt-1">$ {Number(item.precio).toFixed(2)}</p>
                        </div>
                        <label className="flex flex-col items-center gap-1 text-[11px] text-[#888] shrink-0">
                          <input
                            type="checkbox"
                            checked={item.disponible}
                            disabled={updatingIds.includes(item.id_producto)}
                            onChange={event => void toggleAvailability(item.id_producto, event.target.checked)}
                            className="w-5 h-5 accent-[#2563eb] disabled:opacity-50"
                          />
                          <span>{item.disponible ? 'Disponible' : 'No disponible'}</span>
                        </label>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
