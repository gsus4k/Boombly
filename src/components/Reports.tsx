import { useMemo, useState } from 'react'
import { STATUS_FLOW, STATUS_META, type Order, type OrderStatus, type useOrders } from '../data/orders'
import type { Restaurant } from '../data/types'

type OrdersRepo = ReturnType<typeof useOrders>

const inputCls =
  'bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#2563eb] transition-colors'
const labelCls = 'block text-xs font-display font-semibold text-[#888] uppercase tracking-wider mb-1.5'

const PRESETS = [
  { id: 'today', label: 'Hoy', days: 0 },
  { id: '7', label: '7 días', days: 6 },
  { id: '30', label: '30 días', days: 29 },
  { id: 'all', label: 'Todo', days: -1 },
  { id: 'custom', label: 'Rango', days: -2 },
]

const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const startOf = (s: string) => new Date(`${s}T00:00:00`).getTime()
const endOf = (s: string) => new Date(`${s}T23:59:59.999`).getTime()
const money = (n: number) => `$ ${n.toFixed(2)}`
const fmtDate = (t: number) =>
  new Date(t).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`

function downloadCsv(rows: Order[], filename: string) {
  const head = ['Pedido', 'Fecha', 'Cliente', 'Cód. cliente', 'Teléfono', 'Ubicación', 'Restaurante', 'Productos', 'Subtotal', 'Envío', 'Total', 'Ref. pago móvil', 'Estado']
  const lines = rows.map(o =>
    [o.id, fmtDate(o.createdAt), o.customerName ?? '', o.customerId ?? '', o.customerPhone ?? '', o.location ? `https://www.google.com/maps?q=${o.location.lat},${o.location.lng}` : '', o.restaurantName, o.items.map(i => `${i.qty}x ${i.name}`).join('; '), o.subtotal.toFixed(2), o.deliveryFee.toFixed(2), o.total.toFixed(2), o.payment?.reference ?? '', o.status]
      .map(csvCell)
      .join(','),
  )
  const blob = new Blob(['﻿' + [head.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function Reports({ restaurants, ordersRepo }: { restaurants: Restaurant[]; ordersRepo: OrdersRepo }) {
  const today = ymd(new Date())
  const [restId, setRestId] = useState('all')
  const [preset, setPreset] = useState('7')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [q, setQ] = useState('')

  const { orders } = ordersRepo

  const range = useMemo(() => {
    if (preset === 'all') return [0, Infinity] as const
    if (preset === 'custom') return [startOf(from), endOf(to)] as const
    const days = PRESETS.find(p => p.id === preset)!.days
    const start = new Date()
    start.setDate(start.getDate() - days)
    return [startOf(ymd(start)), Date.now() + 1] as const
  }, [preset, from, to])

  const filtered = useMemo(
    () => {
      const t = q.trim().toLowerCase()
      const td = t.replace(/\D/g, '')
      return orders.filter(
        o =>
          (restId === 'all' || o.restaurantId === restId) &&
          o.createdAt >= range[0] &&
          o.createdAt <= range[1] &&
          (!t ||
            o.id.toLowerCase().includes(t) ||
            (o.customerId ?? '').toLowerCase().includes(t) ||
            (o.customerName ?? '').toLowerCase().includes(t) ||
            (td.length > 2 && (o.customerPhone ?? '').replace(/\D/g, '').includes(td))),
      )
    },
    [orders, restId, range, q],
  )

  const delivered = filtered.filter(o => o.status !== 'cancelado')
  const completed = delivered.filter(o => o.status === 'entregado').length
  const rated = filtered.filter(o => o.rating)
  const avgRating = rated.length ? rated.reduce((s, o) => s + (o.rating ?? 0), 0) / rated.length : 0
  const revenue = delivered.reduce((s, o) => s + o.total, 0)
  const fees = delivered.reduce((s, o) => s + o.deliveryFee, 0)
  const avg = delivered.length ? revenue / delivered.length : 0

  const byRestaurant = useMemo(() => {
    const m = new Map<string, { name: string; count: number; total: number; rSum: number; rCount: number }>()
    delivered.forEach(o => {
      const e = m.get(o.restaurantId) ?? { name: o.restaurantName, count: 0, total: 0, rSum: 0, rCount: 0 }
      e.count += 1
      e.total += o.total
      if (o.rating) {
        e.rSum += o.rating
        e.rCount += 1
      }
      m.set(o.restaurantId, e)
    })
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [delivered])

  const topProducts = useMemo(() => {
    const m = new Map<string, { qty: number; total: number }>()
    delivered.forEach(o =>
      o.items.forEach(i => {
        const e = m.get(i.name) ?? { qty: 0, total: 0 }
        e.qty += i.qty
        e.total += i.qty * i.price
        m.set(i.name, e)
      }),
    )
    return [...m.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 5)
  }, [delivered])

  const maxRest = Math.max(1, ...byRestaurant.map(r => r.total))
  const restName = restId === 'all' ? 'todos' : restaurants.find(r => r.id === restId)?.name ?? restId

  return (
    <div className="space-y-5">
      <div className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-4 flex flex-wrap gap-4 items-end">
        <div className="min-w-48 flex-1">
          <label className={labelCls}>Restaurante</label>
          <select className={`${inputCls} w-full`} value={restId} onChange={e => setRestId(e.target.value)}>
            <option value="all">Todos los restaurantes</option>
            {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="min-w-48 flex-1">
          <label className={labelCls}>Cliente o pedido</label>
          <input className={`${inputCls} w-full`} value={q} onChange={e => setQ(e.target.value)} placeholder="Nombre, teléfono, CL-… o BB-…" />
        </div>
        <div>
          <label className={labelCls}>Período</label>
          <div className="flex gap-1 flex-wrap">
            {PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                className={`px-3 py-2 rounded-lg text-xs font-display font-semibold transition-colors ${preset === p.id ? 'bg-[#2563eb] text-white' : 'bg-[#0a0a0a] border border-[#2a2a2a] text-[#888] hover:text-white'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {preset === 'custom' && (
          <div className="flex gap-2 items-end">
            <div><label className={labelCls}>Desde</label><input type="date" className={inputCls} value={from} max={to} onChange={e => setFrom(e.target.value)} /></div>
            <div><label className={labelCls}>Hasta</label><input type="date" className={inputCls} value={to} min={from} onChange={e => setTo(e.target.value)} /></div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { l: 'Deliverys', v: String(delivered.length), sub: `${completed} entregados` },
          { l: 'Ventas', v: money(revenue) },
          { l: 'Ticket promedio', v: money(avg) },
          { l: 'Cobrado en envíos', v: money(fees) },
          { l: 'Calificación', v: rated.length ? `★ ${avgRating.toFixed(1)}` : '—', sub: `${rated.length} reseñas` },
        ].map(k => (
          <div key={k.l} className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-4">
            <p className="text-[#666] text-xs">{k.l}</p>
            <p className="font-display font-black text-2xl text-white mt-1">{k.v}</p>
            {'sub' in k && <p className="text-[11px] text-[#555] mt-0.5">{k.sub}</p>}
          </div>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-14 bg-[#141414] border border-[#1e1e1e] rounded-2xl">
          <div className="text-5xl mb-3">📊</div>
          <p className="font-display font-bold text-[#777]">Sin deliverys en este período</p>
          <p className="text-xs text-[#555] mt-1">Los pedidos confirmados por los clientes aparecerán aquí.</p>
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-4">
              <h3 className="font-display font-black mb-3">Por restaurante</h3>
              <div className="space-y-3">
                {byRestaurant.map(r => (
                  <div key={r.name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="truncate">
                        {r.name} <span className="text-[#666] text-xs">· {r.count}</span>
                        {r.rCount > 0 && <span className="text-yellow-400 text-xs ml-2">★ {(r.rSum / r.rCount).toFixed(1)} ({r.rCount})</span>}
                      </span>
                      <span className="font-semibold text-[#3b82f6]">{money(r.total)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#1c1c1c]">
                      <div className="h-full rounded-full bg-[#2563eb]" style={{ width: `${(r.total / maxRest) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-4">
              <h3 className="font-display font-black mb-3">Productos más pedidos</h3>
              <div className="space-y-2">
                {topProducts.map(([name, p], i) => (
                  <div key={name} className="flex items-center gap-3 text-sm">
                    <span className="w-6 h-6 rounded-full bg-[#1c1c1c] text-[#888] text-xs flex items-center justify-center font-bold">{i + 1}</span>
                    <span className="flex-1 truncate">{name}</span>
                    <span className="text-[#666] text-xs">{p.qty} uds</span>
                    <span className="font-semibold w-16 text-right">{money(p.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {rated.some(o => o.review) && (
            <div className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-4">
              <h3 className="font-display font-black mb-3">Comentarios de clientes</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {rated.filter(o => o.review).slice(0, 6).map(o => (
                  <div key={o.id} className="bg-[#0a0a0a] border border-[#1e1e1e] rounded-xl p-3">
                    <p className="text-yellow-400 text-sm">{'★'.repeat(o.rating ?? 0)}</p>
                    <p className="text-sm text-[#ccc] mt-1">“{o.review}”</p>
                    <p className="text-[11px] text-[#555] mt-1">{o.customerName || 'Cliente'} · {o.restaurantName}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-[#141414] border border-[#1e1e1e] rounded-2xl overflow-hidden">
            <div className="p-4 flex items-center justify-between gap-3 border-b border-[#1e1e1e]">
              <h3 className="font-display font-black">Detalle de deliverys ({filtered.length})</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => downloadCsv(filtered, `reporte-boombly-${restName.toLowerCase().replace(/\W+/g, '-')}-${today}.csv`)}
                  className="text-xs bg-[#2563eb] hover:bg-[#1d4ed8] transition-colors px-3 py-2 rounded-lg font-display font-bold"
                >
                  Descargar CSV
                </button>
                <button onClick={() => window.print()} className="text-xs border border-[#2a2a2a] text-[#888] hover:text-white px-3 py-2 rounded-lg font-display font-semibold">
                  Imprimir
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[#666] text-xs uppercase tracking-wider">
                    {['Pedido', 'Fecha', 'Cliente', 'Restaurante', 'Productos', 'Total', 'Pago', 'Calif.', 'Estado'].map(h => <th key={h} className="px-4 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(o => (
                    <tr key={o.id} className="border-t border-[#1e1e1e] align-top">
                      <td className="px-4 py-3 font-mono text-xs text-[#888]">{o.id}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-[#aaa]">{fmtDate(o.createdAt)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {o.customerName || '—'}
                        {o.customerId && <span className="block font-mono text-[11px] text-[#3b82f6]">{o.customerId}</span>}
                        {o.customerPhone && <a href={`tel:${o.customerPhone}`} className="block text-[#888] text-xs hover:text-white">📱 {o.customerPhone}</a>}
                        {o.location && (
                          <a href={`https://www.google.com/maps?q=${o.location.lat},${o.location.lng}`} target="_blank" rel="noreferrer" className="block text-[#3b82f6] text-xs hover:underline">
                            📍 Ver ubicación
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3">{o.restaurantName}</td>
                      <td className="px-4 py-3 text-[#aaa] text-xs">{o.items.map(i => `${i.qty}× ${i.name}`).join(', ')}</td>
                      <td className="px-4 py-3 font-semibold whitespace-nowrap">{money(o.total)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs">
                        {o.payment ? (
                          <>
                            <span className="text-[#aaa] block">Ref. {o.payment.reference}</span>
                            <a href={o.payment.proof} target="_blank" rel="noreferrer" className="text-[#3b82f6] hover:underline">🧾 Ver capture</a>
                          </>
                        ) : <span className="text-[#444]">—</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" title={o.review}>
                        {o.rating ? <span className="text-yellow-400">{'★'.repeat(o.rating)}<span className="text-[#333]">{'★'.repeat(5 - o.rating)}</span></span> : <span className="text-[#444]">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={o.status}
                          onChange={e => ordersRepo.setStatus(o.id, e.target.value as OrderStatus)}
                          className={`text-xs font-display font-semibold px-2 py-1.5 rounded-lg outline-none cursor-pointer border-0 ${STATUS_META[o.status].cls}`}
                        >
                          {[...STATUS_FLOW, 'cancelado' as const].map(s => (
                            <option key={s} value={s} className="bg-[#111] text-white">{STATUS_META[s].label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
