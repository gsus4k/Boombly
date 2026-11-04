import { useState } from 'react'
import type { Customer } from '../data/customer'
import { STATUS_FLOW, STATUS_META, type Order } from '../data/orders'

function Stars({ value, onChange, size = 'text-3xl' }: { value: number; onChange?: (n: number) => void; size?: string }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onMouseEnter={() => onChange && setHover(n)}
          onClick={() => onChange?.(n)}
          aria-label={`${n} estrellas`}
          className={`${size} leading-none transition-transform ${onChange ? 'hover:scale-110 cursor-pointer' : 'cursor-default'} ${n <= (hover || value) ? 'text-yellow-400' : 'text-[#333]'}`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

function Tracker({ status }: { status: Order['status'] }) {
  if (status === 'cancelado') return <p className="text-red-400 text-sm font-display font-semibold">Pedido cancelado</p>
  const idx = STATUS_FLOW.indexOf(status)
  return (
    <div className="flex items-start">
      {STATUS_FLOW.map((s, i) => {
        const done = i <= idx
        const current = i === idx && status !== 'entregado'
        return (
          <div key={s} className="flex-1 flex flex-col items-center relative">
            {i > 0 && <div className={`absolute top-4 right-1/2 w-full h-0.5 ${i <= idx ? 'bg-[#2563eb]' : 'bg-[#2a2a2a]'}`} />}
            <div
              className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-sm transition-colors ${done ? 'bg-[#2563eb]' : 'bg-[#1c1c1c] grayscale opacity-60'} ${current ? 'ring-4 ring-[#2563eb]/30' : ''}`}
            >
              {STATUS_META[s].emoji}
            </div>
            <span className={`mt-1.5 text-[11px] font-display font-semibold ${done ? 'text-white' : 'text-[#555]'}`}>{STATUS_META[s].label}</span>
          </div>
        )
      })}
    </div>
  )
}

function RateBox({ order, onRate }: { order: Order; onRate: (id: string, rating: number, review: string) => void }) {
  const [stars, setStars] = useState(0)
  const [review, setReview] = useState('')

  if (order.rating) {
    return (
      <div className="mt-4 pt-4 border-t border-[#1e1e1e]">
        <p className="text-xs text-[#666] mb-1">Tu calificación</p>
        <Stars value={order.rating} size="text-xl" />
        {order.review && <p className="text-sm text-[#aaa] mt-2 italic">“{order.review}”</p>}
      </div>
    )
  }
  return (
    <div className="mt-4 pt-4 border-t border-[#1e1e1e]">
      <p className="font-display font-bold text-sm mb-2">¿Cómo estuvo el servicio?</p>
      <Stars value={stars} onChange={setStars} />
      {stars > 0 && (
        <>
          <textarea
            value={review}
            onChange={e => setReview(e.target.value)}
            maxLength={200}
            placeholder="Cuéntanos más (opcional)"
            className="w-full mt-3 h-16 resize-none bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-2 text-sm outline-none focus:border-[#2563eb] placeholder:text-[#555]"
          />
          <button
            onClick={() => onRate(order.id, stars, review)}
            className="mt-2 w-full bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors py-2.5 rounded-xl font-display font-black text-sm"
          >
            Enviar calificación
          </button>
        </>
      )}
    </div>
  )
}

export { Stars }

export default function MyOrders({
  customer,
  orders,
  onRate,
  onLogout,
  onClose,
}: {
  customer: Customer
  orders: Order[]
  onRate: (id: string, rating: number, review: string) => void
  onLogout: () => void
  onClose: () => void
}) {
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
            <button onClick={onLogout} className="text-[11px] text-[#888] hover:text-white underline mt-2">Cerrar sesión</button>
          </div>
          {orders.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-3">🧾</div>
              <p className="font-display font-bold text-[#555]">Aún no has hecho pedidos</p>
            </div>
          ) : (
            orders.map(o => (
              <div key={o.id} className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <p className="font-display font-black truncate">{o.restaurantName}</p>
                    <p className="text-[11px] text-[#666]">Pedido <span className="font-mono font-bold text-white bg-[#1c1c1c] px-1.5 py-0.5 rounded">{o.id}</span> · {new Date(o.createdAt).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <span className="font-display font-black text-[#3b82f6]">$ {o.total.toFixed(2)}</span>
                </div>
                <Tracker status={o.status} />
                <p className="text-xs text-[#777] mt-4">{o.items.map(i => `${i.qty}× ${i.name}`).join(', ')}</p>
                {o.status === 'entregado' && <RateBox order={o} onRate={onRate} />}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
