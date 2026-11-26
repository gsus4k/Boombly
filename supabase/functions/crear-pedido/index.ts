// Edge Function "crear-pedido": crea el pedido de forma segura, guarda la captura del pago móvil
// y avisa por WhatsApp (Twilio) al restaurante —con la captura— y al repartidor.
//
// Secrets para TWILIO:  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (ej: whatsapp:+14155238886)
//   Producción (plantillas aprobadas): TWILIO_CONTENT_SID_RESTAURANTE (variables 1..6), TWILIO_CONTENT_SID_REPARTIDOR (1..7)
//   Sin ellas se usa el modo Sandbox (texto libre + MediaUrl).
// La captura se guarda en el bucket privado "comprobantes" y se sirve con la función "ver-comprobante".
// La disponibilidad vive en detalle_producto.disponible (por restaurante).
// Otros opcionales:     ALLOWED_ORIGINS (separados por coma), OSRM_URL
import { createClient } from 'npm:@supabase/supabase-js@2'
import { enviarWhatsApp } from '../_shared/whatsapp.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['default']
const db = createClient(SUPABASE_URL, secretKey, { auth: { persistSession: false } })

const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map(s => s.trim())
const OSRM = Deno.env.get('OSRM_URL') ?? 'https://router.project-osrm.org'

// --- Plantillas de Twilio (si faltan, modo Sandbox)
const CONTENT_SID_RESTAURANTE = Deno.env.get('TWILIO_CONTENT_SID_RESTAURANTE') ?? ''
const CONTENT_SID_REPARTIDOR = Deno.env.get('TWILIO_CONTENT_SID_REPARTIDOR') ?? ''

// --- Comprobante de pago
const BUCKET = 'comprobantes'
const MAX_BYTES = 5 * 1024 * 1024
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4 + 4
const TOKEN_HORAS = 72
const ERROR_COMPROBANTE = 'Sube la captura del pago móvil (JPG o PNG, máximo 5 MB)'

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

type Comprobante = { bytes: Uint8Array; tipo: 'image/jpeg' | 'image/png'; ext: 'jpg' | 'png' }

// Valida tipo, base64, bytes mágicos y tamaño. Devuelve null si algo no cuadra.
function leerComprobante(c: unknown): Comprobante | null {
  if (!c || typeof c !== 'object') return null
  const { base64, tipo } = c as { base64?: unknown; tipo?: unknown }
  if (tipo !== 'image/jpeg' && tipo !== 'image/png') return null
  if (typeof base64 !== 'string') return null
  const limpio = base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '') // acepta también un data URL
  if (limpio.length === 0 || limpio.length > MAX_BASE64) return null
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(limpio), ch => ch.charCodeAt(0)) } catch (_) { return null }
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return null
  const esJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const esPng = bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  if (tipo === 'image/jpeg' && !esJpeg) return null
  if (tipo === 'image/png' && !esPng) return null
  return { bytes, tipo, ext: tipo === 'image/png' ? 'png' : 'jpg' }
}

const recortar = (t: string, max: number) => (t.length > max ? t.slice(0, max - 1) + '…' : t)

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
    const comprobante = leerComprobante(b.comprobante)
    if (!comprobante) return json({ error: ERROR_COMPROBANTE }, 400, h)

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

    // 4) Subir la captura al bucket privado. Si falla, NO se crea el pedido.
    const rutaComprobante = `${rest.id_restaurante}/${crypto.randomUUID()}.${comprobante.ext}`
    const { error: eUp } = await db.storage.from(BUCKET).upload(rutaComprobante, comprobante.bytes, { contentType: comprobante.tipo, upsert: false })
    if (eUp) {
      console.error('[crear-pedido] subir comprobante', eUp.message)
      return json({ error: 'No se pudo guardar la captura del pago. Intenta de nuevo.' }, 500, h)
    }

    // 5) Crear el pedido (la base de datos recalcula precios y envío y valida la cobertura)
    const { data: idPedido, error: e1 } = await db.rpc('crear_pedido', {
      p_id_cliente: cli.id_cliente, p_id_restaurante: rest.id_restaurante, p_lat: b.lat, p_lng: b.lng,
      p_precision_m: Number.isFinite(b.precision_m) ? b.precision_m : null, p_distancia_km: Math.round(ruta.km * 100) / 100,
      p_items: items, p_referencia: b.referencia, p_comprobante_url: rutaComprobante,
    })
    if (e1) {
      const { error: eRm } = await db.storage.from(BUCKET).remove([rutaComprobante])
      if (eRm) console.error('[crear-pedido] borrar comprobante huérfano', eRm.message)
      return json({ error: e1.message }, 400, h)
    }

    // 6) Token público (72 h) para que Twilio/Meta descarguen la captura
    const token = crypto.randomUUID().replaceAll('-', '') + '.' + comprobante.ext
    const ahora = new Date()
    const { error: eTok } = await db.from('pago').update({
      comprobante_url: rutaComprobante,
      comprobante_token: token,
      comprobante_token_expira: new Date(ahora.getTime() + TOKEN_HORAS * 3600 * 1000).toISOString(),
      comprobante_subido_en: ahora.toISOString(),
    }).eq('id_pedido', idPedido)
    if (eTok) console.error('[crear-pedido] guardar token del comprobante', eTok.message)
    const urlComprobante = eTok ? null : `${SUPABASE_URL}/functions/v1/ver-comprobante/${token}`

    // 7) Repartidor + datos para los mensajes
    const { data: idRep } = await db.rpc('asignar_repartidor', { p_id_pedido: idPedido })
    const { data: ped } = await db.from('v_pedido').select('codigo,subtotal,costo_envio,total,distancia_km').eq('id_pedido', idPedido).single()
    const { data: lineas } = await db.from('detalle_pedido').select('id_producto,cantidad,precio_unitario,subtotal').eq('id_pedido', idPedido)
    const { data: prods } = await db.from('producto').select('id_producto,nombre').in('id_producto', (lineas ?? []).map(l => l.id_producto))
    const nombre = new Map((prods ?? []).map(p => [p.id_producto, p.nombre]))
    const unidades = (lineas ?? []).reduce((s, l) => s + l.cantidad, 0)
    const resumen = recortar((lineas ?? []).map(l => `${l.cantidad}x ${nombre.get(l.id_producto) ?? 'Producto'}`).join(', '), 300)
    const total = Number(ped!.total).toFixed(2)
    const envio = Number(ped!.costo_envio).toFixed(2)
    const km = Number(ped!.distancia_km).toFixed(1)
    const destino = mapsUrl(b.lat, b.lng)

    type Destino = { tipo: 'restaurante' | 'repartidor'; tel: string; contentSid: string; variables: Record<string, string>; cuerpo: string; mediaUrl: string | null }
    const destinos: Destino[] = [{
      tipo: 'restaurante', tel: rest.telefono, contentSid: CONTENT_SID_RESTAURANTE, mediaUrl: urlComprobante,
      variables: { '1': ped!.codigo, '2': cli.nombre, '3': resumen, '4': total, '5': b.referencia, '6': eTok ? '-' : token },
      cuerpo: [`🛵 *Nuevo pedido Boombly* (${ped!.codigo})`, `👤 Cliente: ${cli.nombre}`, `🧾 ${resumen}`,
        `*Total: $ ${total}*`, `💳 Pago móvil ref. ${b.referencia}`, urlComprobante ? '📎 Captura del pago adjunta' : '⚠️ No se pudo adjuntar la captura'].join('\n'),
    }]
    if (idRep) {
      const { data: rep } = await db.from('repartidor').select('telefono').eq('id_repartidor', idRep).single()
      if (rep) destinos.push({
        tipo: 'repartidor', tel: rep.telefono, contentSid: CONTENT_SID_REPARTIDOR, mediaUrl: null,
        variables: { '1': ped!.codigo, '2': rest.nombre, '3': cli.nombre, '4': cli.telefono, '5': destino, '6': km, '7': envio },
        cuerpo: [`🛵 *Entrega asignada Boombly* (${ped!.codigo})`, `🍽️ Recoger en: ${rest.nombre} (${unidades} ${unidades === 1 ? 'producto' : 'productos'})`,
          `👤 Entregar a: ${cli.nombre}`, `📱 Teléfono: ${cli.telefono}`, `📍 Destino: ${destino}`, `📏 Distancia: ${km} km`, `💵 Envío: $ ${envio}`].join('\n'),
      })
    }

    // 8) Enviar los avisos (cada uno es independiente; si falla WhatsApp el pedido sigue siendo válido)
    const avisos: Record<string, boolean> = { restaurante: false, repartidor: false }
    await Promise.all(destinos.map(async d => {
      const r = await enviarWhatsApp({ telefono: d.tel, variables: d.variables, contentSid: d.contentSid || undefined, cuerpoSandbox: d.cuerpo, mediaUrl: d.mediaUrl })
      avisos[d.tipo] = r.ok
      const { error: eNot } = await db.from('notificacion').insert({
        id_pedido: idPedido, destinatario_tipo: d.tipo, destinatario_telefono: d.tel, canal: 'whatsapp', mensaje: d.cuerpo,
        estado: r.ok ? 'enviado' : 'fallido', wa_message_id: r.sid, error: r.error,
      })
      if (eNot) console.error('[crear-pedido] registrar notificación', eNot.message)
    }))

    return json({ ok: true, pedido: { codigo: ped!.codigo, subtotal: Number(ped!.subtotal), costo_envio: Number(ped!.costo_envio), total: Number(ped!.total), distancia_km: Number(ped!.distancia_km) }, avisos, ruta_exacta: ruta.exacta }, 200, h)
  } catch (e) {
    console.error(e)
    return json({ error: 'Error interno al crear el pedido' }, 500, h)
  }
})
