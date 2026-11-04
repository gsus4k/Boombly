// Hace un pedido de prueba a tu función "crear-pedido". Te va preguntando los datos.  Uso:  npm run probar:pedido
import { readFileSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createClient } from '@supabase/supabase-js'

if (!existsSync('.env')) { console.log('✗ No existe el archivo .env (paso 8 de la guía).'); process.exit(1) }
for (const ln of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = ln.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !ln.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) { console.log('✗ Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY en .env'); process.exit(1) }

const lineas = createInterface({ input: process.stdin })[Symbol.asyncIterator]()
async function preguntar(texto, porDefecto) {
  process.stdout.write(`${texto}${porDefecto !== undefined ? ` [${porDefecto}]` : ''}: `)
  const { value, done } = await lineas.next()
  const r = (done ? '' : value ?? '').trim()
  if (done) process.stdout.write('\n')
  return r === '' && porDefecto !== undefined ? String(porDefecto) : r
}
const salir = msg => { console.log(`\n✗ ${msg}`); process.exit(1) }

const sb = createClient(url, key)
console.log('\n=== Pedido de prueba Boombly ===\n')

// 1) Restaurante
const { data: rests, error: e1 } = await sb.from('restaurante').select('id_restaurante,nombre,lat,lng').order('nombre')
if (e1) salir(`No pude leer los restaurantes: ${e1.message}`)
if (!rests.length) salir('No hay restaurantes. Ejecuta supabase/seed_ejemplo.sql (paso 6).')
rests.forEach((r, i) => console.log(`  ${i + 1}) ${r.nombre}`))
const rest = rests[(Number(await preguntar('\n¿Qué restaurante? (número)', 1)) || 1) - 1] ?? rests[0]

// 2) Producto
const { data: prods, error: e2 } = await sb.from('detalle_producto').select('id_producto,precio,disponible,producto(nombre)').eq('id_restaurante', rest.id_restaurante).eq('disponible', true)
if (e2) salir(`No pude leer los productos: ${e2.message}`)
if (!prods.length) salir(`${rest.nombre} no tiene productos disponibles.`)
console.log(`\nProductos de ${rest.nombre}:`)
prods.forEach((p, i) => console.log(`  ${i + 1}) ${p.producto?.nombre ?? p.id_producto}  —  $ ${Number(p.precio).toFixed(2)}`))
const prod = prods[(Number(await preguntar('\n¿Qué producto? (número)', 1)) || 1) - 1] ?? prods[0]
const cantidad = Math.max(1, Math.min(50, Number(await preguntar('¿Cuántas unidades?', 2)) || 2))

// 3) Cliente y datos del pago
console.log('\nUsa el cliente que creaste con el SQL del paso 13:')
const codigo = (await preguntar('Código del cliente (CL-XXXXXX)')).toUpperCase()
const telefono = (await preguntar('Teléfono del cliente (584141234567)')).replace(/\D/g, '')
const referencia = (await preguntar('Referencia del pago móvil (4 a 20 números)', 123456)).replace(/\D/g, '')
if (!/^CL-[A-Z0-9]{6}$/.test(codigo)) salir('El código del cliente debe verse así: CL-A1B2C3 (lo devuelve el SQL del paso 13).')
if (telefono.length < 10) salir('El teléfono debe tener el formato 584141234567 (58 + número sin el 0).')
if (referencia.length < 4) salir('La referencia debe tener entre 4 y 20 números.')

// 4) Ubicación de entrega: por defecto ~3 km al norte del restaurante
const lat0 = (Number(rest.lat) + 0.03).toFixed(5), lng0 = Number(rest.lng).toFixed(5)
const ub = await preguntar('Ubicación de entrega "lat,lng" (Enter = cerca del restaurante)', `${lat0},${lng0}`)
const [lat, lng] = ub.split(',').map(s => Number(s.trim()))
if (!Number.isFinite(lat) || !Number.isFinite(lng)) salir('La ubicación debe tener el formato  10.07,-69.30')

// 5) Llamar a la función
console.log('\nEnviando el pedido...')
let r, j
try {
  r = await fetch(`${url}/functions/v1/crear-pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify({ codigo, telefono, id_restaurante: rest.id_restaurante, lat, lng, referencia, items: [{ id_producto: prod.id_producto, cantidad }] }) })
  j = await r.json().catch(() => ({}))
} catch (e) { salir(`No pude conectar con la función: ${e.message}`) }

if (!r.ok || !j.ok) {
  const msg = j?.error ?? j?.message ?? `Error ${r.status}`
  const pista = /Cliente no encontrado/.test(msg) ? 'El código y el teléfono deben ser EXACTAMENTE los de la tabla cliente.'
    : /cobertura/i.test(msg) ? 'El destino está a más de 100 km del restaurante: revisa lat/lng del restaurante y de la entrega.'
    : /ruta inv/i.test(msg) ? 'Casi siempre es lat/lng del restaurante mal puestas (¿invertidas?).'
    : /JWT/i.test(msg) ? 'Publica la función con:  npx supabase functions deploy crear-pedido --no-verify-jwt'
    : r.status === 404 ? 'La función no está publicada: ejecuta el deploy del paso 12.' : ''
  salir(`La función respondió: ${msg}${pista ? `\n  → ${pista}` : ''}`)
}
const p = j.pedido
console.log(`\n✓ Pedido creado: ${p.codigo}`)
console.log(`    Subtotal: $ ${p.subtotal.toFixed(2)}`)
console.log(`    Envío:    $ ${p.costo_envio.toFixed(2)}  (${p.distancia_km.toFixed(1)} km${j.ruta_exacta ? ' por ruta' : ', estimado'})`)
console.log(`    Total:    $ ${p.total.toFixed(2)}`)
console.log(`\n  WhatsApp al restaurante: ${j.avisos.restaurante ? '✓ enviado' : '✗ no enviado'}`)
console.log(`  WhatsApp al repartidor:  ${j.avisos.repartidor ? '✓ enviado' : '✗ no enviado'}`)
if (!j.avisos.restaurante || !j.avisos.repartidor) console.log('  (si WhatsApp aún no está configurado es normal: mira la tabla "notificacion" para ver el motivo)')
console.log('\nAhora abre Supabase → Table Editor y revisa las tablas pedido, detalle_pedido, pago y notificacion.\n')
process.exit(0)
