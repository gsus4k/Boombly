import { useMemo, useState } from 'react'
import { phoneDigits, type Customer } from '../data/customer'
import { STATUS_META, type Order } from '../data/orders'
import type { Restaurant } from '../data/types'

const inputCls =
  'bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#2563eb] transition-colors'
const labelCls = 'block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-1.5'
const fmt = (t: number) =>
  new Date(t).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function Customers({
  restaurants,
  customers,
  orders,
}: {
  restaurants: Restaurant[]
  customers: Customer[]
  orders: Order[]
}) {
  const [restId, setRestId] = useState('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    const td = phoneDigits(t)
    return customers
      .map(c => {
        const mine = orders.filter(o => o.customerId === c.id && (restId === 'all' || o.restaurantId === restId))
        const valid = mine.filter(o => o.status !== 'cancelado')
        return {
          c,
          orders: mine,
          spent: valid.reduce((s, o) => s + o.total, 0),
          last: mine.reduce((m, o) => Math.max(m, o.createdAt), 0),
          places: [...new Set(mine.map(o => o.restaurantName))],
        }
      })
      .filter(r => restId === 'all' || r.orders.length > 0)
      .filter(
        r =>
          !t ||
          r.c.name.toLowerCase().includes(t) ||
          r.c.id.toLowerCase().includes(t) ||
          (td.length > 2 && phoneDigits(r.c.phone).includes(td)),
      )
      .sort((a, b) => (b.last || b.c.createdAt) - (a.last || a.c.createdAt))
  }, [customers, orders, restId, q])

  return (
    <div className="space-y-4">
      <div className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-4 flex flex-wrap gap-4 items-end">
        <div className="min-w-48 flex-1">
          <label className={labelCls}>Restaurante</label>
          <select className={`${inputCls} w-full`} value={restId} onChange={e => setRestId(e.target.value)}>
            <option value="all">Todos (clientes registrados)</option>
            {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="min-w-48 flex-1">
          <label className={labelCls}>Buscar cliente</label>
          <input className={`${inputCls} w-full`} value={q} onChange={e => setQ(e.target.value)} placeholder="Nombre, teléfono o CL-…" />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-14 bg-[#141414] border border-[#1e1e1e] rounded-2xl">
          <div className="text-5xl mb-3">👥</div>
          <p className="font-display font-bold text-[#777]">Sin clientes para mostrar</p>
          <p className="text-xs text-[#555] mt-1">Los clientes aparecen aquí cuando se registran en la app.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(({ c, orders: os, spent, last, places }) => (
            <div key={c.id} className="bg-[#141414] border border-[#1e1e1e] rounded-xl">
              <button onClick={() => setOpen(open === c.id ? null : c.id)} className="w-full text-left p-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <div className="flex-1 min-w-48">
                  <p className="font-display font-bold">{c.name}</p>
                  <p className="text-xs text-[#888]">
                    <span className="font-mono text-[#3b82f6]">{c.id}</span> · 📱 {c.phone}
                  </p>
                </div>
                <div className="text-xs text-[#888] min-w-32">
                  <p>{os.length} pedido{os.length === 1 ? '' : 's'} · <span className="text-white font-semibold">$ {spent.toFixed(2)}</span></p>
                  <p className="truncate">{places.join(', ') || 'Sin pedidos aún'}</p>
                </div>
                <p className="text-[11px] text-[#555] whitespace-nowrap">
                  {last ? `Último: ${fmt(last)}` : `Registro: ${fmt(c.createdAt)}`}
                </p>
                <span className="text-[#555] text-xs">{open === c.id ? '▲' : '▼'}</span>
              </button>
              {open === c.id && (
                <div className="border-t border-[#1e1e1e] p-3 space-y-2">
                  <p className="text-[11px] text-[#666]">Cliente desde {fmt(c.createdAt)}</p>
                  {os.length === 0 && <p className="text-xs text-[#555]">Este cliente no tiene pedidos{restId !== 'all' ? ' en este restaurante' : ''}.</p>}
                  {os.map(o => (
                    <div key={o.id} className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-lg p-2.5 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="font-mono font-bold text-white">{o.id}</span>
                      <span className="text-[#888]">{fmt(o.createdAt)}</span>
                      <span className="font-semibold">{o.restaurantName}</span>
                      <span className="text-[#888] flex-1 min-w-40">{o.items.map(i => `${i.qty}× ${i.name}`).join(', ')}</span>
                      {o.location && (
                        <a href={`https://www.google.com/maps?q=${o.location.lat},${o.location.lng}`} target="_blank" rel="noreferrer" className="text-[#3b82f6] hover:underline">📍 Ubicación</a>
                      )}
                      <span className="font-semibold">$ {o.total.toFixed(2)}</span>
                      <span className={`px-2 py-0.5 rounded-md font-display font-semibold ${STATUS_META[o.status].cls}`}>{STATUS_META[o.status].label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
