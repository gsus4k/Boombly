// Backend mínimo para enviar avisos por WhatsApp Cloud API (Meta). Node 20+, sin dependencias.
// Uso: copia .env.example a .env y ejecuta: node --env-file=.env server/whatsapp-server.mjs
//
// IMPORTANTE: mientras los teléfonos lleguen desde el navegador, este servidor es un "relé" que cualquiera podría usar
// para escribir a números arbitrarios. Se mitiga con ALLOWED_TO (lista de números permitidos) y límite por IP.
// Con Supabase, reemplázalo por una Edge Function que reciba solo el id del pedido y lea los teléfonos de la base de datos.
import http from 'node:http'

const {
  WHATSAPP_TOKEN, // token permanente (usuario del sistema) de Meta
  WHATSAPP_PHONE_ID, // ID del número emisor (Phone number ID)
  WHATSAPP_TEMPLATE = '', // plantilla aprobada con un parámetro {{1}}. Vacío = texto libre (solo dentro de la ventana de 24 h)
  ALLOWED_TO = '', // opcional: números permitidos separados por coma (formato 584121234567). Vacío = cualquiera con formato válido
  ALLOWED_ORIGIN = 'http://localhost:5173',
  PORT = 8787,
} = process.env

const GRAPH = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`
const allow = new Set(ALLOWED_TO.split(',').map(s => s.trim()).filter(Boolean))
const hits = new Map() // ip → [timestamps]
const limited = ip => {
  const now = Date.now()
  const arr = (hits.get(ip) ?? []).filter(t => now - t < 60_000)
  arr.push(now)
  hits.set(ip, arr)
  return arr.length > 20
}

async function sendWhatsApp(to, text) {
  const body = WHATSAPP_TEMPLATE
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        // Los parámetros de plantilla no admiten saltos de línea.
        template: { name: WHATSAPP_TEMPLATE, language: { code: 'es' }, components: [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\s*\n+\s*/g, ' | ') }] }] },
      }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }
  const r = await fetch(GRAPH, { method: 'POST', headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`WhatsApp API ${r.status}: ${await r.text()}`)
}

http
  .createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    if (req.method !== 'POST' || req.url !== '/api/notify-order') return res.writeHead(404).end()
    if (limited(req.socket.remoteAddress ?? '?')) return res.writeHead(429).end()
    try {
      let raw = ''
      for await (const c of req) { raw += c; if (raw.length > 20_000) throw new Error('payload grande') }
      const { messages } = JSON.parse(raw)
      if (!Array.isArray(messages) || messages.length === 0 || messages.length > 3) throw new Error('messages inválido')
      for (const m of messages) {
        if (!/^\d{10,15}$/.test(m?.to ?? '') || typeof m.message !== 'string' || !m.message.trim()) throw new Error('mensaje inválido')
        if (allow.size && !allow.has(m.to)) throw new Error('número no permitido: ' + m.to)
      }
      // Cada aviso es independiente: si falla uno (p. ej. el restaurante), el otro (el repartidor) igual sale.
      const results = await Promise.allSettled(messages.map(m => sendWhatsApp(m.to, m.message.slice(0, 3500))))
      results.forEach(r => r.status === 'rejected' && console.error(r.reason))
      const ok = results.map(r => r.status === 'fulfilled')
      res.writeHead(ok.some(Boolean) ? 200 : 502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok }))
    } catch (e) {
      console.error(e)
      res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"ok":false}')
    }
  })
  .listen(PORT, () => console.log(`WhatsApp server en :${PORT}`))
