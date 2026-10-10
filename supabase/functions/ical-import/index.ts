// Edge Function ical-import: importa los calendarios externos. Dos usos:
//  1. pg_cron (vía pg_net) cada 10 minutos, con el encabezado x-cron-secret
//     (secreto ICAL_CRON_SECRET, guardado también en Vault):
//       POST {}                       → sincroniza todos los calendarios activos
//       POST { "property_id": "…" }   → sincroniza una propiedad (syncProperty)
//  2. "Sincronizar ahora" del panel (Sesión 13), con el JWT del admin:
//       POST { "property_id": "…" }   → solo esa propiedad
//     admin_claim_ical_sync revisa en la base que sea admin y aplica una pausa
//     de 60 s por propiedad. La importación sigue el MISMO camino que el job
//     (syncProperty → apply_ical_import, con su FOR UPDATE por calendario).
// Sin secreto ni JWT de admin responde 401/403 y no hace nada.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { syncCalendars } from '../_shared/ical-sync.ts'
import { corsHeaders, json } from '../_shared/http.ts'

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req, Deno.env.get('ALLOWED_ORIGINS'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)

  const secret = Deno.env.get('ICAL_CRON_SECRET') ?? ''
  const given = req.headers.get('x-cron-secret') ?? ''
  const isCron = secret !== '' && given !== '' && safeEqual(given, secret)

  let propertyId: string | null = null
  try {
    const body = await req.json()
    if (body && typeof body.property_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.property_id)) propertyId = body.property_id
  } catch {
    // Cuerpo vacío: sincroniza todo (solo el cron).
  }

  const url = Deno.env.get('SUPABASE_URL')!
  if (!isCron) {
    // Panel: solo con sesión de admin y siempre UNA propiedad.
    const authorization = req.headers.get('authorization') ?? ''
    if (!/^Bearer\s+\S+$/.test(authorization)) return json({ error: 'No autorizado' }, 401, cors)
    if (!propertyId) return json({ error: 'Falta la propiedad' }, 400, cors)
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    })
    const { data, error } = await asUser.rpc('admin_claim_ical_sync', { p_property_id: propertyId })
    if (error) {
      if (error.code === '42501') return json({ error: 'Solo el administrador' }, 403, cors)
      if (error.code?.startsWith('PGRST3')) return json({ error: 'Sesión inválida' }, 401, cors)
      console.error(JSON.stringify({ evento: 'ical-sync-claim-fallo', code: error.code }))
      return json({ error: 'No se pudo sincronizar' }, 500, cors)
    }
    const claim = data as { ok: boolean; reason?: string; retry_after_seconds?: number }
    if (!claim.ok) {
      const status = claim.reason === 'cooldown' ? 429 : claim.reason === 'not_found' ? 404 : 409
      const extra: Record<string, string> = { ...cors }
      if (claim.retry_after_seconds) extra['Retry-After'] = String(claim.retry_after_seconds)
      return json({ reason: claim.reason, retry_after_seconds: claim.retry_after_seconds }, status, extra)
    }
  }

  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const results = await syncCalendars(db, propertyId)
    return json(
      {
        calendars: results.length,
        ok: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      },
      200,
      cors,
    )
  } catch (error) {
    console.error(JSON.stringify({ evento: 'ical-sync-fallo-general', error: (error as Error).message }))
    return json({ error: 'No se pudo sincronizar' }, 500, cors)
  }
})
