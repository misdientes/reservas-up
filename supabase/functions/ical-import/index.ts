// Edge Function ical-import: importa los calendarios externos.
// La invoca pg_cron (vía pg_net) cada 10 minutos con el encabezado
// x-cron-secret (secreto ICAL_CRON_SECRET, guardado también en Vault).
// No es pública: sin el secreto responde 401 y no hace nada.
//   POST {}                       → sincroniza todos los calendarios activos
//   POST { "property_id": "…" }   → sincroniza una propiedad (syncProperty)

import { createClient } from 'npm:@supabase/supabase-js@2'
import { syncCalendars } from '../_shared/ical-sync.ts'

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const secret = Deno.env.get('ICAL_CRON_SECRET') ?? ''
  const given = req.headers.get('x-cron-secret') ?? ''
  if (!secret || !safeEqual(given, secret)) return json({ error: 'No autorizado' }, 401)

  let propertyId: string | null = null
  try {
    const body = await req.json()
    if (body && typeof body.property_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.property_id)) propertyId = body.property_id
  } catch {
    // Cuerpo vacío: sincroniza todo.
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const results = await syncCalendars(db, propertyId)
    return json({
      calendars: results.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    })
  } catch (error) {
    console.error(JSON.stringify({ evento: 'ical-sync-fallo-general', error: (error as Error).message }))
    return json({ error: 'No se pudo sincronizar' }, 500)
  }
})
