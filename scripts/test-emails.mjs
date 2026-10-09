// Integración de correos contra la pila LOCAL (Sesión 11): reserva real por
// create-booking → pagos registrados por el admin → email-worker → Mailpit.
//   npx supabase start && npx supabase functions serve --env-file supabase/functions/.env --no-verify-jwt
//   node scripts/test-emails.mjs [--keep]   (--keep deja los correos y la reserva para capturas)
// Nunca apunta a producción: se niega si la URL no es 127.0.0.1.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const KEEP = process.argv.includes('--keep')
const API = 'http://127.0.0.1:54321'
const MAILPIT = 'http://127.0.0.1:54324'
const status = JSON.parse(execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' }).replace(/^[^{]*/, ''))
if (!String(status.API_URL).startsWith('http://127.0.0.1')) throw new Error('Solo contra la base local')
const ANON = status.ANON_KEY
const DB = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' }).split('\n').find((n) => n.startsWith('supabase_db_'))
const CRON = /^ICAL_CRON_SECRET=(.+)$/m.exec(readFileSync('supabase/functions/.env', 'utf8'))?.[1]?.trim()
const psql = (sql) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'postgres'], { input: sql, encoding: 'utf8' }).trim()
// Llama una función como el admin local (claims del JWT dentro de la transacción).
const asAdmin = (sql) => psql(`begin; select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}', true); set local role authenticated; ${sql}; commit;`)

const results = []
const check = (name, expected, actual) => results.push({ name, expected: String(expected), actual: String(actual), ok: String(expected) === String(actual) })
const SLUG = 'ejemplo-departamento-centro'
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
const day = (n) => new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + n)).toISOString().slice(0, 10)

async function rpc(fn, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  return r.json()
}
const worker = async () => (await fetch(`${API}/functions/v1/email-worker`, { method: 'POST', headers: { 'x-cron-secret': CRON ?? '' } })).json()
const inbox = async () => (await (await fetch(`${MAILPIT}/api/v1/messages?limit=100`)).json()).messages ?? []
const message = async (id) => (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()

// Restos de una corrida anterior con --keep (solo reservas de esta prueba).
const TEST_RES = `select id from public.reservations where contact_email like '%correos@test.invalid'`
function cleanup() {
  psql(`delete from public.email_outbox where reservation_id in (${TEST_RES});
        delete from public.access_codes where reservation_id in (${TEST_RES});
        delete from public.payment_incidents where reservation_id in (${TEST_RES});
        delete from public.payments where reservation_id in (${TEST_RES});
        delete from public.calendar_occupancies where reservation_id in (${TEST_RES});
        delete from public.reservations where contact_email like '%correos@test.invalid';
        delete from public.guests g where g.email like '%correos@test.invalid' and not exists (select 1 from public.reservations r where r.guest_id = g.id);`)
  return psql(`select count(*) from public.reservations where contact_email like '%correos@test.invalid'`)
}
cleanup()
await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' })
psql(`insert into public.property_arrival_info (property_id, exact_address, access_instructions, wifi_name, wifi_password, parking)
      select id, 'Calle de Ejemplo 123, depto 45', 'Retira la llave en la caja con clave junto a la puerta.', 'Ejemplo-WiFi', 'clave-de-ejemplo', 'Estacionamiento 12, subterráneo -1'
        from public.properties where slug = '${SLUG}'
      on conflict (property_id) do nothing;`)

// ─── Sin secreto, el worker no hace nada ──────────────────────────────────
const denied = await fetch(`${API}/functions/v1/email-worker`, { method: 'POST', headers: { 'x-cron-secret': 'falso' } })
check('Worker sin secreto → 401', 401, denied.status)

// ─── Reserva real por create-booking (transferencia con abono) ────────────
const ci = day(90), co = day(93)
const quote = await rpc('quote_stay', { p_slug: SLUG, p_check_in: ci, p_check_out: co, p_guests: 2 })
const booking = await (await fetch(`${API}/functions/v1/create-booking`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.90', Origin: 'http://localhost:5174' },
  body: JSON.stringify({ slug: SLUG, check_in: ci, check_out: co, guests: 2, name: 'Camila Rojas', email: 'camila.correos@test.invalid',
    phone: '+56 9 8765 4321', country: 'Chile', invoice: { requested: false }, accept_terms: true, turnstile_token: 'XXXX.DUMMY.TOKEN.XXXX',
    expected_total_clp: quote.total_clp, payment_method: 'bank_transfer', payment_plan: 'deposit' }),
})).json()
check('Reserva creada por HTTP', true, booking.ok)
if (!booking.ok) {
  console.log('No se pudo crear la reserva de prueba:', booking.reason ?? booking)
  process.exit(1)
}
const res = psql(`select id || '|' || code || '|' || deposit_required_clp || '|' || total_clp from public.reservations where public_code = '${booking.public_code}'`).split('|')
const [resId, shortCode, deposit, total] = [res[0], res[1], Number(res[2]), Number(res[3])]

let w = await worker()
check('Worker: reserva creada → 2 enviados (huésped y admin)', 2, w.sent)
w = await worker()
check('Segunda pasada: nada nuevo (no duplica)', 0, w.sent)

// ─── Abono y saldo registrados por el admin ───────────────────────────────
asAdmin(`select public.register_manual_payment('${resId}', 'bank_transfer', ${deposit}, 'OP-CORREO-1')`)
asAdmin(`select public.register_manual_payment('${resId}', 'bank_transfer', ${total - deposit}, 'OP-CORREO-2')`)
asAdmin(`select public.set_reservation_access_code('${resId}', '4821')`)
// Los programados (recordatorio y llegada) se adelantan para la prueba.
psql(`update public.email_outbox set send_after = now() - interval '1 minute' where reservation_id = '${resId}' and status = 'pendiente';`)
w = await worker()
check('Worker: 2 pagos + llegada enviados; recordatorio omitido (saldo pagado)', '3|1', `${w.sent}|${w.skipped}`)

// ─── Liberación por falta de pago ─────────────────────────────────────────
const released = await (await fetch(`${API}/functions/v1/create-booking`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.91', Origin: 'http://localhost:5174' },
  body: JSON.stringify({ slug: SLUG, check_in: day(100), check_out: day(101), guests: 2, name: 'Pedro Soto', email: 'pedro.correos@test.invalid',
    phone: '+56 9 1111 2222', country: 'Chile', invoice: { requested: false }, accept_terms: true, turnstile_token: 'XXXX.DUMMY.TOKEN.XXXX',
    expected_total_clp: (await rpc('quote_stay', { p_slug: SLUG, p_check_in: day(100), p_check_out: day(101), p_guests: 2 })).total_clp,
    payment_method: 'payment_link', payment_plan: 'full' }),
})).json()
psql(`update public.reservations set hold_expires_at = now() - interval '1 minute' where public_code = '${released.public_code}'; select public.release_expired_holds();`)
w = await worker()
check('Hold vencido → correo de fechas liberadas enviado', true, w.sent >= 1)

// ─── Contenido en Mailpit ─────────────────────────────────────────────────
const all = await inbox()
const subjects = all.map((m) => m.Subject)
const find = (prefix, to) => all.find((m) => m.Subject.startsWith(prefix) && (!to || m.To[0].Address === to))
for (const [prefix, to] of [
  [`Reservamos tus fechas · ${shortCode}`, 'camila.correos@test.invalid'],
  [`Nueva reserva esperando pago · ${shortCode}`, 'admin@local.test'],
  [`Recibimos tu pago · ${shortCode}`, 'camila.correos@test.invalid'],
  [`Tu llegada a`, 'camila.correos@test.invalid'],
  [`Liberamos tus fechas`, 'pedro.correos@test.invalid'],
]) check(`Correo "${prefix}"`, true, Boolean(find(prefix, to)))
check('Dos correos de pago (abono y saldo)', 2, subjects.filter((s) => s.startsWith(`Recibimos tu pago · ${shortCode}`)).length)
check('Sin correo de código aparte (la llegada aún no se enviaba al cargarlo)', 0, subjects.filter((s) => s.startsWith('Tu código de acceso')).length)

const created = await message(find(`Reservamos tus fechas · ${shortCode}`).ID)
check('Reserva creada: monto del abono, banco y código corto', true,
  created.Text.includes(`$${deposit.toLocaleString('es-CL')}`) && created.Text.includes('Banco de Ejemplo') && created.Text.includes(`código ${shortCode}`))
check('  el código secreto solo aparece dentro del enlace', 1, created.Text.split(booking.public_code).length - 1)
const arrival = await message(find('Tu llegada a').ID)
check('Llegada: dirección exacta, wifi y código de acceso', true,
  arrival.Text.includes('Calle de Ejemplo 123') && arrival.Text.includes('clave-de-ejemplo') && arrival.Text.includes('4821'))
const bodies = await Promise.all(all.map((m) => message(m.ID)))
check('Ningún correo menciona IVA, neto ni impuesto', 0, bodies.filter((b) => /\bIVA\b|\bneto\b|impuesto/i.test(`${b.Subject} ${b.Text} ${b.HTML}`)).length)
check('Todos con versión HTML y texto', all.length, bodies.filter((b) => b.HTML && b.Text).length)

// ─── Limpieza (solo base local) ───────────────────────────────────────────
if (!KEEP) check('Limpieza local', '0', cleanup())

const width = Math.max(...results.map((r) => r.name.length))
for (const r of results) console.log(`${r.ok ? 'OK   ' : 'FALLA'} ${r.name.padEnd(width)}  esperado: ${r.expected}  obtenido: ${r.actual}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\nTOTAL ${results.length}  OK ${results.length - failed}  FALLA ${failed}`)
if (KEEP) console.log(`\nCorreos en ${MAILPIT} · reserva ${shortCode}`)
process.exit(failed ? 1 : 0)
