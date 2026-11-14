import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

type PedidoRestaurante = {
  id_pedido: string
  codigo: string
  estado: string
  creado_en: string
  cliente: string
  telefono_cliente: string
  unidades: number
  subtotal: number
  costo_envio: number
  total: number
}

const estadoMeta: Record<string, { etiqueta: string; clase: string }> = {
  recibido: { etiqueta: 'Recibido', clase: 'bg-blue-500/15 text-blue-300' },
  preparado: { etiqueta: 'Preparado', clase: 'bg-yellow-500/15 text-yellow-300' },
  enviado: { etiqueta: 'Enviado', clase: 'bg-purple-500/15 text-purple-300' },
  entregado: { etiqueta: 'Entregado', clase: 'bg-green-500/15 text-green-300' },
  cancelado: { etiqueta: 'Cancelado', clase: 'bg-red-500/15 text-red-300' },
}

export default function PedidosRestaurante({ idRestaurante }: { idRestaurante: string }) {
  const [pedidos, setPedidos] = useState<PedidoRestaurante[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [procesando, setProcesando] = useState<string[]>([])
  const requestId = useRef(0)
  const actionLocks = useRef(new Set<string>())
  const hasLoaded = useRef(false)

  const cargarPedidos = useCallback(async (mostrarCarga = false) => {
    if (!idRestaurante) return
    const request = ++requestId.current
    if (mostrarCarga && !hasLoaded.current) setCargando(true)

    try {
      const { data, error: queryError } = await supabase.rpc('pedidos_del_restaurante', {
        p_id_restaurante: idRestaurante,
      })
      if (queryError) throw queryError
      if (request === requestId.current) {
        setPedidos((data ?? []) as PedidoRestaurante[])
        setError('')
        hasLoaded.current = true
      }
    } catch (loadError) {
      console.error('[pedidos-admin] cargar pedidos', loadError)
      if (request === requestId.current) {
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      }
    } finally {
      if (request === requestId.current) setCargando(false)
    }
  }, [idRestaurante])

  useEffect(() => {
    void cargarPedidos(true)
    const actualizarSiVisible = () => {
      if (document.visibilityState === 'visible') void cargarPedidos()
    }
    const actualizarAlEnfocar = () => void cargarPedidos()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void cargarPedidos()
    }, 15_000)
    document.addEventListener('visibilitychange', actualizarSiVisible)
    window.addEventListener('focus', actualizarAlEnfocar)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', actualizarSiVisible)
      window.removeEventListener('focus', actualizarAlEnfocar)
      requestId.current += 1
    }
  }, [cargarPedidos])

  const cambiarEstado = async (pedido: PedidoRestaurante, nuevoEstado: string) => {
    const lockKey = `${pedido.id_pedido}:${nuevoEstado}`
    if (actionLocks.current.has(lockKey)) return
    if (nuevoEstado === 'cancelado' && !window.confirm(`¿Cancelar el pedido ${pedido.codigo}?`)) return

    actionLocks.current.add(lockKey)
    setProcesando(keys => [...keys, lockKey])
    setError('')
    try {
      const { error: updateError } = await supabase.rpc('cambiar_estado_pedido', {
        p_id_pedido: pedido.id_pedido,
        p_estado: nuevoEstado,
      })
      if (updateError) throw updateError
      await cargarPedidos()
    } catch (updateError) {
      console.error('[pedidos-admin] cambiar estado', updateError)
      setError(updateError instanceof Error ? updateError.message : String(updateError))
    } finally {
      actionLocks.current.delete(lockKey)
      setProcesando(keys => keys.filter(key => key !== lockKey))
    }
  }

  return (
    <section className="mb-5 rounded-2xl border border-[#1e1e1e] bg-[#111] p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-black">Pedidos</h3>
          <p className="text-xs text-[#777]">Pedidos recientes de este restaurante</p>
        </div>
        <button
          type="button"
          onClick={() => void cargarPedidos(true)}
          disabled={cargando}
          className="rounded-xl border border-[#2a2a2a] px-3 py-2 text-xs text-[#aaa] hover:text-white disabled:opacity-50"
        >
          Actualizar
        </button>
      </div>

      {cargando && <p role="status" className="py-5 text-center text-sm text-[#888]">Cargando pedidos…</p>}
      {error && <p role="alert" className="mb-3 text-sm text-red-400">{error}</p>}
      {!cargando && !error && pedidos.length === 0 && (
        <p className="py-8 text-center text-sm text-[#777]">No hay pedidos.</p>
      )}

      <div className="grid gap-3">
        {pedidos.map(pedido => {
          const estado = estadoMeta[pedido.estado] ?? { etiqueta: pedido.estado, clase: 'bg-[#222] text-[#aaa]' }
          const lockKeys = [
            ...(pedido.estado === 'recibido' ? ['preparado', 'cancelado'] : []),
            ...(pedido.estado === 'preparado' ? ['enviado', 'cancelado'] : []),
            ...(pedido.estado === 'enviado' ? ['entregado'] : []),
          ].map(nextStatus => `${pedido.id_pedido}:${nextStatus}`)
          const pedidoProcesando = lockKeys.some(key => procesando.includes(key))

          return (
            <article key={pedido.id_pedido} className="rounded-xl border border-[#222] bg-[#0d0d0d] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm font-bold text-white">{pedido.codigo}</p>
                  <p className="mt-1 text-xs text-[#888]">
                    {new Date(pedido.creado_en).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${estado.clase}`}>{estado.etiqueta}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-[#ccc]">{pedido.cliente}</span>
                <span className="text-xs text-[#888]">{pedido.unidades} {pedido.unidades === 1 ? 'unidad' : 'unidades'}</span>
                <span className="font-display font-black text-[#3b82f6]">$ {Number(pedido.total).toFixed(2)}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {pedido.estado === 'recibido' && (
                  <button type="button" disabled={pedidoProcesando} onClick={() => void cambiarEstado(pedido, 'preparado')} className="rounded-lg bg-[#2563eb] px-3 py-2 text-xs font-bold disabled:opacity-50">
                    {procesando.includes(`${pedido.id_pedido}:preparado`) ? 'Procesando…' : 'Marcar preparado'}
                  </button>
                )}
                {pedido.estado === 'preparado' && (
                  <button type="button" disabled={pedidoProcesando} onClick={() => void cambiarEstado(pedido, 'enviado')} className="rounded-lg bg-[#2563eb] px-3 py-2 text-xs font-bold disabled:opacity-50">
                    {procesando.includes(`${pedido.id_pedido}:enviado`) ? 'Procesando…' : 'Marcar enviado'}
                  </button>
                )}
                {pedido.estado === 'enviado' && (
                  <button type="button" disabled={pedidoProcesando} onClick={() => void cambiarEstado(pedido, 'entregado')} className="rounded-lg bg-[#2563eb] px-3 py-2 text-xs font-bold disabled:opacity-50">
                    {procesando.includes(`${pedido.id_pedido}:entregado`) ? 'Procesando…' : 'Marcar entregado'}
                  </button>
                )}
                {(pedido.estado === 'recibido' || pedido.estado === 'preparado') && (
                  <button type="button" disabled={pedidoProcesando} onClick={() => void cambiarEstado(pedido, 'cancelado')} className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-bold text-red-400 disabled:opacity-50">
                    {procesando.includes(`${pedido.id_pedido}:cancelado`) ? 'Procesando…' : 'Cancelar'}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
