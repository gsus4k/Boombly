// Edge Function "crear-pedido": crea el pedido de forma segura y avisa por WhatsApp al restaurante y al repartidor.
// WhatsApp se envía por TWILIO si existen sus 3 secretos; si no, por META (WhatsApp Cloud API).
//
// Secrets para TWILIO:  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (ej: whatsapp:+14155238886)
//   Opcional (producción con plantilla aprobada): TWILIO_CONTENT_SID (plantilla con UNA variable {{1}})
// Secrets para META:    WHATSAPP_TOKEN, WHATSAPP_PHONE_ID   (opcional: WHATSAPP_TEMPLATE)
// La disponibilidad vive en detalle_producto.disponible (por restaurante).
// Otros opcionales:     ALLOWED_ORIGINS (separados por coma), OSRM_URL
import { createClient } from 'npm:@supabase/supabase-js@2'

const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['default']
const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey, { auth: { persistSession: false } })

const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map(s => s.trim())
const OSRM = Deno.env.get('OSRM_URL') ?? 'https://router.project-osrm.org'

// --- Meta (WhatsApp Cloud API)
const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN')
const WA_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID')
const WA_TEMPLATE = Deno.env.get('WHATSAPP_TEMPLATE') ?? ''

// --- Twilio
const TW_SID = Deno.env.get('TWILIO_ACCOUNT_SID')
const TW_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')
const TW_FROM_RAW = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? ''
const TW_FROM = TW_FROM_RAW.startsWith('whatsapp:') ? TW_FROM_RAW : `whatsapp:${TW_FROM_RAW}`
const TW_CONTENT_SID = Deno.env.get('TWILIO_CONTENT_SID') ?? ''
const USE_TWILIO = Boolean(TW_SID && TW_TOKEN && TW_FROM_RAW)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}
const json = (body: unknown, status: number, h: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json' } })

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Distancia por carretera (OSRM). Si falla, recta × 1.3 (la base de datos valida que sea razonable).
async function rutaKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  try {
    const r = await fetch(`${OSRM}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`, { signal: AbortSignal.timeout(8000) })
    const j = await r.json()
    if (j?.code === 'Ok' && typeof j.routes?.[0]?.distance === 'number') return { km: j.routes[0].distance / 1000, exacta: true }
  } catch (_) { /* usa la estimación */ }
  return { km: haversine(a, b) * 1.3, exacta: false }
}

// Las variables de una plantilla no admiten saltos de línea: se unen con " | "
const unaLinea = (text: string) => text.replace(/\s*\n+\s*/g, ' | ')

// ---------- Envío por Twilio
async function enviarTwilio(to: string, text: string) {
  const digits = to.replace(/\D/g, '')
  const params = new URLSearchParams({ From: TW_FROM, To: `whatsapp:+${digits}` })
  if (TW_CONTENT_SID) {
    // Producción: plantilla aprobada con una sola variable {{1}}
    params.set('ContentSid', TW_CONTENT_SID)
    params.set('ContentVariables', JSON.stringify({ '1': unaLinea(text) }))
  } else {
    // Sandbox o ventana de 24 h: texto libre
    params.set('Body', text)
  }
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${TW_SID}:${TW_TOKEN}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Twilio ${j?.code ?? r.status}: ${j?.message ?? 'error al enviar'}`)
  return (j?.sid as string | undefined) ?? null
}

// ---------- Envío por Meta (WhatsApp Cloud API)
async function enviarMeta(to: string, text: string) {
  if (!WA_TOKEN || !WA_PHONE_ID) throw new Error('Faltan WHATSAPP_TOKEN / WHATSAPP_PHONE_ID')
  const body = WA_TEMPLATE
    ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: WA_TEMPLATE, language: { code: 'es' }, components: [{ type: 'body', parameters: [{ type: 'text', text: unaLinea(text) }] }] } }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }
  const r = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message ?? `WhatsApp ${r.status}`)
  return (j?.messages?.[0]?.id as string | undefined) ?? null
}

// Elige el proveedor según los secretos configurados
async function enviarWhatsApp(to: string, text: string) {
  if (USE_TWILIO) return await enviarTwilio(to, text)
  if (WA_TOKEN && WA_PHONE_ID) return await enviarMeta(to, text)
  throw new Error('WhatsApp no configurado: faltan los secretos de Twilio o de Meta')
}

Deno.serve(async req => {
  const h = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, h)

  try {
    const b = await req.json()
    const items = Array.isArray(b.items) ? b.items : []
    if (!/^CL-[A-Z0-9]{6}$/.test(b.codigo ?? '') || !/^\d{10,15}$/.test(b.telefono ?? '')) return json({ error: 'Datos de cliente inválidos' }, 400, h)
    if (!UUID.test(b.id_restaurante ?? '')) return json({ error: 'Restaurante inválido' }, 400, h)
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng) || Math.abs(b.lat) > 90 || Math.abs(b.lng) > 180) return json({ error: 'Ubicación inválida' }, 400, h)
    if (items.length === 0 || items.length > 40 || items.some((i: { id_producto?: string; cantidad?: number }) => !UUID.test(i?.id_producto ?? '') || !Number.isInteger(i?.cantidad) || i.cantidad! < 1 || i.cantidad! > 50)) return json({ error: 'Productos inválidos' }, 400, h)
    if (!/^\d{4,20}$/.test(b.referencia ?? '')) return json({ error: 'La referencia del pago debe tener de 4 a 20 dígitos' }, 400, h)

    // 1) Cliente: debe existir con ese código Y ese teléfono (mismo nivel de seguridad que el login actual)
    const { data: cli } = await db.from('cliente').select('id_cliente,nombre,telefono').eq('codigo', b.codigo).eq('telefono', b.telefono).maybeSingle()
    if (!cli) return json({ error: 'Cliente no encontrado. Revisa tu código y teléfono.' }, 401, h)

    // 2) Restaurante
    const { data: rest } = await db.from('restaurante').select('id_restaurante,nombre,telefono,lat,lng').eq('id_restaurante', b.id_restaurante).eq('activo', true).maybeSingle()
    if (!rest) return json({ error: 'Restaurante no disponible' }, 404, h)

    // 2b) Productos agotados en ESTE restaurante (detalle_producto.disponible).
    // La base de datos también lo valida en crear_pedido; esto solo da un mensaje claro con el nombre.
    const ids = items.map((i: { id_producto: string }) => i.id_producto)
    const { data: agotados, error: eDisp } = await db.from('detalle_producto').select('producto(nombre)')
      .eq('id_restaurante', rest.id_restaurante).in('id_producto', ids).eq('disponible', false)
    if (eDisp) { console.error(eDisp); return json({ error: 'No se pudo verificar la disponibilidad de los productos' }, 500, h) }
    if (agotados && agotados.length > 0) {
      const nombres = agotados
        .map((a: { producto: { nombre: string } | { nombre: string }[] | null }) => (Array.isArray(a.producto) ? a.producto[0]?.nombre : a.producto?.nombre))
        .filter(Boolean).join(', ')
      return json({ error: `Producto no disponible: ${nombres}` }, 409, h)
    }

    // 3) Distancia por ruta
    const ruta = await rutaKm({ lat: Number(rest.lat), lng: Number(rest.lng) }, { lat: b.lat, lng: b.lng })

    // 4) Crear el pedido (la base de datos recalcula precios y envío y valida la cobertura)
    const { data: idPedido, error: e1 } = await db.rpc('crear_pedido', {
      p_id_cliente: cli.id_cliente, p_id_restaurante: rest.id_restaurante, p_lat: b.lat, p_lng: b.lng,
      p_precision_m: Number.isFinite(b.precision_m) ? b.precision_m : null, p_distancia_km: Math.round(ruta.km * 100) / 100,
      p_items: items, p_referencia: b.referencia, p_comprobante_url: typeof b.comprobante_path === 'string' ? b.comprobante_path : null,
    })
    if (e1) return json({ error: e1.message }, 400, h)

    // 5) Repartidor + datos para los mensajes
    const { data: idRep } = await db.rpc('asignar_repartidor', { p_id_pedido: idPedido })
    const { data: ped } = await db.from('v_pedido').select('codigo,subtotal,costo_envio,total,distancia_km').eq('id_pedido', idPedido).single()
    const { data: lineas } = await db.from('detalle_pedido').select('id_producto,cantidad,precio_unitario,subtotal').eq('id_pedido', idPedido)
    const { data: prods } = await db.from('producto').select('id_producto,nombre').in('id_producto', (lineas ?? []).map(l => l.id_producto))
    const nombre = new Map((prods ?? []).map(p => [p.id_producto, p.nombre]))
    const detalle = (lineas ?? []).map(l => `• ${l.cantidad}× ${nombre.get(l.id_producto)} — $ ${Number(l.subtotal).toFixed(2)}`).join('\n')
    const unidades = (lineas ?? []).reduce((s, l) => s + l.cantidad, 0)

    const msgRest = [`🛵 *Nuevo pedido Boombly* (${ped!.codigo})`, `👤 Cliente: ${cli.nombre} · ${cli.telefono}`, detalle,
      `Subtotal: $ ${Number(ped!.subtotal).toFixed(2)}`, `Envío (${Number(ped!.distancia_km).toFixed(1)} km): $ ${Number(ped!.costo_envio).toFixed(2)}`,
      `*Total: $ ${Number(ped!.total).toFixed(2)}*`, `💳 Pago móvil ref. ${b.referencia}`, `📍 ${mapsUrl(b.lat, b.lng)}`].join('\n')
    const destinos: { tipo: 'restaurante' | 'repartidor'; tel: string; msg: string }[] = [{ tipo: 'restaurante', tel: rest.telefono, msg: msgRest }]
    if (idRep) {
      const { data: rep } = await db.from('repartidor').select('telefono').eq('id_repartidor', idRep).single()
      if (rep) destinos.push({ tipo: 'repartidor', tel: rep.telefono, msg: [`🛵 *Entrega asignada Boombly* (${ped!.codigo})`, `🍽️ Recoger en: ${rest.nombre} (${unidades} ${unidades === 1 ? 'producto' : 'productos'})`,
        `👤 Entregar a: ${cli.nombre}`, `📱 Teléfono: ${cli.telefono}`, `📍 Destino: ${mapsUrl(b.lat, b.lng)}`, `📏 Distancia: ${Number(ped!.distancia_km).toFixed(1)} km`, `💵 Envío: $ ${Number(ped!.costo_envio).toFixed(2)}`].join('\n') })
    }

    // 6) Enviar los avisos (cada uno es independiente) y dejar registro en "notificacion"
    const avisos: Record<string, boolean> = { restaurante: false, repartidor: false }
    await Promise.all(destinos.map(async d => {
      let waId: string | null = null, error: string | null = null
      try { waId = await enviarWhatsApp(d.tel, d.msg); avisos[d.tipo] = true } catch (e) { error = (e as Error).message }
      await db.from('notificacion').insert({ id_pedido: idPedido, destinatario_tipo: d.tipo, destinatario_telefono: d.tel, mensaje: d.msg, estado: error ? 'fallido' : 'enviado', wa_message_id: waId, error })
    }))

    return json({ ok: true, pedido: { codigo: ped!.codigo, subtotal: Number(ped!.subtotal), costo_envio: Number(ped!.costo_envio), total: Number(ped!.total), distancia_km: Number(ped!.distancia_km) }, avisos, ruta_exacta: ruta.exacta }, 200, h)
  } catch (e) {
    console.error(e)
    return json({ error: 'Error interno al crear el pedido' }, 500, h)
  }
})