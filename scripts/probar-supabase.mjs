// Comprueba que la app puede hablar con tu proyecto de Supabase.  Uso:  npm run probar:supabase
import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Lee .env sin librerías extra
if (existsSync('.env')) {
  for (const ln of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = ln.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !ln.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} else {
  console.log('✗ No existe el archivo .env. Copia .env.example a .env y llena tus datos.')
  process.exit(1)
}

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.log('✗ Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY en .env')
  process.exit(1)
}
if (/secret|service_role/i.test(key) || key.startsWith('sb_secret_')) {
  console.log('✗ Esa es una llave SECRETA. En el frontend va solo la llave PUBLICABLE (sb_publishable_...).')
  process.exit(1)
}

const sb = createClient(url, key)
let fallos = 0
async function probar(nombre, consulta, ok) {
  const { data, error } = await consulta()
  if (error) {
    fallos++
    console.log(`✗ ${nombre}: ${error.message}${error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message) ? '  → ¿ejecutaste boombly_schema.sql?' : ''}`)
  } else console.log(`✓ ${nombre}: ${ok(data)}`)
}

console.log(`Probando ${url} ...\n`)
await probar('Categorías', () => sb.from('categoria').select('nombre'), d => `${d.length} (${d.map(x => x.nombre).join(', ')})`)
await probar('Tarifas de envío', () => sb.from('config_envio').select('*').single(), d => `mínimo $${d.tarifa_minima}, $${d.precio_km}/km, radio ${d.radio_max_km} km`)
await probar('Restaurantes activos', () => sb.from('restaurante').select('nombre,lat,lng'), d => (d.length ? d.map(r => r.nombre).join(', ') : '0 (carga supabase/seed_ejemplo.sql o créalos en el panel)'))
await probar('Seguridad (RLS): pedidos ocultos al público', () => sb.from('pedido').select('id_pedido'), d => (d.length === 0 ? 'correcto, no se ve ninguno' : '⚠ SE VEN PEDIDOS: revisa que RLS esté activado'))

console.log(fallos ? `\n${fallos} prueba(s) fallaron.` : '\nTodo bien: la app ya está conectada a Supabase.')
process.exit(fallos ? 1 : 0)
