// Integración de la pasarela contra la pila LOCAL (Sesión 10b):
//  - callbacks TUU firmados con la clave de la cuenta de prueba local
//    (TUU_LOCAL_TEST_SECRET del .env local) contra payment-webhook/tuu;
//  - callbacks falsos (firma mala, cuenta desconocida) que NO deben crear filas;
//  - abono por pasarela + saldo en línea (pay-online) con la pasarela simulada.
//   npx supabase start && npx supabase functions serve --env-file supabase/functions/.env --no-verify-jwt
//   node scripts/test-gateway.mjs
// Nunca apunta a producción: se niega si la URL no es 127.0.0.1.

import { createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const API = 'http://127.0.0.1:54321'
const FN = `${API}/functions/v1`
const status = JSON.parse(execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' }).replace(/^[^{]*/, ''))
if (!String(status.API_URL).startsWith('http://127.0.0.1')) throw new Error('Solo contra la base local')
const ANON = status.ANON_KEY
const DB = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' }).split('\n').find((n) => n.startsWith('supabase_db_'))
const SECRET = /^TUU_LOCAL_TEST_SECRET=(.+)$/m.exec(readFileSync('supabase/functions/.env', 'utf8'))?.[1]?.trim()
const ACCOUNT = 'LOCAL-TUU-TEST'
const TUU_ACCOUNT_ID = '00000000-0000-4000-8000-0000000000e2'
const psql = (sql) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'postgres'], { input: sql, encoding: 'utf8' }).trim()

const results = []
const check = (name, expected, actual) => results.push({ name, expected: String(expected), actual: String(actual), ok: String(expected) === String(actual) })
const SLUG = 'ejemplo-departamento-centro'
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
const day = (n) => new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + n)).toISOString().slice(0, 10)
const TAG = 'pasarela@test.invalid'

function sign(fields, secret = SECRET) {
  const base = Object.keys(fields).filter((k) => k.startsWith('x_') && k !== 'x_signature').sort().map((k) => k + fields[k]).join('')
  return createHmac('sha256', secret).update(base, 'utf8').digest('hex')
}
async function callback(fields, { secret = SECRET, signature } = {}) {
  const body = new URLSearchParams({ ...fields, x_signature: signature ?? sign(fields, secret) })
  const r = await fetch(`${FN}/payment-webhook/tuu`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  return { status: r.status, ...(await r.json().catch(() => ({}))) }
}
const counts = () => psql(`select (select count(*) from public.payments) || '|' || (select count(*) from public.payment_incidents) || '|' || (select count(*) from public.email_outbox)`)

// Hold por pasarela en la propiedad de ejemplo y cobro con la CUENTA TUU de prueba.
function tuuPayment(n, plan = 'full') {
  const sql = `
    select public.create_booking_hold('${SLUG}', '${day(n)}', '${day(n + 1)}', 2, 'Test Pasarela', '${n}-${TAG}', '+56911111111', 'Chile',
      '{"requested": false}', null,
      (public.pricing_core((select id from public.properties where slug = '${SLUG}'), '${day(n)}', '${day(n + 1)}', 2) ->> 'total_clp')::int,
      'gateway', '${plan}') ->> 'reservation_id';`
  const reservationId = psql(sql)
  psql(`update public.reservations set payment_account_id = '${TUU_ACCOUNT_ID}' where id = '${reservationId}';`)
  const charge = JSON.parse(psql(`select public.create_gateway_payment('${reservationId}')`))
  return { reservationId, reference: charge.reference, amount: charge.amount_clp }
}
const resStatus = (id) => psql(`select status || '|' || amount_paid from public.reservations where id = '${id}'`)
const fieldsFor = (p, over = {}) => ({ x_account_id: ACCOUNT, x_amount: String(p.amount), x_currency: 'CLP', x_message: 'ok', x_reference: p.reference, x_result: 'completed', x_timestamp: '2026-10-09T20:45:12', ...over })

if (!SECRET) throw new Error('Falta TUU_LOCAL_TEST_SECRET en supabase/functions/.env')
psql(`select 1;`)

// ─── 1. Callbacks falsos: 401 y ninguna fila nueva ────────────────────────
const p1 = tuuPayment(200)
const before = counts()
const fakes = await Promise.all([
  callback(fieldsFor(p1), { signature: '0'.repeat(64) }),
  callback(fieldsFor(p1), { secret: 'otra-clave' }),
  callback(fieldsFor(p1, { x_account_id: 'CUENTA-FALSA' })),
  callback(fieldsFor(p1, { x_reference: '00000000-0000-0000-0000-000000000000' }), { secret: 'otra-clave' }),
  callback({ x_reference: p1.reference, x_result: 'completed' }, { signature: '' }),
])
check('5 callbacks falsos → todos 401', '401,401,401,401,401', fakes.map((f) => f.status).join(','))
check('  y no crean filas (pagos | incidentes | correos)', before, counts())
check('  la reserva no cambió', 'hold|0', resStatus(p1.reservationId))

// ─── 2. Callback válido, repetido ─────────────────────────────────────────
const ok = await callback(fieldsFor(p1))
check('Callback firmado "completed" → 200 confirmada', '200|confirmed|confirmada', `${ok.status}|${ok.outcome}|${resStatus(p1.reservationId).split('|')[0]}`)
const again = await Promise.all([callback(fieldsFor(p1)), callback(fieldsFor(p1)), callback(fieldsFor(p1))])
check('Reintentos ×3 → 200 ya procesado, un solo pago aprobado', '200,200,200|already_processed|1',
  `${again.map((a) => a.status).join(',')}|${again[0].outcome}|${psql(`select count(*) from public.payments where reservation_id = '${p1.reservationId}' and status = 'aprobado'`)}`)

// ─── 3. Monto distinto, referencia desconocida, pending, failed ───────────
const p2 = tuuPayment(203)
const mismatch = await callback(fieldsFor(p2, { x_amount: '1000' }))
check('Monto distinto (firma válida) → 200 procesado sin confirmar', '200|amount_mismatch|cancelada', `${mismatch.status}|${mismatch.outcome}|${resStatus(p2.reservationId).split('|')[0]}`)
const incidentsBefore = psql(`select count(*) from public.payment_incidents where kind = 'unknown_payment'`)
const unknown = await callback(fieldsFor(p2, { x_reference: '11111111-2222-3333-4444-555555555555' }))
check('Referencia desconocida (firma válida) → 404 + incidente', `404|${Number(incidentsBefore) + 1}`, `${unknown.status}|${psql(`select count(*) from public.payment_incidents where kind = 'unknown_payment'`)}`)
const p3 = tuuPayment(206)
const pending = await callback(fieldsFor(p3, { x_result: 'pending' }))
check('"pending" → 200 sin cambios', '200|pending|hold', `${pending.status}|${pending.outcome}|${resStatus(p3.reservationId).split('|')[0]}`)
const failed = await callback(fieldsFor(p3, { x_result: 'failed', x_message: 'Saldo insuficiente' }))
check('"failed" → 200 rechazado; el hold se mantiene', '200|rejected|hold', `${failed.status}|${failed.outcome}|${resStatus(p3.reservationId).split('|')[0]}`)

// ─── 4. Tardío con fechas libres ──────────────────────────────────────────
const p4 = tuuPayment(209)
psql(`update public.reservations set hold_expires_at = now() - interval '1 minute' where id = '${p4.reservationId}';
      update public.payments set created_at = now() - interval '40 minutes' where provider_payment_id = '${p4.reference}';
      select public.release_expired_holds();`)
const late = await callback(fieldsFor(p4))
check('Aprobado tarde con fechas libres → 200 recuperada', '200|late_confirmed|confirmada', `${late.status}|${late.outcome}|${resStatus(p4.reservationId).split('|')[0]}`)

// ─── 5. Abono por pasarela (simulada) + saldo en línea ────────────────────
const quote = await (await fetch(`${API}/rest/v1/rpc/quote_stay`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_slug: SLUG, p_check_in: day(215), p_check_out: day(218), p_guests: 2 }) })).json()
const booking = await (await fetch(`${FN}/create-booking`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.70', Origin: 'http://localhost:5174' },
  body: JSON.stringify({ slug: SLUG, check_in: day(215), check_out: day(218), guests: 2, name: 'Test Pasarela', email: `abono-${TAG}`, phone: '+56 9 1111 2222',
    country: 'Chile', invoice: { requested: false }, accept_terms: true, turnstile_token: 'XXXX.DUMMY.TOKEN.XXXX', expected_total_clp: quote.total_clp,
    payment_method: 'gateway', payment_plan: 'deposit' }),
})).json()
check('Reserva con abono por pasarela → URL de pago', true, Boolean(booking.ok && booking.payment_url))
const payId = (url) => new URL(url).pathname.split('/').at(-1)
const gw = async (url, action) => (await fetch(`${FN}/mock-gateway`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_id: payId(url), action }) })).json()
check('  aprobado → confirmada con el abono', 'confirmed', (await gw(booking.payment_url, 'approve')).outcome)
const statusAfterDeposit = await (await fetch(`${API}/rest/v1/rpc/public_booking_status`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_public_code: booking.public_code }) })).json()
check('  el estado ofrece pagar el saldo en línea', 'true|76000', `${statusAfterDeposit.payment.can_pay_online}|${statusAfterDeposit.payment.balance_clp}`)
const payOnline = async (code) => {
  const r = await fetch(`${FN}/pay-online`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5174' }, body: JSON.stringify({ public_code: code }) })
  return { status: r.status, ...(await r.json()) }
}
const balance = await payOnline(booking.public_code)
check('pay-online → URL del saldo por el monto del servidor', '200|76000', `${balance.status}|${balance.amount_clp}`)
const busy = await payOnline(booking.public_code)
check('  segundo intento con uno pendiente → 409', '409|payment_in_progress', `${busy.status}|${busy.reason}`)
check('  saldo aprobado → pagada completa', 'balance_paid', (await gw(balance.payment_url, 'approve')).outcome)
const done = await payOnline(booking.public_code)
check('  sin saldo → 409 nada que pagar', '409|nothing_to_pay', `${done.status}|${done.reason}`)
check('pay-online con un código inválido → 404', 404, (await payOnline('no-es-un-codigo')).status)
check('pay-online con el código corto → 404', 404, (await payOnline(psql(`select code from public.reservations where public_code = '${booking.public_code}'`))).status)

// ─── Limpieza (solo base local, solo lo de esta prueba) ───────────────────
const TEST = `select id from public.reservations where contact_email like '%${TAG}'`
psql(`delete from public.email_outbox where reservation_id in (${TEST});
      delete from public.payment_incidents where reservation_id in (${TEST}) or (kind = 'unknown_payment' and detail ->> 'provider_payment_id' = '11111111-2222-3333-4444-555555555555');
      delete from public.payments where reservation_id in (${TEST});
      delete from public.calendar_occupancies where reservation_id in (${TEST});
      delete from public.reservations where contact_email like '%${TAG}';
      delete from public.guests g where g.email like '%${TAG}' and not exists (select 1 from public.reservations r where r.guest_id = g.id);`)
check('Limpieza local', '0', psql(`select count(*) from public.reservations where contact_email like '%${TAG}'`))

const width = Math.max(...results.map((r) => r.name.length))
for (const r of results) console.log(`${r.ok ? 'OK   ' : 'FALLA'} ${r.name.padEnd(width)}  esperado: ${r.expected}  obtenido: ${r.actual}`)
const failedCount = results.filter((r) => !r.ok).length
console.log(`\nTOTAL ${results.length}  OK ${results.length - failedCount}  FALLA ${failedCount}`)
process.exit(failedCount ? 1 : 0)
