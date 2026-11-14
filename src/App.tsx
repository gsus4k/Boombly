import { useEffect, useRef, useState } from 'react'
import { useRestaurants } from './data/repository'
import { useCategories } from './data/categories'
import { useAdminAuth } from './data/auth'
import { useCustomers } from './data/customer'
import { compressImage, PAGO_MOVIL } from './data/payment'
import { STATUS_META, useOrders, displayRating, type OrderLocation, type OrderStatus } from './data/orders'
import { notifyOrderByWhatsApp, mapsUrl } from './data/whatsapp'
import { DELIVERY, quoteDelivery, type DeliveryQuote } from './data/delivery'
import type { Restaurant } from './data/types'
import AdminPanel from './components/AdminPanel'
import MyOrders from './components/MyOrders'
import type { CustomerOrder } from './components/MyOrders'
import CustomerAuth from './components/CustomerAuth'
import RestaurantPanel from './components/RestaurantPanel'
import PasswordRecoveryModal from './components/PasswordRecoveryModal'
import EmailChangeModal from './components/EmailChangeModal'
import { crearPedido, supabase } from './lib/supabase'

type CartItem = { productId?: string; restaurantId: string; restaurantName: string; name: string; price: number; qty: number; stock?: number | null }
const cartKey = (i: { restaurantId: string; name: string }) => `${i.restaurantId}:${i.name}`
const isOrderStatus = (value: string): value is OrderStatus => Object.prototype.hasOwnProperty.call(STATUS_META, value)

const TAG_COLORS: Record<string, string> = {
  'MÁS PEDIDO': 'bg-boom-orange text-white',
  'NUEVO': 'bg-boom-yellow text-black',
  'TOP RATED': 'bg-purple-500 text-white',
  'OFERTA': 'bg-green-500 text-white',
  'POPULAR': 'bg-blue-500 text-white',
}

export default function App() {
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [myOrdersOpen, setMyOrdersOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [restaurantPanelOpen, setRestaurantPanelOpen] = useState(false)
  const repo = useRestaurants()
  const { categories, error: categoriesError } = useCategories()
  const activeCategoryFilters = categories.filter(category =>
    repo.restaurants.some(restaurant => restaurant.active && restaurant.category === String(category.id_categoria)),
  )
  const categoryFilters = [
    { id: 'all', nombre: 'Todo', emoji: '✨' },
    ...activeCategoryFilters.map(category => ({
      id: String(category.id_categoria),
      nombre: category.nombre,
      emoji: category.emoji,
    })),
  ]
  const selectedCategory = categoryFilters.some(category => category.id === activeCategory)
    ? activeCategory
    : 'all'
  const auth = useAdminAuth()
  const ordersRepo = useOrders()
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const customersRepo = useCustomers()
  const customer = customersRepo.current
  const [myOrders, setMyOrders] = useState<CustomerOrder[]>([])
  const [myOrdersLoading, setMyOrdersLoading] = useState(false)
  const [myOrdersError, setMyOrdersError] = useState('')
  const [ordersRefresh, setOrdersRefresh] = useState(0)
  const [authOpen, setAuthOpen] = useState<null | 'checkout' | 'orders' | 'plain'>(null)
  const [location, setLocation] = useState<OrderLocation | null>(null)
  const [locStatus, setLocStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [locError, setLocError] = useState('')
  const [pays, setPays] = useState<Record<string, { ref: string; proof: string | null }>>({})
  const [proofError, setProofError] = useState('')
  const [orderError, setOrderError] = useState('')
  const [orderSubmitting, setOrderSubmitting] = useState(false)
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null)
  const [expiredLink, setExpiredLink] = useState(false)
  const recoveryEmailRef = useRef('')
  const alertedUnavailable = useRef(new Set<string>())
  const placeOrderLock = useRef(false)
  const payOf = (id: string) => pays[id] ?? { ref: '', proof: null }
  const setPay = (id: string, patch: Partial<{ ref: string; proof: string | null }>) =>
    setPays(prev => ({ ...prev, [id]: { ...(prev[id] ?? { ref: '', proof: null }), ...patch } }))

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    const hasExpiredParams = params.has('error_description') || params.has('error_code')
      || query.has('error_description') || query.has('error_code')
    if (hasExpiredParams) {
      setExpiredLink(true)
      window.history.replaceState({}, '', window.location.pathname)
    }

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'PASSWORD_RECOVERY') return
      recoveryEmailRef.current = session?.user.email ?? ''
      window.setTimeout(() => {
        setRecoveryEmail(recoveryEmailRef.current)
      }, 0)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!customer) {
      setMyOrders([])
      setMyOrdersError('')
      setMyOrdersLoading(false)
      return
    }

    let active = true
    setMyOrders([])
    setMyOrdersLoading(true)
    setMyOrdersError('')
    void supabase.rpc('mis_pedidos', {
      p_codigo: customer.id,
      p_telefono: customer.phone,
    }).then(({ data, error }) => {
      if (error) throw error
      if (!active) return
      setMyOrders((data ?? []).map(row => {
        if (typeof row.estado !== 'string' || !isOrderStatus(row.estado)) {
          throw new Error('El servidor devolvió un estado de pedido desconocido.')
        }
        return {
          id: String(row.id_pedido),
          restaurantName: String(row.restaurante ?? 'Restaurante'),
          createdAt: new Date(row.creado_en).getTime(),
          restaurantId: String(row.id_restaurante),
          deliveryFee: Number(row.costo_envio),
          subtotal: Number(row.subtotal),
          total: Number(row.total),
          status: row.estado,
          rating: row.calificacion == null ? undefined : Number(row.calificacion),
        }
      }))
    }).catch(error => {
      if (!active) return
      console.error('[cliente] cargar mis pedidos', error)
      setMyOrdersError('No se pudieron cargar tus pedidos. Intenta de nuevo.')
    }).finally(() => {
      if (active) setMyOrdersLoading(false)
    })

    return () => { active = false }
  }, [customer?.id, customer?.phone, ordersRefresh])

  const requestNewPasswordLink = () => {
    setExpiredLink(false)
    setRestaurantPanelOpen(true)
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('boombly:forgot-password', { detail: 'restaurant' })), 0)
  }

  const onProofChange = async (id: string, file?: File) => {
    if (!file) return
    setProofError('')
    if (!file.type.startsWith('image/')) return setProofError('Selecciona una imagen (JPG o PNG).')
    try {
      setPay(id, { proof: await compressImage(file) })
    } catch {
      setProofError('No pudimos leer la imagen. Intenta con otra.')
    }
  }

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocStatus('error')
      setLocError('Tu navegador no soporta geolocalización.')
      return
    }
    setLocStatus('loading')
    setLocError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy })
        setLocStatus('ok')
      },
      err => {
        setLocStatus('error')
        setLocError(
          err.code === err.PERMISSION_DENIED
            ? 'Permiso denegado. Activa la ubicación en tu navegador para continuar.'
            : 'No pudimos obtener tu ubicación. Intenta de nuevo.',
        )
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  const closeCheckout = () => {
    setCheckoutOpen(false)
  }

  const filtered = repo.restaurants.filter(r => {
    if (!r.active) return false
    const matchCat = selectedCategory === 'all' || r.category === selectedCategory
    const matchSearch = r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.items.some(i => i.name.toLowerCase().includes(search.toLowerCase()) || i.description?.toLowerCase().includes(search.toLowerCase()))
    return matchCat && matchSearch
  })

  const addToCart = (rest: Restaurant, item: { name: string; price: number }, openCart = true) => {
    const menuItem = rest.items.find(menuItem => menuItem.name === item.name)
    if (menuItem?.available === false || menuItem?.stock === 0) return
    const key = cartKey({ restaurantId: rest.id, name: item.name })
    setCart(prev => {
      if (prev.some(i => cartKey(i) === key)) return prev.map(i => (cartKey(i) === key
        ? { ...i, qty: menuItem?.stock !== null && menuItem?.stock !== undefined ? Math.min(i.qty + 1, menuItem.stock) : i.qty + 1 }
        : i))
      return [...prev, { productId: menuItem?.id, restaurantId: rest.id, restaurantName: rest.name, name: item.name, price: item.price, qty: 1, stock: menuItem?.stock }]
    })
    if (openCart) setCartOpen(true)
  }

  useEffect(() => {
    const unavailable = cart.filter(cartItem => {
      const restaurant = repo.restaurants.find(item => item.id === cartItem.restaurantId)
      return restaurant?.items.find(item => item.name === cartItem.name)?.available === false
        || restaurant?.items.find(item => item.name === cartItem.name)?.stock === 0
    })
    if (unavailable.length === 0) return

    const unavailableKeys = new Set(unavailable.map(item => cartKey(item)))
    const unseen = unavailable.filter(item => !alertedUnavailable.current.has(cartKey(item)))
    unavailable.forEach(item => alertedUnavailable.current.add(cartKey(item)))
    setCart(current => current.filter(item => !unavailableKeys.has(cartKey(item))))
    if (unseen.length > 0) {
      window.alert(unseen.map(item => item.name).join(', ') + (unseen.length === 1 ? ' quedó agotado y se eliminó del carrito.' : ' quedaron agotados y se eliminaron del carrito.'))
    }
  }, [repo.restaurants, cart])

  const removeFromCart = (key: string) => {
    setCart(prev => prev.filter(i => cartKey(i) !== key))
  }

  const activeMyOrders = myOrders.filter(o => o.status !== 'entregado' && o.status !== 'cancelado').length
  const ratingOf = (r: Restaurant) => displayRating(r.rating, ordersRepo.orders, r.id)

  const selected = repo.restaurants.find(r => r.id === selectedId) ?? null
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0)
  const cartRestaurantIds = [...new Set(cart.map(i => i.restaurantId))]
  // Envío por distancia real de ruta (restaurante → ubicación del cliente). Sin ubicación aún no hay tarifa.
  const idsKey = cartRestaurantIds.join(',')
  const [quotes, setQuotes] = useState<Record<string, DeliveryQuote>>({})
  const [quoting, setQuoting] = useState(false)
  useEffect(() => {
    if (!location) {
      setQuotes({})
      return
    }
    let cancelled = false
    setQuoting(true)
    Promise.all(
      idsKey.split(',').filter(Boolean).map(async id => [id, await quoteDelivery(repo.restaurants.find(r => r.id === id), location)] as const),
    ).then(entries => {
      if (cancelled) return
      setQuotes(Object.fromEntries(entries))
      setQuoting(false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, idsKey])
  const quoteOf = (id: string) => (location ? quotes[id] ?? null : null)
  const quotesReady = !location || (!quoting && cartRestaurantIds.every(id => quotes[id]))
  const feeOf = (id: string) => quoteOf(id)?.fee ?? 0
  const outOfRange = cartRestaurantIds.some(id => quoteOf(id)?.outOfRange)
  const deliveryTotal = cartRestaurantIds.reduce((s, id) => s + feeOf(id), 0)
  const total = subtotal + deliveryTotal
  const cartCount = cart.reduce((s, i) => s + i.qty, 0)

  const startCheckout = () => {
    setCartOpen(false)
    if (customer) setCheckoutOpen(true)
    else setAuthOpen('checkout')
  }

  const openMyOrders = () => {
    if (customer) setMyOrdersOpen(true)
    else setAuthOpen('orders')
  }

  const onAuthDone = () => {
    const next = authOpen
    setAuthOpen(null)
    if (next === 'checkout') setCheckoutOpen(true)
    if (next === 'orders') setMyOrdersOpen(true)
  }

  const placeOrder = async () => {
    if (placeOrderLock.current || !customer || !location || outOfRange || !quotesReady) return
    placeOrderLock.current = true
    setOrderSubmitting(true)
    setOrderError('')
    try {
      const createdInputs = await Promise.all(cartRestaurantIds.map(async id => {
        const lines = cart.filter(i => i.restaurantId === id)
        await crearPedido({
          codigo: customer.id,
          telefono: customer.phone,
          id_restaurante: id,
          lat: location.lat,
          lng: location.lng,
          precision_m: Math.round(location.accuracy),
          items: lines.map(line => ({ id_producto: line.productId ?? '', cantidad: line.qty })),
          referencia: payOf(id).ref.trim(),
        })
        const sub = lines.reduce((s, i) => s + i.price * i.qty, 0)
        const fee = feeOf(id)
        const distanceKm = quoteOf(id)?.km
        return {
          restaurantId: id,
          restaurantName: lines[0].restaurantName,
          items: lines.map(({ name, price, qty }) => ({ name, price, qty })),
          subtotal: sub,
          deliveryFee: fee,
          distanceKm,
          total: sub + fee,
          customerId: customer.id,
          customerName: customer.name,
          customerPhone: customer.phone,
          location: location ?? undefined,
          payment: { method: 'pago_movil' as const, reference: payOf(id).ref.trim(), proof: payOf(id).proof! },
        }
      }))
      const created = ordersRepo.addMany(createdInputs)
    created.forEach(o => void notifyOrderByWhatsApp(o, repo.restaurants.find(r => r.id === o.restaurantId)?.whatsapp))
    setOrdersRefresh(refresh => refresh + 1)
    setCheckoutOpen(false)
    setLocation(null)
    setLocStatus('idle')
    setPays({})
    setMyOrdersOpen(true)
    setCartOpen(false)
    setCart([])
    } catch (orderFailure) {
      const message = orderFailure instanceof Error ? orderFailure.message : String(orderFailure)
      console.error('[cliente] confirmar pedido', orderFailure)
      if (/cliente no encontrado/i.test(message)) {
        const notice = 'Tu cuenta no se encontró: regístrate de nuevo o entra con tu código'
        customersRepo.logout(notice)
        setCheckoutOpen(false)
        setAuthOpen('plain')
        return
      }
      const stockFailure = /Stock insuficiente|no disponible/i.test(message)
      const visibleMessage = /failed to fetch|network|fetch/i.test(message)
        ? 'No se pudo contactar con el servidor: revisa tu conexión e intenta de nuevo.'
        : message
      setOrderError(visibleMessage)
      if (stockFailure) {
        const fresh = await repo.reload()
        setCart(current => current.flatMap(line => {
          const freshStock = fresh.find(r => r.id === line.restaurantId)?.items.find(item => item.name === line.name)?.stock
          const availableItem = fresh.find(r => r.id === line.restaurantId)?.items.find(item => item.name === line.name)
          if (availableItem?.available === false || freshStock === 0) return []
          return [{ ...line, qty: freshStock === null || freshStock === undefined ? line.qty : Math.min(line.qty, freshStock), stock: freshStock }]
        }))
      }
    } finally {
      placeOrderLock.current = false
      setOrderSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#f5f5f5] overflow-x-hidden">
      {expiredLink && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[110] w-[calc(100%-2rem)] max-w-lg bg-[#111] border border-[#2a2a2a] rounded-2xl p-4 shadow-xl">
          <p className="text-sm text-[#ddd]">El enlace venció o ya se usó: pide uno nuevo</p>
          <button type="button" onClick={requestNewPasswordLink} className="mt-3 text-sm text-[#4d8cff] hover:text-[#82abff] font-bold">
            Solicitar nuevo enlace
          </button>
        </div>
      )}
      {recoveryEmail !== null && (
        <PasswordRecoveryModal
          email={recoveryEmail}
          onClose={() => {
            setRecoveryEmail(null)
            recoveryEmailRef.current = ''
          }}
        />
      )}
      <EmailChangeModal suppressError={expiredLink} />
      {customersRepo.notice && !authOpen && (
        <div role="alert" className="fixed top-20 left-1/2 -translate-x-1/2 z-[80] w-[calc(100%-2rem)] max-w-lg bg-[#111] border border-red-500/30 rounded-2xl p-4 shadow-xl">
          <p className="text-sm text-red-300">{customersRepo.notice}</p>
          <button type="button" onClick={() => setAuthOpen('plain')} className="mt-2 text-sm text-[#4d8cff] font-bold">
            Registrarme o entrar
          </button>
        </div>
      )}

      {/* NAV */}
      <nav className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-[#1e1e1e] px-3 sm:px-4 md:px-8 h-16 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#2563eb] rounded-lg flex items-center justify-center">
            <span className="text-white font-display font-black text-sm">B</span>
          </div>
          <span className="hidden min-[380px]:inline font-display font-black text-xl tracking-tight">
            boom<span className="text-[#3b82f6]">bly</span>
          </span>
        </div>

        <div className="hidden md:flex items-center gap-1 bg-[#141414] rounded-xl px-3 py-2 w-72 border border-[#2a2a2a] focus-within:border-[#2563eb] transition-colors">
          <svg className="w-4 h-4 text-[#666] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Busca restaurantes o platillos..."
            className="bg-transparent text-sm flex-1 outline-none text-[#f5f5f5] placeholder:text-[#555]"
          />
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3 ml-auto">
          <button className="text-sm text-[#888] hover:text-white transition-colors hidden md:block">
            📍 Lara, Barquisimeto
          </button>
          <button
            onClick={openMyOrders}
            className="relative text-xs sm:text-sm text-[#888] hover:text-white border border-[#2a2a2a] hover:border-[#2563eb] transition-colors rounded-xl px-2.5 sm:px-3 py-2 font-display font-semibold"
          >
            <span className="sm:hidden">Pedidos</span>
            <span className="hidden sm:inline">Mis pedidos</span>
            {activeMyOrders > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-[#3b82f6] text-white text-[10px] font-black rounded-full w-4 h-4 flex items-center justify-center">
                {activeMyOrders}
              </span>
            )}
          </button>
          {customer ? (
            <button
              onClick={() => confirm(`¿Cerrar la sesión de ${customer.name}?`) && customersRepo.logout()}
              title="Cerrar sesión"
              className="hidden md:flex flex-col items-end leading-tight text-xs text-[#888] hover:text-white transition-colors"
            >
              <span className="font-display font-semibold text-white">{customer.name.split(' ')[0]}</span>
              <span className="font-mono text-[#3b82f6]">{customer.id}</span>
            </button>
          ) : (
            <button
              onClick={() => setAuthOpen('plain')}
              className="text-xs sm:text-sm text-[#888] hover:text-white border border-[#2a2a2a] hover:border-[#2563eb] transition-colors rounded-xl px-2.5 sm:px-3 py-2 font-display font-semibold"
            >
              <span className="sm:hidden">Entrar</span>
              <span className="hidden sm:inline">Ingresar</span>
            </button>
          )}
          <button
            onClick={() => setAdminOpen(true)}
            className="hidden sm:block text-sm text-[#888] hover:text-white border border-[#2a2a2a] hover:border-[#2563eb] transition-colors rounded-xl px-3 py-2 font-display font-semibold"
          >
            Admin
          </button>
          <button
            onClick={() => setRestaurantPanelOpen(true)}
            className="text-xs sm:text-sm text-[#888] hover:text-white border border-[#2a2a2a] hover:border-[#2563eb] transition-colors rounded-xl px-2.5 sm:px-3 py-2 font-display font-semibold"
          >
            Soy restaurante
          </button>
          <button
            onClick={() => setCartOpen(!cartOpen)}
            className="relative bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors rounded-xl px-3 sm:px-4 py-2 flex items-center gap-2 font-display font-semibold text-sm"
          >
            <span>🛒</span>
            {cartCount > 0 && (
              <span className="bg-white text-[#3b82f6] text-xs font-black rounded-full w-5 h-5 flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>
        </div>
      </nav>
      <main className="px-4 md:px-8 max-w-7xl mx-auto pb-16">

        {/* HERO */}
        <section className="pt-10 pb-6">
          <p className="text-[#3b82f6] font-display font-semibold text-sm tracking-widest uppercase mb-2">
            Entrega en menos de 30 min
          </p>
          <h1 className="font-display font-black text-4xl md:text-6xl leading-none tracking-tight mb-4">
            Comida que<br />
            <span className="text-[#3b82f6]">llega rápido.</span>
          </h1>
          <p className="text-[#888] text-base md:text-lg max-w-md">
            Los mejores restaurantes de tu ciudad, en un solo lugar. Pide ahora y recibe en tu puerta.
          </p>

          {/* mobile search */}
          <div className="md:hidden mt-5 flex items-center gap-2 bg-[#141414] rounded-xl px-3 py-3 border border-[#2a2a2a] focus-within:border-[#2563eb] transition-colors">
            <svg className="w-4 h-4 text-[#666]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Busca restaurantes..."
              className="bg-transparent text-sm flex-1 outline-none placeholder:text-[#555]"
            />
          </div>
        </section>

        {/* STATS */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-8">
          {[
            { label: 'Restaurantes', value: String(repo.restaurants.filter(r => r.active).length), icon: '🍽️', pulse: true },
            { label: 'Tiempo promedio', value: '24 min', icon: '⚡' },
            { label: 'Satisfacción', value: '98%', icon: '⭐' },
          ].map(s => (
            <div key={s.label} className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-2.5 sm:p-4 text-center">
              <div className="text-2xl mb-1">{s.icon}</div>
              <div key={s.pulse ? s.value : undefined} className={`font-display font-black text-lg sm:text-xl text-white ${s.pulse ? 'count-pop' : ''}`}>{s.value}</div>
              <div className="text-[#666] text-[10px] sm:text-xs leading-tight">{s.label}</div>
            </div>
          ))}
        </div>

        {/* CATEGORIES */}
        <div className="flex gap-2 overflow-x-auto category-scroll pb-2 mb-8">
          {categoryFilters.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-full font-display font-semibold text-sm transition-all ${
                selectedCategory === cat.id
                  ? 'bg-[#2563eb] text-white'
                  : 'bg-[#141414] text-[#888] hover:text-white border border-[#2a2a2a]'
              }`}
            >
              <span>{cat.emoji ?? ''}</span>
              <span>{cat.nombre}</span>
            </button>
          ))}
        </div>

        {/* RESTAURANTS GRID */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-black text-2xl">
              {selectedCategory === 'all' ? 'Todos los restaurantes' : categoryFilters.find(category => category.id === selectedCategory)?.nombre}
              <span className="text-[#555] font-normal text-base ml-2">({filtered.length})</span>
            </h2>
          </div>

          {categoriesError && <p className="text-red-400 text-sm mb-4">No se pudieron cargar las categorías: {categoriesError}</p>}
          {repo.error && <p className="text-red-400 text-sm mb-4">No se pudo actualizar la lista de restaurantes: {repo.error}</p>}
          {filtered.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-6xl mb-4">🔍</div>
              <p className="font-display font-bold text-xl text-[#555]">Sin resultados</p>
              <p className="text-[#444] text-sm mt-1">Intenta con otro término</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(rest => (
                <div
                  key={rest.id}
                  className="bg-[#141414] border border-[#1e1e1e] rounded-2xl overflow-hidden hover:border-[#2563eb]/40 transition-all group cursor-pointer"
                  onClick={() => setSelectedId(rest.id)}
                >
                  <div className="relative overflow-hidden h-44 bg-[#1c1c1c]">
                    <div className="absolute inset-0 grid place-items-center font-display font-black text-5xl text-[#555]" aria-hidden="true">
                      {rest.name.charAt(0).toUpperCase()}
                    </div>
                    {rest.img && (
                      <img
                        src={rest.img}
                        alt={rest.name}
                        onError={event => {
                          console.error('[foto] mostrar foto del menú', new Error(`No se pudo cargar la foto de ${rest.name}`))
                          event.currentTarget.style.display = 'none'
                        }}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    {rest.tag && (
                      <span className={`absolute top-3 left-3 text-xs font-display font-black px-2 py-1 rounded-lg ${TAG_COLORS[rest.tag] || 'bg-[#2563eb] text-white'}`}>
                        {rest.tag}
                      </span>
                    )}
                    <div className="absolute bottom-3 left-3 flex items-center gap-1 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-lg">
                      <span className="text-yellow-400 text-xs">★</span>
                      <span className="text-white font-display font-bold text-xs">{ratingOf(rest).value.toFixed(1)}</span>
                    </div>
                  </div>

                  <div className="p-4">
                    <h3 className="font-display font-black text-lg leading-tight mb-1">{rest.name}</h3>
                    <p className="text-[#888] text-xs mb-2">
                      {rest.categoryName
                        ? `${rest.categoryEmoji ? `${rest.categoryEmoji} ` : ''}${rest.categoryName}`
                        : 'Sin categoría'}
                    </p>
                    <div className="flex items-center gap-3 text-[#666] text-xs mb-3">
                      <span>⏱ {rest.time}</span>
                      <span>•</span>
                      <span>Envío desde $ {DELIVERY.MIN_FEE.toFixed(2)}</span>
                    </div>

                    <div className="flex gap-1 flex-wrap">
                      {rest.items.map((item, i) => (
                        <span key={i} className="text-xs bg-[#1c1c1c] text-[#666] px-2 py-0.5 rounded-full">{item.name}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* RESTAURANT MODAL */}
      {selected && (
        <div className="fixed inset-0 z-[55] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setSelectedId(null)}>
          <div
            className="w-full max-w-lg max-h-[92dvh] flex flex-col bg-[#111] border border-[#1e1e1e] rounded-t-3xl sm:rounded-3xl overflow-hidden slide-up"
            onClick={e => e.stopPropagation()}
          >
            <div className="relative h-44 shrink-0 bg-[#1c1c1c]">
              <div className="absolute inset-0 grid place-items-center font-display font-black text-5xl text-[#555]" aria-hidden="true">
                {selected.name.charAt(0).toUpperCase()}
              </div>
              {selected.img && (
                <img
                  src={selected.img}
                  alt={selected.name}
                  onError={event => {
                    console.error('[foto] mostrar foto del restaurante', new Error(`No se pudo cargar la foto de ${selected.name}`))
                    event.currentTarget.style.display = 'none'
                  }}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#111] via-black/20 to-transparent" />
              <button
                onClick={() => setSelectedId(null)}
                aria-label="Cerrar"
                className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/60 hover:bg-[#2563eb] transition-colors flex items-center justify-center"
              >
                ✕
              </button>
              <div className="absolute bottom-3 left-5 right-5">
                <h2 className="font-display font-black text-2xl leading-tight">{selected.name}</h2>
                <p className="text-xs text-[#aaa] mt-1">
                  <span className="text-yellow-400">★</span> {ratingOf(selected).value.toFixed(1)}{ratingOf(selected).count > 0 && ` (${ratingOf(selected).count})`} · ⏱ {selected.time} ·{' '}
                  Envío desde $ {DELIVERY.MIN_FEE.toFixed(2)}
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-2">
              <p className="text-[#555] text-xs font-semibold uppercase tracking-wider mb-2">Menú</p>
              {selected.items.map(item => {
                const qty = cart.find(c => cartKey(c) === cartKey({ restaurantId: selected.id, name: item.name }))?.qty ?? 0
                return (
                  <div key={item.name} className={`flex items-center justify-between gap-3 border rounded-xl p-3 ${item.available === false || item.stock === 0 ? 'bg-[#0d0d0d] border-[#242424] opacity-55 grayscale' : 'bg-[#141414] border-[#1e1e1e]'}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-16 h-16 shrink-0 rounded-xl bg-[#1c1c1c] overflow-hidden flex items-center justify-center text-2xl">
                        {item.img ? (
                          <img src={item.img} alt={item.name} className="w-full h-full object-cover" />
                        ) : (
                          selected.categoryEmoji ?? '🍽️'
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-display font-semibold text-sm truncate">{item.name}</p>
                        {item.description && <p className="text-[11px] text-[#777] line-clamp-2 mt-0.5">{item.description}</p>}
                        <p className="text-[#3b82f6] text-xs font-bold">$ {item.price.toFixed(2)}</p>
                        {(item.available === false || item.stock === 0) && (
                          <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide text-red-400">Agotado</span>
                        )}
                        {item.available !== false && item.stock !== null && item.stock !== undefined && item.stock > 0 && item.stock <= 5 && (
                          <span className="inline-block mt-1 text-[10px] font-bold text-yellow-400">Quedan {item.stock}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => addToCart(selected, item, false)}
                      disabled={item.available === false || item.stock === 0 || (item.stock !== null && item.stock !== undefined && qty >= item.stock)}
                      className="shrink-0 text-xs bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#333] disabled:text-[#777] disabled:cursor-not-allowed transition-colors px-4 py-2 rounded-lg font-display font-bold"
                    >
                      {qty > 0 ? `Agregar (${qty})` : 'Agregar'}
                    </button>
                  </div>
                )
              })}
            </div>

            {cartCount > 0 && (
              <div className="p-4 border-t border-[#1e1e1e]">
                <button
                  onClick={() => { setSelectedId(null); setCartOpen(true) }}
                  className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors py-3 rounded-xl font-display font-black flex items-center justify-between px-5"
                >
                  <span>Ver pedido ({cartCount})</span>
                  <span>$ {total.toFixed(2)}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CHECKOUT */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-[65] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={closeCheckout}>
          <div className="w-full max-w-md max-h-[92dvh] overflow-y-auto bg-[#111] border border-[#1e1e1e] rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display font-black text-xl">Datos para la entrega</h2>
              <button onClick={closeCheckout} aria-label="Cerrar" className="text-[#555] hover:text-white text-xl">✕</button>
            </div>

            {customer && (
              <div className="bg-[#2563eb]/10 border border-[#2563eb]/30 rounded-xl p-3 mb-5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display font-bold truncate">{customer.name}</p>
                  <p className="text-xs text-[#999]">📱 {customer.phone}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-[#888] uppercase tracking-wider">Cliente</p>
                  <p className="font-mono font-bold text-[#3b82f6]">{customer.id}</p>
                </div>
              </div>
            )}

            <label className="block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-1.5">Ubicación en tiempo real</label>
            {locStatus === 'ok' && location ? (
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 text-sm">
                <p className="text-green-400 font-display font-semibold flex items-center gap-2">
                  <span className="pulse-dot w-2 h-2 bg-green-400 rounded-full block" /> Ubicación compartida
                </p>
                <p className="text-[#999] text-xs mt-1">
                  {location.lat.toFixed(5)}, {location.lng.toFixed(5)} · precisión ±{Math.round(location.accuracy)} m
                </p>
                <a href={mapsUrl(location.lat, location.lng)} target="_blank" rel="noreferrer" className="text-[#3b82f6] text-xs hover:underline">
                  Ver en el mapa
                </a>
              </div>
            ) : (
              <>
                <button
                  onClick={requestLocation}
                  disabled={locStatus === 'loading'}
                  className="w-full border border-[#2563eb] text-[#3b82f6] hover:bg-[#2563eb] hover:text-white disabled:opacity-60 transition-colors py-3 rounded-xl font-display font-bold text-sm"
                >
                  {locStatus === 'loading' ? 'Obteniendo ubicación…' : '📍 Compartir mi ubicación'}
                </button>
                {locStatus === 'idle' && (
                  <p className="text-[#777] text-xs mt-2">
                    Tu navegador te preguntará si deseas permitir o denegar el acceso a tu ubicación.
                  </p>
                )}
              </>
            )}
            {locStatus === 'error' && <p className="text-red-400 text-xs mt-2">{locError}</p>}

            {location && (
              <div className="mt-4 bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl p-3 text-sm space-y-1.5">
                <p className="text-xs font-display font-semibold text-[#888] uppercase tracking-wider">Costo de envío</p>
                {!quotesReady && <p className="text-[#777] text-xs">Calculando la ruta…</p>}
                {quotesReady && cartRestaurantIds.map(id => {
                  const q = quoteOf(id)
                  if (!q) return null
                  return (
                    <div key={id} className="flex justify-between gap-3">
                      <span className="text-[#777] truncate">{repo.restaurants.find(r => r.id === id)?.name} · {q.exact ? '' : '≈ '}{q.km.toFixed(1)} km{q.exact ? ' por ruta' : ' (estimado)'}</span>
                      <span className={`font-display font-semibold ${q.outOfRange ? 'text-red-400' : ''}`}>{q.outOfRange ? 'Fuera de cobertura' : `$ ${q.fee.toFixed(2)}`}</span>
                    </div>
                  )
                })}
                {outOfRange && <p className="text-red-400 text-xs">Solo entregamos dentro de un radio de {DELIVERY.MAX_KM} km del restaurante.</p>}
              </div>
            )}

            <label className="block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mt-5 mb-1.5">Pago móvil</label>
            {cartRestaurantIds.length > 1 && (
              <p className="text-[#777] text-xs mb-2">Tu pedido es de {cartRestaurantIds.length} restaurantes: realiza un pago móvil a cada uno.</p>
            )}
            <div className="space-y-3">
              {cartRestaurantIds.map(id => {
                const rest = repo.restaurants.find(r => r.id === id)
                const pm = rest?.pagoMovil ?? PAGO_MOVIL
                const pay = payOf(id)
                const amount = cart.filter(i => i.restaurantId === id).reduce((s, i) => s + i.price * i.qty, 0) + feeOf(id)
                return (
                  <div key={id} className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl p-3 text-sm">
                    <p className="font-display font-bold mb-2">{rest?.name ?? 'Restaurante'}</p>
                    <div className="space-y-1">
                      {([['Banco', pm.banco], ['Teléfono', pm.telefono], ['Cédula / RIF', pm.cedula]] as const).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-3">
                          <span className="text-[#777]">{k}</span>
                          <span className="font-display font-semibold text-right">{v}</span>
                        </div>
                      ))}
                      <div className="flex justify-between gap-3 border-t border-[#1e1e1e] pt-1.5 mt-1.5">
                        <span className="text-[#777]">Monto</span>
                        <span className="font-display font-black text-[#3b82f6] text-right">$ {amount.toFixed(2)} <span className="text-[10px] text-[#666] font-normal">al cambio del día en Bs.</span></span>
                      </div>
                    </div>
                    <input
                      value={pay.ref}
                      onChange={e => setPay(id, { ref: e.target.value.replace(/\D/g, '').slice(0, 20) })}
                      inputMode="numeric"
                      placeholder="N° de referencia del pago"
                      className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-3 text-sm outline-none focus:border-[#2563eb] transition-colors placeholder:text-[#555] mt-3"
                    />
                    {pay.proof ? (
                      <div className="mt-3 flex items-center gap-3 bg-green-500/10 border border-green-500/30 rounded-xl p-2">
                        <img src={pay.proof} alt="Capture del pago" className="w-14 h-14 object-cover rounded-lg" />
                        <p className="text-green-400 text-sm font-display font-semibold flex-1">Capture cargado</p>
                        <button onClick={() => setPay(id, { proof: null })} className="text-xs text-[#999] hover:text-white px-2">Cambiar</button>
                      </div>
                    ) : (
                      <label className="mt-3 flex items-center justify-center gap-2 cursor-pointer border border-dashed border-[#2563eb] text-[#3b82f6] hover:bg-[#2563eb]/10 transition-colors py-3 rounded-xl font-display font-bold text-sm">
                        🧾 Subir capture del pago
                        <input type="file" accept="image/*" className="hidden" onChange={e => { void onProofChange(id, e.target.files?.[0]); e.target.value = '' }} />
                      </label>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex justify-between font-display font-black text-lg border-t border-[#1e1e1e] mt-6 pt-4">
              <span>Total a pagar</span>
              <span className="text-[#3b82f6]">$ {total.toFixed(2)}</span>
            </div>
            {orderError && <p className="text-red-400 text-xs mt-3 text-center">{orderError}</p>}
            <button
              onClick={() => void placeOrder()}
              disabled={orderSubmitting || !customer || !location || !quotesReady || outOfRange || cartRestaurantIds.some(id => payOf(id).ref.trim().length < 4 || !payOf(id).proof)}
              className="w-full mt-4 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#1c1c1c] disabled:text-[#555] disabled:cursor-not-allowed transition-colors py-4 rounded-xl font-display font-black text-lg"
            >
              {orderSubmitting ? 'Procesando pedido…' : 'Confirmar pedido →'}
            </button>
            {!location && <p className="text-[11px] text-[#777] text-center mt-2">Comparte tu ubicación para calcular el envío.</p>}
            <p className="text-[11px] text-[#555] text-center mt-3">Cada pedido recibe su propio código de seguimiento y se envía por WhatsApp al restaurante con tus datos y ubicación.</p>
          </div>
        </div>
      )}

      {myOrdersOpen && customer && <MyOrders customer={customer} orders={myOrders} loading={myOrdersLoading} error={myOrdersError} onLogout={() => { customersRepo.logout(); setMyOrdersOpen(false) }} onClose={() => setMyOrdersOpen(false)} />}

      {authOpen && <CustomerAuth onRegister={customersRepo.register} onLogin={customersRepo.login} onDone={onAuthDone} onClose={() => setAuthOpen(null)} notice={customersRepo.notice} />}

      {adminOpen && <AdminPanel auth={auth} repo={repo} ordersRepo={ordersRepo} onClose={() => setAdminOpen(false)} />}
      {restaurantPanelOpen && <RestaurantPanel onClose={() => setRestaurantPanelOpen(false)} />}

      {/* CART PANEL */}
      {cartOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setCartOpen(false)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-sm bg-[#111] border-l border-[#1e1e1e] z-50 flex flex-col slide-up">
            <div className="p-5 border-b border-[#1e1e1e] flex items-center justify-between">
              <h2 className="font-display font-black text-xl">Tu pedido 🛒</h2>
              <button onClick={() => setCartOpen(false)} className="text-[#555] hover:text-white transition-colors text-xl">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {cart.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-3">🍽️</div>
                  <p className="font-display font-bold text-[#555]">Tu carrito está vacío</p>
                  <p className="text-xs text-[#444] mt-1">Agrega algo rico</p>
                </div>
              ) : cart.map(item => (
                <div key={cartKey(item)} className="flex items-center gap-3 bg-[#141414] rounded-xl p-3">
                  <div className="flex-1">
                    <p className="font-display font-semibold text-sm">{item.name}</p>
                    <p className="text-[#555] text-[11px]">{item.restaurantName} · x{item.qty}</p>
                    <p className="text-[#3b82f6] text-xs font-bold">$ {(item.price * item.qty).toFixed(2)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={item.qty >= 1 && item.stock !== null && item.stock !== undefined && item.qty >= item.stock}
                      onClick={() => {
                        setCart(current => current.map(cartItem => cartKey(cartItem) === cartKey(item)
                          ? { ...cartItem, qty: cartItem.stock !== null && cartItem.stock !== undefined ? Math.min(cartItem.qty + 1, cartItem.stock) : cartItem.qty + 1 }
                          : cartItem))
                      }}
                      className="text-[#aaa] hover:text-white disabled:text-[#444] text-sm"
                    >
                      +
                    </button>
                    <span className="bg-[#1c1c1c] text-[#888] text-xs w-6 h-6 rounded-full flex items-center justify-center font-bold">
                      {item.qty}
                    </span>
                    <button onClick={() => removeFromCart(cartKey(item))} className="text-[#555] hover:text-red-400 transition-colors text-sm">✕</button>
                  </div>
                </div>
              ))}
            </div>

            {cart.length > 0 && (
              <div className="p-5 border-t border-[#1e1e1e] space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-[#666]">Subtotal</span>
                  <span className="font-semibold">$ {subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#666]">Delivery</span>
                  <span className="text-[#888] font-semibold">{location ? `$ ${deliveryTotal.toFixed(2)}` : 'Se calcula con tu ubicación'}</span>
                </div>
                <div className="flex justify-between font-display font-black text-lg border-t border-[#1e1e1e] pt-3">
                  <span>Total</span>
                  <span className="text-[#3b82f6]">$ {total.toFixed(2)}</span>
                </div>
                <button
                  onClick={startCheckout}
                  className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors py-4 rounded-xl font-display font-black text-lg"
                >
                  Continuar al pago →
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
