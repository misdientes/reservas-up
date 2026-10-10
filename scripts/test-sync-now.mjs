// "Sincronizar ahora" (Sesión 13) contra la pila LOCAL: la Edge Function
// ical-import acepta el JWT del admin además del secreto del cron.
//  - sin sesión → 401; anon y encargado → 403; admin → 200;
//  - otra vez antes de 60 s → 429 con Retry-After; sin calendarios → 409;
//  - el cron (x-cron-secret) sigue funcionando; CORS solo para el sitio.
//   npx supabase start && npx supabase functions serve --env-file supabase/functions/.env --no-verify-jwt
//   node scripts/test-sync-now.mjs
// Nunca apunta a producción: se niega si la URL no es 127.0.0.1. Borra al
// final todo lo que crea (usuarios, calendario e historial) y lo verifica.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const API = 'http://127.0.0.1:54321'
const FN = `${API}/functions/v1/ical-import`
const status = JSON.parse(execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32' }).replace(/^[^{]*/, ''))
if (!String(status.API_URL).startsWith('http://127.0.0.1')) throw new Error('Solo contra la base local')
const ANON = status.ANON_KEY
const SERVICE = status.SERVICE_ROLE_KEY
const DB = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' }).split('\n').find((n) => n.startsWith('supabase_db_'))
const ENV = readFileSync('supabase/functions/.env', 'utf8')
const CRON = /^ICAL_CRON_SECRET=(.+)$/m.exec(ENV)?.[1]?.trim()
const ORIGIN = /^ALLOWED_ORIGINS=(.+)$/m.exec(ENV)?.[1]?.split(',')[0]?.trim()
const psql = (sql) => execFileSync('docker', ['exec', '-i', DB, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'postgres'], { input: sql, encoding: 'utf8' }).trim()

const results = []
const check = (name, expected, actual) => results.push({ name, expected: String(expected), actual: String(actual), ok: String(expected) === String(actual) })
const STAMP = Date.now()
const started = psql('select now();')

async function createUser(email) {
  const r = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: `Prueba-${STAMP}-x`, email_confirm: true }),
  })
  const user = await r.json()
  const t = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: `Prueba-${STAMP}-x` }),
  })
  return { id: user.id, token: (await t.json()).access_token }
}

async function call(propertyId, headers = {}) {
  const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, ...headers }, body: JSON.stringify({ property_id: propertyId }) })
  return { status: r.status, retryAfter: r.headers.get('retry-after'), body: await r.json().catch(() => ({})) }
}

const admin = await createUser(`sync-admin-${STAMP}@test.invalid`)
const enc = await createUser(`sync-enc-${STAMP}@test.invalid`)
psql(`insert into public.app_users (id, role, full_name) values ('${admin.id}', 'admin', 'TEST sync admin'), ('${enc.id}', 'encargado', 'TEST sync enc');`)
const propA = psql(`select id from public.properties where slug = 'ejemplo-departamento-centro';`)
const propB = psql(`select id from public.properties where slug = 'ejemplo-departamento-costero';`)
const calBefore = psql('select count(*) from public.external_calendars;')
psql(`delete from public.external_calendars where property_id in ('${propA}', '${propB}') and import_url like '%sync-now-test%';`)
// Calendario de prueba (la descarga fallará sin red de Airbnb: lo que importa es el permiso).
psql(`insert into public.external_calendars (property_id, channel, name, import_url) values ('${propA}', 'airbnb', 'TEST sync', 'https://www.airbnb.cl/sync-now-test.ics');`)
const calsB = psql(`select count(*) from public.external_calendars where property_id = '${propB}' and is_active;`)

try {
  check('Sin sesión → 401', 401, (await call(propA, { apikey: ANON })).status)
  check('Con la llave pública (anon) → 403', 403, (await call(propA, { Authorization: `Bearer ${ANON}` })).status)
  check('Encargado → 403', 403, (await call(propA, { Authorization: `Bearer ${enc.token}` })).status)
  const first = await call(propA, { Authorization: `Bearer ${admin.token}` })
  check('Admin → 200 y sincroniza solo esa propiedad', '200|1', `${first.status}|${first.body.calendars}`)
  const second = await call(propA, { Authorization: `Bearer ${admin.token}` })
  check('Admin otra vez antes de 60 s → 429 con Retry-After', '429|cooldown|true', `${second.status}|${second.body.reason}|${Number(second.retryAfter) > 0}`)
  if (calsB === '0') {
    const none = await call(propB, { Authorization: `Bearer ${admin.token}` })
    check('Propiedad sin calendarios → 409', '409|no_calendars', `${none.status}|${none.body.reason}`)
  }
  check('Admin sin property_id → 400', 400, (await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${admin.token}` }, body: '{}' })).status)
  const cron = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON }, body: JSON.stringify({ property_id: propA }) })
  check('El cron con su secreto sigue funcionando', 200, cron.status)
  const badCron = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': 'malo' }, body: '{}' })
  check('Secreto del cron incorrecto (sin JWT) → 401', 401, badCron.status)
  // CORS: la seguridad es el JWT de admin (no el origen); el sitio debe poder
  // leer la respuesta. Localmente el gateway agrega "*" a todo.
  const fromSite = await fetch(FN, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{}' })
  check('CORS: el navegador del sitio puede leer la respuesta', 'true', [ORIGIN, '*'].includes(fromSite.headers.get('access-control-allow-origin')))
  check('La respuesta no expone la URL del calendario', 'false', JSON.stringify(first.body).includes('sync-now-test'))
} finally {
  psql(`delete from public.calendar_occupancies where external_calendar_id in (select id from public.external_calendars where import_url like '%sync-now-test%');
        delete from public.external_calendars where import_url like '%sync-now-test%';
        delete from public.admin_audit_log where at >= '${started}' and table_name = 'external_calendars';
        delete from public.app_users where id in ('${admin.id}', '${enc.id}');
        delete from auth.users where id in ('${admin.id}', '${enc.id}');`)
}
check('Sin datos residuales (calendarios y usuarios)', `${calBefore}|0`,
  `${psql('select count(*) from public.external_calendars;')}|${psql(`select count(*) from auth.users where email like 'sync-%-${STAMP}@test.invalid';`)}`)

for (const r of results) console.log(`${r.ok ? 'OK   ' : 'FALLA'} ${r.name}${r.ok ? '' : ` (esperado ${r.expected}, obtenido ${r.actual})`}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} OK`)
process.exit(failed ? 1 : 0)
