import { useRef } from 'react'
import type { Customer } from '../data/customer'
import { STATUS_FLOW, STATUS_META, type OrderStatus } from '../data/orders'

export type CustomerOrder = {
  id: string
  restaurantId: string
  restaurantName: string
  createdAt: number
  subtotal: number
  deliveryFee: number
  total: number
  status: OrderStatus
  rating?: number
}

function Tracker({ status }: { status: OrderStatus }) {
  if (status === 'cancelado') return <p className="text-red-400 text-sm font-display font-semibold">Pedido cancelado</p>
  const idx = STATUS_FLOW.indexOf(status)
  return (
    <div className="flex items-start">
      {STATUS_FLOW.map((step, i) => {
        const done = i <= idx
        const current = i === idx && status !== 'entregado'
        return (
          <div key={step} className="flex-1 flex flex-col items-center relative">
            {i > 0 && <div className={`absolute top-4 right-1/2 w-full h-0.5 ${i <= idx ? 'bg-[#2563eb]' : 'bg-[#2a2a2a]'}`} />}
            <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-sm transition-colors ${done ? 'bg-[#2563eb]' : 'bg-[#1c1c1c] grayscale opacity-60'} ${current ? 'ring-4 ring-[#2563eb]/30' : ''}`}>
              {STATUS_META[step].emoji}
            </div>
            <span className={`mt-1.5 text-[11px] font-display font-semibold ${done ? 'text-white' : 'text-[#555]'}`}>{STATUS_META[step].label}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function MyOrders({
  customer,
  orders,
  loading,
  error,
  onLogout,
  onClose,
}: {
  customer: Customer
  orders: CustomerOrder[]
  loading: boolean
  error: string
  onLogout: () => void
  onClose: () => void
}) {
  const logoutLock = useRef(false)

  const logout = () => {
    if (logoutLock.current) return
    logoutLock.current = true
    onLogout()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[55]" onClick={onClose} />
      <div className="fixed inset-x-0 sm:left-auto sm:right-0 top-0 h-[100dvh] w-full sm:max-w-sm bg-[#111] border-l border-[#1e1e1e] z-[56] flex flex-col slide-up">
        <div className="p-5 border-b border-[#1e1e1e] flex items-center justify-between">
          <h2 className="font-display font-black text-xl">Mis pedidos 🛵</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-[#555] hover:text-white text-xl">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="bg-[#2563eb]/10 border border-[#2563eb]/30 rounded-2xl p-4">
            <p className="text-[11px] text-[#888] uppercase tracking-wider font-display font-semibold">Tu código de cliente</p>
            <p className="font-mono font-bold text-xl text-[#3b82f6]">{customer.id}</p>
            <p className="text-xs text-[#999] mt-1">{customer.name} · {customer.phone}</p>
            <button onClick={logout} disabled={logoutLock.current} className="text-[11px] text-[#888] hover:text-white underline mt-2 disabled:opacity-60">Cerrar sesión</button>
          </div>
          {loading && <p role="status" className="text-center text-sm text-[#888] py-8">Cargando tus pedidos…</p>}
          {error && <p role="alert" className="text-center text-sm text-red-400 py-8">{error}</p>}
          {!loading && !error && orders.length === 0 && (
            <div className="text-center py-16">
              <div className="text-5xl mb-3">🧾</div>
              <p className="font-display font-bold text-[#555]">Aún no has hecho pedidos</p>
            </div>
          )}
          {!error && orders.map(order => (
            <div key={order.id} className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <p className="font-display font-black truncate">{order.restaurantName}</p>
                  <p className="text-[11px] text-[#666]">Pedido <span className="font-mono font-bold text-white bg-[#1c1c1c] px-1.5 py-0.5 rounded">{order.id}</span> · {new Date(order.createdAt).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <span className="font-display font-black text-[#3b82f6]">$ {order.total.toFixed(2)}</span>
              </div>
              <Tracker status={order.status} />
              <p className="text-xs text-[#777] mt-4">Subtotal $ {order.subtotal.toFixed(2)} · Envío $ {order.deliveryFee.toFixed(2)}</p>
              {order.rating != null && <p className="text-xs text-yellow-400 mt-2">Calificación: {order.rating} ★</p>}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
