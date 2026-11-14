import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ajustarStock, listarProductos, marcarDisponibilidad } from '../lib/productos'
import { getRestaurantImageUrl } from '../data/repository'
import { useDatosEnVivo } from '../lib/useDatosEnVivo'
import AccountSettings from './AccountSettings'
import ForgotPassword from './ForgotPassword'
import PedidosRestaurante from './PedidosRestaurante'

const inputCls =
  'w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-3 text-sm outline-none focus:border-[#2563eb] transition-colors placeholder:text-[#555]'

type RestaurantCategory = { nombre?: string | null; emoji?: string | null } | Array<{ nombre?: string | null; emoji?: string | null }> | null
type RestaurantRelation = {
  nombre?: string | null
  imagen_url?: string | null
  activo?: boolean | null
  id_categoria?: number | null
  categoria?: RestaurantCategory
} | Array<{
  nombre?: string | null
  imagen_url?: string | null
  activo?: boolean | null
  id_categoria?: number | null
  categoria?: RestaurantCategory
}> | null
type AssignedRestaurant = {
  id_restaurante: string
  restaurante: RestaurantRelation
}
type Product = {
  id_producto: string
  precio: number
  disponible: boolean
  stock: number | null
  nombre: string
  descripcion: string | null
  imagen_url: string | null
}

const relatedName = (relation: RestaurantRelation | undefined) =>
  (Array.isArray(relation) ? relation[0]?.nombre : relation?.nombre) ?? 'Restaurante'
const relatedActive = (relation: RestaurantRelation | undefined) =>
  Array.isArray(relation) ? relation[0]?.activo : relation?.activo
const relatedImage = (relation: RestaurantRelation | undefined) =>
  getRestaurantImageUrl(Array.isArray(relation) ? relation[0]?.imagen_url : relation?.imagen_url)
const relatedCategory = (relation: RestaurantRelation | undefined) => {
  const restaurant = Array.isArray(relation) ? relation[0] : relation
  const category = Array.isArray(restaurant?.categoria) ? restaurant.categoria[0] : restaurant?.categoria
  return category?.nombre
    ? `${category.emoji ? `${category.emoji} ` : ''}${category.nombre}`
    : 'Sin categoría'
}

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
  const [stockInputs, setStockInputs] = useState<Record<string, string>>({})
  const stockLock = useRef(false)
  const loadedProductRestaurant = useRef('')
  const loginLock = useRef(false)
  const [sessionEmail, setSessionEmail] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [roleChecked, setRoleChecked] = useState(false)
  const [restaurantView, setRestaurantView] = useState<'gestion' | 'cuenta'>('gestion')
  const [failedRestaurantImage, setFailedRestaurantImage] = useState('')
  const [sessionNotice, setSessionNotice] = useState('')
  const [expired, setExpired] = useState(false)
  const previousSession = useRef<{ email: string; role: string | null } | null>(null)

  const isExpiredSessionError = (value: unknown) => {
    const message = value instanceof Error ? value.message : typeof value === 'object' && value && 'message' in value
      ? String((value as { message: unknown }).message)
      : typeof value === 'string' ? value : ''
    return /permission denied|auth session missing/i.test(message)
  }

  const loadProducts = useCallback(async (idRestaurante: string) => {
    if (!idRestaurante) return
    if (loadedProductRestaurant.current !== idRestaurante) setLoadingProducts(true)
    setError('')
    try {
      const loaded = (await listarProductos(idRestaurante)).map(item => ({ ...item }))
      setProducts(loaded)
      loadedProductRestaurant.current = idRestaurante
    } catch (queryError) {
      if (isExpiredSessionError(queryError)) {
        setExpired(true)
        setLoggedIn(false)
        setProducts([])
        loadedProductRestaurant.current = ''
      }
      setError(queryError instanceof Error ? queryError.message : String(queryError))
      throw queryError
    } finally {
      setLoadingProducts(false)
    }
  }, [])

  const refreshProducts = useCallback(() => {
    if (!loggedIn || role !== 'restaurante' || !restaurantId) return Promise.resolve()
    return loadProducts(restaurantId)
  }, [loggedIn, role, restaurantId, loadProducts])

  useDatosEnVivo(
    refreshProducts,
    loggedIn && role === 'restaurante' && restaurantId ? ['detalle_producto', 'producto'] : [],
  )

  const loadRestaurants = async () => {
    setLoadingRestaurants(true)
    setError('')
    const { data, error: queryError } = await supabase
      .from('restaurante_gestor')
      .select('id_restaurante, restaurante(nombre, imagen_url, activo, id_categoria, categoria(nombre, emoji))')

    setLoadingRestaurants(false)
    if (queryError) {
      console.error('[categorias] cargar restaurante del gestor', queryError)
      if (isExpiredSessionError(queryError.message)) {
        setExpired(true)
        setLoggedIn(false)
        setRestaurants([])
      }
      setError(queryError.message)
      return
    }

    const assigned = (data ?? []) as AssignedRestaurant[]
    setRestaurants(assigned)
    const first = assigned.find(item => String(item.id_restaurante) === restaurantId) ?? assigned[0]
    if (!first) {
      setRestaurantId('')
      setProducts([])
      loadedProductRestaurant.current = ''
      return
    }
    const nextRestaurantId = String(first.id_restaurante)
    if (nextRestaurantId !== restaurantId) {
      setProducts([])
      loadedProductRestaurant.current = ''
    }
    setRestaurantId(nextRestaurantId)
    if (relatedActive(first.restaurante) === false) setProducts([])
  }

  useEffect(() => {
    window.addEventListener('boombly:auth-changed', refresh)
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED', 'TOKEN_REFRESHED'].includes(event)) {
        window.setTimeout(() => { void initializeSession() }, 0)
      }
    })
    void initializeSession()
    function refresh() {
      void initializeSession()
    }
    return () => {
      window.removeEventListener('boombly:auth-changed', refresh)
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const refreshAccount = () => void initializeSession()
    window.addEventListener('boombly:cuenta-actualizada', refreshAccount)
    return () => window.removeEventListener('boombly:cuenta-actualizada', refreshAccount)
  }, [])

  const initializeSession = async () => {
    setRoleChecked(false)
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      if (userError && isExpiredSessionError(userError.message)) setExpired(true)
      setLoggedIn(false)
      setSessionEmail('')
      setRole(null)
      setRoleChecked(true)
      setRestaurants([])
      setProducts([])
      previousSession.current = null
      return
    }
    let roleData: unknown = null
    let roleError = null as { message: string } | null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await supabase.rpc('mi_rol')
      roleError = result.error
      if (!result.error && typeof result.data === 'string') {
        roleData = result.data
        break
      }
      await new Promise(resolve => window.setTimeout(resolve, 150))
    }
    if (userError) console.error('[restaurant] cargar usuario', userError)
    if (roleError) console.error('[restaurant] consultar rol', roleError)
    if (roleError && isExpiredSessionError(roleError.message)) {
      setExpired(true)
      setLoggedIn(false)
    }
    const nextEmail = userData.user.email ?? ''
    const nextRole = typeof roleData === 'string' ? roleData : null
    const previous = previousSession.current
    if (previous && (previous.email !== nextEmail || previous.role !== nextRole)) {
      setSessionNotice(`La sesión cambió en otra ventana: ahora eres ${nextEmail} (${nextRole ?? 'sin rol'})`)
    }
    previousSession.current = { email: nextEmail, role: nextRole }
    setSessionEmail(nextEmail)
    setRole(nextRole)
    setLoggedIn(true)
    setExpired(false)
    setRoleChecked(true)
    if (!roleError && roleData === 'restaurante') void loadRestaurants()
  }

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault()
    if (loginLock.current) return
    loginLock.current = true
    setAuthLoading(true)
    setError('')
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (signInError) {
        console.error('[restaurant] iniciar sesión', signInError)
        setError(signInError.message)
        return
      }
      setLoggedIn(true)
      await initializeSession()
    } finally {
      setPassword('')
      setAuthLoading(false)
      loginLock.current = false
    }
  }

  const signOut = async () => {
    setError('')
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
    if (signOutError) {
      setError(signOutError.message)
      return
    }
    setLoggedIn(false)
    setRestaurants([])
    setRestaurantId('')
    setProducts([])
    setSessionEmail('')
    setRole(null)
    setRoleChecked(true)
    setSessionNotice('')
    setExpired(false)
    previousSession.current = null
  }

  useEffect(() => {
    if (!loggedIn || role !== 'restaurante') return

    const refresh = () => { void loadRestaurants() }
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', refreshOnVisible)
    const channel = supabase
      .channel(`restaurante-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurante' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categoria' }, refresh)
      .subscribe((_status, subscriptionError) => {
        if (subscriptionError) {
          console.error('[categorias] suscribir restaurante del gestor', subscriptionError)
          setError(subscriptionError.message)
        }
      })

    return () => {
      document.removeEventListener('visibilitychange', refreshOnVisible)
      void supabase.removeChannel(channel)
    }
  }, [loggedIn, role, restaurantId])

  const toggleAvailability = async (productId: string, disponible: boolean) => {
    setUpdatingIds(ids => [...ids, productId])
    setError('')

    const item = products.find(product => product.id_producto === productId)
    try {
      if (!item) throw new Error('El producto ya no existe.')
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) throw new Error('Inicia sesión para cambiar la disponibilidad.')
      await marcarDisponibilidad(restaurantId, productId, disponible)
      await loadProducts(restaurantId)
      window.dispatchEvent(new Event('boombly:products-updated'))
    } catch (updateError) {
      console.error('[stock] marcar disponibilidad', updateError)
      setError(updateError instanceof Error ? updateError.message : String(updateError))
    } finally {
      setUpdatingIds(ids => ids.filter(id => id !== productId))
    }

  }

  const saveStock = async (productId: string, stock: number | null) => {
    if (stockLock.current) return
    stockLock.current = true
    setUpdatingIds(ids => [...ids, productId])
    setError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) throw new Error('Inicia sesión para cambiar la cantidad.')
      if (stock !== null && (!Number.isInteger(stock) || stock < 0 || stock > 100000)) {
        throw new Error('La cantidad debe ser un entero entre 0 y 100000.')
      }
      const numero = stock
      await ajustarStock(restaurantId, productId, stock)
      await loadProducts(restaurantId)
    } catch (stockError) {
      console.error('[stock] guardar cantidad', stockError)
      setError(stockError instanceof Error ? stockError.message : String(stockError))
    } finally {
      stockLock.current = false
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
            {loggedIn && sessionEmail && <p className="text-xs text-[#888] mt-1">Sesión de {sessionEmail} · {role ?? 'sin rol'}</p>}
            {restaurants[0] && (() => {
              const restaurantName = relatedName(restaurants[0].restaurante)
              const imageUrl = relatedImage(restaurants[0].restaurante)
              return (
                <div className="flex items-center gap-3 mt-2">
                  <div className="relative w-12 h-12 rounded-xl bg-[#1c1c1c] grid place-items-center font-display font-black text-lg text-[#888] overflow-hidden shrink-0">
                    <span className="absolute inset-0 grid place-items-center">{restaurantName.charAt(0).toUpperCase()}</span>
                    {imageUrl && failedRestaurantImage !== imageUrl && (
                      <img
                        src={imageUrl}
                        alt={restaurantName}
                        loading="lazy"
                        onError={() => {
                          console.error('[foto] mostrar foto de Soy restaurante', new Error(`No se pudo cargar la foto de ${restaurantName}`))
                          setFailedRestaurantImage(imageUrl)
                        }}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white">{restaurantName} · {sessionEmail}</p>
                    <p className="text-xs text-[#888] mt-1">{relatedCategory(restaurants[0].restaurante)}</p>
                  </div>
                </div>
              )
            })()}
          </div>
          <div className="flex items-center gap-3">
            {loggedIn && role === 'restaurante' && (
              <button type="button" onClick={() => void loadRestaurants()} className="text-xs text-[#3b82f6] hover:text-white">
                Actualizar
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Cerrar" className="text-[#777] hover:text-white text-xl">✕</button>
          </div>
        </div>

        {loggedIn && roleChecked && role === 'restaurante' && restaurantView === 'gestion' && restaurantId && (
          <PedidosRestaurante key={restaurantId} idRestaurante={restaurantId} />
        )}

        {!loggedIn ? (
          <form onSubmit={signIn} className="max-w-md mx-auto py-4">
            {expired && <p className="mb-4 text-sm text-red-400">Tu sesión venció: vuelve a entrar</p>}
            <label className="block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-1.5">Correo</label>
            <input
              className={`${inputCls} mb-4`}
              type="email"
              autoComplete="username"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="correo@restaurante.com"
              required
            />
            <label className="block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-1.5">Contraseña</label>
            <input
              className={inputCls}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
            {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
            <button disabled={authLoading} type="submit" className="w-full mt-5 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-60 py-3.5 rounded-xl font-display font-black">
              {authLoading ? 'Cargando…' : 'Iniciar sesión'}
            </button>
            <div className="text-center"><ForgotPassword panel="restaurant" /></div>
          </form>
        ) : loggedIn && roleChecked && role !== 'restaurante' ? (
          <div className="max-w-sm mx-auto py-8 text-center">
            <p className="mb-5 text-red-400">Hay una sesión de {sessionEmail} ({role ?? 'sin rol'}) abierta en este navegador. Este panel es para cuentas de restaurante.</p>
            <button onClick={() => void signOut()} className="w-full rounded-xl bg-[#2563eb] py-3 font-bold">Cerrar sesión y entrar con otra cuenta</button>
            <button onClick={onClose} className="mt-3 w-full rounded-xl border border-[#2a2a2a] py-3 font-bold text-[#aaa]">Cancelar</button>
          </div>
        ) : loggedIn && !roleChecked ? (
          <p className="py-8 text-center text-sm text-[#888]">Verificando acceso…</p>
        ) : (
          <>
            {sessionNotice && <p className="mb-4 rounded-xl bg-[#2563eb] px-4 py-3 text-sm text-white">{sessionNotice}</p>}
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
              <button
                type="button"
                onClick={() => setRestaurantView(view => view === 'cuenta' ? 'gestion' : 'cuenta')}
                className={`text-xs border border-[#2a2a2a] rounded-xl px-3 py-2 mr-2 ${restaurantView === 'cuenta' ? 'bg-[#2563eb] text-white' : 'text-[#888] hover:text-white'}`}
              >
                {restaurantView === 'cuenta' ? 'Gestión' : 'Mi cuenta'}
              </button>
              <button onClick={() => void signOut()} className="text-xs text-[#888] hover:text-white border border-[#2a2a2a] rounded-xl px-3 py-2">
                Cerrar sesión
              </button>
            </div>

            {restaurantView === 'cuenta' ? (
              <AccountSettings />
            ) : (
            <>
            {(loadingRestaurants || loadingProducts) && <p className="text-sm text-[#888] text-center py-5">Cargando…</p>}
            {error && <p className="text-red-400 text-xs mb-4">{error}</p>}

            {!loadingRestaurants && restaurants.length === 0 && (
              <p className="text-[#aaa] text-sm text-center py-10">Tu usuario no tiene un restaurante asignado</p>
            )}

            {!loadingRestaurants && restaurants.length > 0 && (relatedActive(restaurants[0].restaurante) === false || !restaurants[0].restaurante) && (
              <p className="text-[#aaa] text-sm text-center py-10">Tu restaurante está desactivado. Contacta al administrador</p>
            )}

            {restaurants.length > 0 && !!restaurants[0].restaurante && relatedActive(restaurants[0].restaurante) !== false && (
              <>
                {restaurantId && (
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <p className="text-xs text-[#777]">Productos de</p>
                      <h3 className="font-display font-bold text-lg">
                        {relatedName(restaurants.find(item => item.id_restaurante === restaurantId)?.restaurante)}
                      </h3>
                    </div>
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
                          <span className={`inline-block mt-2 text-[10px] font-bold uppercase rounded-full px-2 py-1 ${item.stock === 0 ? 'bg-red-500/15 text-red-400' : item.stock !== null && item.stock <= 5 ? 'bg-yellow-500/15 text-yellow-400' : 'bg-[#1f1f1f] text-[#aaa]'}`}>
                            {item.stock === null ? 'Sin límite' : item.stock === 0 ? 'Agotado' : `Quedan ${item.stock}`}
                          </span>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <input
                              type="number"
                              min="0"
                              max="100000"
                              step="1"
                              value={stockInputs[item.id_producto] ?? (item.stock === null ? '' : String(item.stock))}
                              onChange={event => setStockInputs(inputs => ({ ...inputs, [item.id_producto]: event.target.value }))}
                              className="w-24 bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-2 py-2 text-sm"
                            />
                            <button
                              type="button"
                              disabled={updatingIds.includes(item.id_producto)}
                              onClick={() => {
                                const raw = stockInputs[item.id_producto] ?? (item.stock === null ? '' : String(item.stock))
                                if (raw.trim() === '') {
                                  setError('Escribe una cantidad')
                                  return
                                }
                                void saveStock(item.id_producto, Number(raw))
                              }}
                              className="text-xs bg-[#2563eb] disabled:opacity-50 px-3 py-2 rounded-lg font-bold"
                            >
                              Guardar cantidad
                            </button>
                            <button type="button" disabled={updatingIds.includes(item.id_producto)} onClick={() => void saveStock(item.id_producto, null)} className="text-xs border border-[#333] disabled:opacity-50 px-3 py-2 rounded-lg">
                              Sin límite
                            </button>
                          </div>
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
          </>
        )}
      </div>
    </div>
  )
}
