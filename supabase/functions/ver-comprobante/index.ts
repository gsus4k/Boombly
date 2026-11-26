// Edge Function "ver-comprobante": entrega la captura del pago móvil a Twilio/Meta mediante un token temporal.
// Publicar con:  npx supabase functions deploy ver-comprobante --no-verify-jwt
// URL: ${SUPABASE_URL}/functions/v1/ver-comprobante/<token>
//   <token> = 32 hex + ".jpg" | ".png"  (columna pago.comprobante_token, vence en pago.comprobante_token_expira)
//   "muestra.jpg" entrega comprobantes/_muestra/muestra.jpg (para aprobar la plantilla en Meta).
// No aplica ALLOWED_ORIGINS: quien llama es un servidor (Twilio/Meta), no un navegador.
import { createClient } from 'npm:@supabase/supabase-js@2'

const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['default']
const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey, { auth: { persistSession: false } })

const BUCKET = 'comprobantes'
const TOKEN = /^[a-f0-9]{32}\.(jpg|png)$/
const MUESTRA = 'muestra.jpg'

const tokenCorto = (t: string) => (t.length > 8 ? `${t.slice(0, 6)}…` : '…')
const noEncontrado = () => new Response('No encontrado', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
const tipoDe = (ruta: string) => (ruta.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg')

Deno.serve(async req => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Método no permitido', { status: 405, headers: { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' } })
  }

  try {
    const token = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? ''
    if (token !== MUESTRA && !TOKEN.test(token)) return noEncontrado()

    let ruta: string
    if (token === MUESTRA) {
      ruta = '_muestra/muestra.jpg'
    } else {
      const { data: pago, error } = await db.from('pago').select('comprobante_url,comprobante_token_expira')
        .eq('comprobante_token', token).maybeSingle()
      if (error) { console.error('[comprobante] consulta', tokenCorto(token), error.message); return noEncontrado() }
      if (!pago?.comprobante_url || !pago.comprobante_token_expira || new Date(pago.comprobante_token_expira).getTime() < Date.now()) {
        console.log('[comprobante] inexistente o vencido', tokenCorto(token))
        return noEncontrado()
      }
      ruta = pago.comprobante_url
    }

    const { data: archivo, error: eDl } = await db.storage.from(BUCKET).download(ruta)
    if (eDl || !archivo) { console.error('[comprobante] descarga', tokenCorto(token), eDl?.message ?? 'sin datos'); return noEncontrado() }

    const bytes = new Uint8Array(await archivo.arrayBuffer())
    const headers = {
      'Content-Type': tipoDe(ruta),
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    }
    console.log('[comprobante] entregado', tokenCorto(token), req.method, bytes.byteLength, 'bytes')
    return new Response(req.method === 'HEAD' ? null : bytes, { status: 200, headers })
  } catch (e) {
    console.error('[comprobante] error', e instanceof Error ? e.message : 'desconocido')
    return noEncontrado()
  }
})
