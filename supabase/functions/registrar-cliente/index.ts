// supabase/functions/registrar-cliente/index.ts
// Edge Function pública: registra clientes en la base y verifica su ingreso (código + teléfono).
// - "registrar": crea la fila en "cliente" y devuelve su código CL-XXXXXX. Si el teléfono ya existe,
//   NO devuelve el código (si lo hiciera, cualquiera podría apropiarse de una cuenta ajena).
// - "entrar": comprueba código + teléfono y devuelve los datos del cliente.
// Límites por conexión y por teléfono (en memoria, "mejor esfuerzo").
// Publicar con:  npx supabase functions deploy registrar-cliente --no-verify-jwt --use-api
import { createClient } from 'npm:@supabase/supabase-js@2'

const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['default']
const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })

const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map(s => s.trim())

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}
const json = (body: unknown, status: number, h: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json' } })

// Limitador sencillo en memoria (mejor esfuerzo: cada instancia lleva su propia cuenta)
const intentos = new Map<string, number[]>()
function permitido(clave: string, max: number, ventanaMs: number): boolean {
  const ahora = Date.now()
  const lista = (intentos.get(clave) ?? []).filter(t => ahora - t < ventanaMs)
  if (lista.length >= max) {
    intentos.set(clave, lista)
    return false
  }
  lista.push(ahora)
  intentos.set(clave, lista)
  if (intentos.size > 5000) intentos.clear()
  return true
}

/** 0412-1234567, +58 412 1234567 y 584121234567 terminan como 584121234567. */
function normalizarTelefono(raw: unknown): string {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (/^0\d{10}$/.test(d)) d = '58' + d.slice(1)
  else if (/^4\d{9}$/.test(d)) d = '58' + d
  return d
}

Deno.serve(async req => {
  const h = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, h)

  try {
    const ip = (req.headers.get('x-forwarded-for') ?? 'desconocida').split(',')[0].trim()
    const b = await req.json().catch(() => ({}))
    const telefono = normalizarTelefono(b.telefono)
    if (!/^\d{10,15}$/.test(telefono)) return json({ error: 'Teléfono inválido. Ejemplo: 0412-1234567' }, 400, h)

    if (b.accion === 'registrar') {
      if (!permitido(`reg:${ip}`, 5, 10 * 60_000)) {
        return json({ error: 'Demasiados registros desde esta conexión: espera unos minutos' }, 429, h)
      }
      const nombre = String(b.nombre ?? '').replace(/\s+/g, ' ').trim()
      if (nombre.length < 2 || nombre.length > 60) return json({ error: 'Escribe tu nombre (de 2 a 60 caracteres)' }, 400, h)

      const { data, error } = await db.from('cliente').insert({ nombre, telefono }).select('codigo,nombre,telefono').single()
      if (error) {
        if (error.code === '23505') {
          return json({ error: 'Ese teléfono ya está registrado. Entra con tu código de cliente (CL-XXXXXX)' }, 409, h)
        }
        console.error('[registrar-cliente] insert', error.code)
        return json({ error: 'No se pudo registrar al cliente' }, 500, h)
      }
      return json({ ok: true, cliente: data }, 200, h)
    }

    if (b.accion === 'entrar') {
      if (!permitido(`ent:${telefono}`, 10, 10 * 60_000) || !permitido(`entip:${ip}`, 30, 10 * 60_000)) {
        return json({ error: 'Demasiados intentos: espera unos minutos' }, 429, h)
      }
      const codigo = String(b.codigo ?? '').trim().toUpperCase()
      if (!/^CL-[A-Z0-9]{6}$/.test(codigo)) return json({ error: 'Código inválido. Formato: CL-XXXXXX' }, 400, h)

      const { data } = await db.from('cliente').select('codigo,nombre,telefono')
        .eq('codigo', codigo).eq('telefono', telefono).maybeSingle()
      if (!data) return json({ error: 'Código o teléfono incorrectos' }, 401, h)
      return json({ ok: true, cliente: data }, 200, h)
    }

    return json({ error: 'Acción inválida' }, 400, h)
  } catch (e) {
    console.error('[registrar-cliente]', e instanceof Error ? e.message : 'error')
    return json({ error: 'Error interno' }, 500, h)
  }
})