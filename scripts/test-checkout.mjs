// Pruebas de integración del checkout contra la pila LOCAL de Supabase
// (Docker): Edge Functions reales + base local con el seed.
//   npx supabase start && npx supabase functions serve --env-file supabase/functions/.env --no-verify-jwt
//   node scripts/test-checkout.mjs
// Al final borra de la base LOCAL solo las reservas que creó (por id).
// Nunca apunta a producción: se niega si la URL no es 127.0.0.1.

import { execFileSync } from 'node:child_process'

const API = 'http://127.0.0.1:54321'
const FN = `${API}/functions/v1`
const status = JSON.parse(execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' }).replace(/^[^{]*/, ''))
if (!String(status.API_URL).startsWith('http://127.0.0.1')) throw new Error('Solo contra la base local')
const ANON = status.ANON_KEY
const DB_CONTAINER = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' }).split('\n').find((n) => n.startsWith('supabase_db_'))

const results = []
const created = new Set()
const check = (name, expected, actual) => results.push({ name, expected: String(expected), actual: String(actual), ok: String(expected) === String(actual) })

const SLUG = 'ejemplo-departamento-centro' // 35.000/noche + aseo 6.000, máx. 2 huéspedes, mínimo 1 noche
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
const day = (n) => new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + n)).toISOString().slice(0, 10)

async function rpc(fn, args, key = ANON) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  return r.json()
}

async function book(over = {}, ip = '203.0.113.10') {
  const body = {
    slug: SLUG, check_in: day(100), check_out: day(102), guests: 2,
    name: 'Huésped Prueba', email: 'prueba@test.invalid', phone: '+56 9 1111 2222', country: 'Chile',
    invoice: { requested: false }, accept_terms: true, turnstile_token: 'XXXX.DUMMY.TOKEN.XXXX',
    payment_method: 'gateway', payment_plan: 'full',
    ...over,
  }
  // Como el navegador: el total esperado es el de la cotización mostrada.
  if (!('expected_total_clp' in over)) {
    body.expected_total_clp = (await rpc('quote_stay', { p_slug: SLUG, p_check_in: body.check_in, p_check_out: body.check_out, p_guests: body.guests })).total_clp ?? 0
  }
  const r = await fetch(`${FN}/create-booking`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip, Origin: 'http://localhost:5174' }, body: JSON.stringify(body) })
  const data = await r.json()
  if (data.public_code) created.add(data.public_code)
  return { status: r.status, ...data }
}

async function gateway(paymentUrl, action, amountOverride) {
  const paymentId = new URL(paymentUrl).pathname.split('/').at(-1)
  const r = await fetch(`${FN}/mock-gateway`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_id: paymentId, action, amount_override: amountOverride }) })
  return r.json()
}

const bookingStatus = async (code) => (await rpc('public_booking_status', { p_public_code: code }))?.status

// ─── 1. Concurrencia: dos reservas simultáneas para las mismas fechas ─────
const quote = await rpc('quote_stay', { p_slug: SLUG, p_check_in: day(100), p_check_out: day(102), p_guests: 2 })
check('Cotización de referencia (2 × 35.000 + aseo)', 76000, quote.total_clp)
const [a, b] = await Promise.all([
  book({ email: 'carrera-a@test.invalid' }, '203.0.113.1'),
  book({ email: 'carrera-b@test.invalid' }, '203.0.113.2'),
])
const winners = [a, b].filter((x) => x.ok)
const losers = [a, b].filter((x) => !x.ok)
check('Concurrencia: exactamente 1 obtiene el hold', 1, winners.length)
check('  el otro recibe "unavailable" (409)', 'unavailable/409', losers.map((x) => `${x.reason}/${x.status}`).join(','))

// ─── 2. Flujo feliz con la pasarela simulada ──────────────────────────────
const win = winners[0]
check('URL de pago de la pasarela de prueba', true, /\/pasarela-prueba\/[0-9a-f]{24}\?reserva=/.test(win.payment_url))
check('Estado mientras se paga', 'procesando', await bookingStatus(win.public_code))
const approve = await gateway(win.payment_url, 'approve')
check('Pasarela: Aprobar → confirmada', 'confirmed', approve.outcome)
check('Estado público', 'confirmada', await bookingStatus(win.public_code))
const again1 = await gateway(win.payment_url, 'approve')
const again2 = await gateway(win.payment_url, 'approve')
check('Webhook repetido 2 veces más → ya procesado', 'already_processed,already_processed', [again1.outcome, again2.outcome].join(','))

// ─── 3. Monto del navegador ignorado ──────────────────────────────────────
const changed = await book({ check_in: day(110), check_out: day(112), email: 'precio@test.invalid', expected_total_clp: 1 }, '203.0.113.20')
check('Total esperado distinto → price_changed con el total real (409)', 'price_changed/76000/409', `${changed.reason}/${changed.total_clp}/${changed.status}`)
const injected = await book({ check_in: day(110), check_out: day(112), email: 'precio@test.invalid', total_clp: 1, amount: 1 }, '203.0.113.20')
check('Campos de monto inyectados se ignoran: cobra el total del servidor', '76000', injected.total_clp)

// ─── 4. Monto alterado en el aviso de pago ────────────────────────────────
const tampered = await gateway(injected.payment_url, 'approve', 1000)
check('Aviso con monto alterado → no confirma', 'amount_mismatch', tampered.outcome)
check('  estado público', 'no_completada', await bookingStatus(injected.public_code))

// ─── 5. Rechazo → hold liberado ───────────────────────────────────────────
const rej = await book({ check_in: day(120), check_out: day(122), email: 'rechazo@test.invalid' }, '203.0.113.30')
const rejected = await gateway(rej.payment_url, 'reject')
// Decisión de René (10b): un rechazo se registra y el hold se mantiene
// hasta vencer, para que el huésped reintente con otra tarjeta.
check('Pasarela: Rechazar → registrado, el hold se mantiene', 'rejected', rejected.outcome)
check('  las fechas siguen apartadas para el huésped', false, (await rpc('quote_stay', { p_slug: SLUG, p_check_in: day(120), p_check_out: day(122), p_guests: 2 })).quotable)
const abandoned = await book({ check_in: day(124), check_out: day(126), email: 'abandono@test.invalid' }, '203.0.113.31')
check('Pasarela: Abandonar → hold liberado', 'released', (await gateway(abandoned.payment_url, 'abandon')).outcome)

// ─── 6. Límite de 2 holds activos por IP ──────────────────────────────────
await book({ check_in: day(130), check_out: day(131), email: 'ip1@test.invalid' }, '198.51.100.7')
await book({ check_in: day(132), check_out: day(133), email: 'ip2@test.invalid' }, '198.51.100.7')
const third = await book({ check_in: day(134), check_out: day(135), email: 'ip3@test.invalid' }, '198.51.100.7')
check('3.er hold desde la misma IP → 429 hold_limit', 'hold_limit/429', `${third.reason}/${third.status}`)

// ─── 7. Validación del servidor ───────────────────────────────────────────
const badRut = await book({ check_in: day(140), check_out: day(141), email: 'rut@test.invalid', invoice: { requested: true, rut: '76.086.428-4', business_name: 'X SpA', activity: 'Servicios', address: 'Calle 123' } }, '203.0.113.40')
check('Factura con RUT inválido → 422 invalid_rut', '422/invalid_rut', `${badRut.status}/${badRut.errors?.['invoice.rut']}`)
const noTerms = await book({ check_in: day(140), check_out: day(141), email: 'terms@test.invalid', accept_terms: false }, '203.0.113.41')
check('Sin aceptar términos → 422', '422/must_accept', `${noTerms.status}/${noTerms.errors?.accept_terms}`)
const noTurnstile = await book({ check_in: day(140), check_out: day(141), email: 'bot@test.invalid', turnstile_token: '' }, '203.0.113.42')
check('Sin Turnstile → 403', '403/turnstile_failed', `${noTurnstile.status}/${noTurnstile.reason}`)

// ─── 8. Pagos manuales (Sesión 10a) ───────────────────────────────────────
const psql = (sql) => execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'postgres'], { input: sql, encoding: 'utf8' }).trim()
const manual = await book({ check_in: day(150), check_out: day(153), email: 'manual@test.invalid', payment_method: 'bank_transfer', payment_plan: 'deposit' }, '203.0.113.50')
check('Transferencia con abono → 200 sin URL de pago', '200/manual/false', `${manual.status}/${manual.payment_mode}/${'payment_url' in manual}`)
const manualStatus = await rpc('public_booking_status', { p_public_code: manual.public_code })
check('  el enlace muestra esperando pago, abono (1.ª noche 35.000 > 30 %) y datos bancarios', 'esperando_pago/35000/Banco de Ejemplo',
  `${manualStatus?.status}/${manualStatus?.payment?.pay_now_clp}/${manualStatus?.payment?.bank?.bank_name}`)
check('  código corto UP-XXXXX para la transferencia', true, /^UP-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/.test(manualStatus?.code ?? ''))
const [m1, m2] = await Promise.all([
  book({ check_in: day(160), check_out: day(162), email: 'manual-a@test.invalid', payment_method: 'bank_transfer', payment_plan: 'deposit' }, '203.0.113.51'),
  book({ check_in: day(160), check_out: day(162), email: 'manual-b@test.invalid', payment_method: 'payment_link', payment_plan: 'full' }, '203.0.113.52'),
])
check('Concurrencia manual vs manual: exactamente 1 hold', 1, [m1, m2].filter((x) => x.ok).length)
// Llegada (15:00) entre 24 h (anticipación mínima) y 60 h (exige el 100 %):
// mañana si en Chile son antes de las 15:00; si no, pasado mañana.
const chileHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
const near = chileHour < 15 ? 1 : 2
const nearFull = await book({ check_in: day(near), check_out: day(near + 1), email: 'cerca@test.invalid', payment_method: 'bank_transfer', payment_plan: 'deposit' }, '203.0.113.53')
check('Abono con llegada en < 60 h → 409 full_payment_required', 'full_payment_required/409', `${nearFull.reason}/${nearFull.status}`)
psql("update public.app_settings set value = 'whatsapp' where key = 'booking_mode';")
const disabled = await book({ check_in: day(170), check_out: day(171), email: 'off@test.invalid', payment_method: 'bank_transfer', payment_plan: 'full' }, '203.0.113.54')
psql("update public.app_settings set value = 'online' where key = 'booking_mode';")
check('Modo WhatsApp → 503 booking_disabled (no bloquea fechas)', 'booking_disabled/503', `${disabled.reason}/${disabled.status}`)
check('  el modo local vuelve a online', 'online', psql("select value from public.app_settings where key = 'booking_mode';"))

// ─── Limpieza (solo base local, solo lo creado aquí) ──────────────────────
const codes = [...created].map((c) => `'${c}'`).join(',')
if (codes) {
  const sql = `
    delete from public.payment_incidents where reservation_id in (select id from public.reservations where public_code in (${codes}));
    delete from public.payments where reservation_id in (select id from public.reservations where public_code in (${codes}));
    delete from public.calendar_occupancies where reservation_id in (select id from public.reservations where public_code in (${codes}));
    delete from public.reservations where public_code in (${codes});
    delete from public.guests g where g.email like '%@test.invalid' and not exists (select 1 from public.reservations r where r.guest_id = g.id);
    select count(*) from public.reservations where public_code in (${codes});`
  const left = execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'postgres'], { input: sql, encoding: 'utf8' }).trim()
  check('Limpieza: reservas de prueba restantes en la base local', 0, left.split('\n').at(-1))
}

const width = Math.max(...results.map((r) => r.name.length))
for (const r of results) console.log(`${r.ok ? 'OK   ' : 'FALLA'} ${r.name.padEnd(width)}  esperado: ${r.expected}  obtenido: ${r.actual}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\nTOTAL ${results.length}  OK ${results.length - failed}  FALLA ${failed}`)
process.exit(failed ? 1 : 0)
