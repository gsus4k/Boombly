// supabase/functions/crear-cuenta-restaurante/index.ts
// Edge Function: el ADMINISTRADOR crea la cuenta de acceso (correo + contraseña) de UN restaurante.
// - Solo responde a un usuario con sesión que esté en la tabla "admin" (se valida aquí, no en la pantalla).
// - Un restaurante solo puede tener una cuenta; un correo ya registrado se rechaza.
// - Si falla la asignación, la cuenta recién creada se elimina (no quedan cuentas huérfanas).
// Secrets opcionales: ALLOWED_ORIGINS (los mismos que usa crear-pedido).
// Publicar con:  npx supabase functions deploy crear-cuenta-restaurante --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2'

const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['default']
const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })

const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map(s => s.trim())
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

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

Deno.serve(async req => {
  const h = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, h)

  try {
    // 1) Quién llama: debe tener sesión y ser administrador
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Falta la sesión: inicia sesión como administrador' }, 401, h)
    const { data: u, error: eu } = await db.auth.getUser(token)
    if (eu || !u?.user) return json({ error: 'Sesión inválida o vencida: vuelve a iniciar sesión' }, 401, h)
    const { data: adm } = await db.from('admin').select('id_admin').eq('id_admin', u.user.id).maybeSingle()
    if (!adm) return json({ error: 'Solo un administrador puede crear cuentas de restaurante' }, 403, h)

    // 2) Datos de entrada
    const b = await req.json()
    const email = String(b.email ?? '').trim().toLowerCase()
    const password = String(b.password ?? '')
    if (!UUID.test(b.id_restaurante ?? '')) return json({ error: 'Restaurante inválido' }, 400, h)
    if (!EMAIL.test(email) || email.length > 254) return json({ error: 'Correo inválido' }, 400, h)
    if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return json({ error: 'La contraseña debe tener entre 8 y 72 caracteres, con letras y números' }, 400, h)
    }

    // 3) El restaurante existe y todavía no tiene cuenta
    const { data: rest } = await db.from('restaurante').select('id_restaurante,nombre')
      .eq('id_restaurante', b.id_restaurante).maybeSingle()
    if (!rest) return json({ error: 'El restaurante no existe' }, 404, h)
    const { data: yaTiene } = await db.from('restaurante_gestor').select('auth_user_id')
      .eq('id_restaurante', rest.id_restaurante).maybeSingle()
    if (yaTiene) return json({ error: 'Este restaurante ya tiene una cuenta asignada' }, 409, h)

    // 4) Crear el usuario (ya confirmado: no necesita enviar correo)
    const { data: nuevo, error: ec } = await db.auth.admin.createUser({ email, password, email_confirm: true })
    if (ec || !nuevo?.user) {
      const dup = /already|registered|exists/i.test(ec?.message ?? '') || (ec as { code?: string } | null)?.code === 'email_exists'
      return json({ error: dup ? 'Ese correo ya está en uso' : 'No se pudo crear la cuenta' }, dup ? 409 : 500, h)
    }

    // 5) Asignarlo como gestor de ESE restaurante; si falla, deshacer la cuenta
    const { error: eg } = await db.from('restaurante_gestor')
      .insert({ id_restaurante: rest.id_restaurante, auth_user_id: nuevo.user.id })
    if (eg) {
      await db.auth.admin.deleteUser(nuevo.user.id)
      return json({ error: 'No se pudo asignar la cuenta a este restaurante' }, 409, h)
    }

    return json({ ok: true, email, restaurante: rest.nombre }, 200, h)
  } catch (e) {
    console.error('[crear-cuenta-restaurante]', e instanceof Error ? e.message : 'error')
    return json({ error: 'Error interno al crear la cuenta' }, 500, h)
  }
})