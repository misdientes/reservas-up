// Edge Function ical-export (pública): el calendario que entregamos a Airbnb
// o Booking para que bloqueen nuestras noches.
//   GET /functions/v1/ical-export/calendar/<export_token>.ics
// El token (48 hex, uno por calendario externo) no es adivinable. Sin datos
// personales: solo "Reservado" o "No disponible". Nunca reexporta a un canal
// sus propios eventos ni incluye holds (ver ical_export_events en SQL).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildCalendar, type ExportEvent } from '../_shared/ical.ts'

const notFound = () => new Response('No encontrado', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Método no permitido', { status: 405 })

  const match = /\/calendar\/([0-9a-f]{48})\.ics$/.exec(new URL(req.url).pathname)
  if (!match) return notFound()

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await db.rpc('ical_export_events', { p_token: match[1] })
  if (error) {
    if (error.code !== 'P0002') console.error(JSON.stringify({ evento: 'ical-export-error', codigo: error.code }))
    return notFound()
  }

  const body = buildCalendar((data as ExportEvent[]) ?? [])
  return new Response(req.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="reservas-up.ics"',
      // Caché corta: Airbnb/Booking consultan cada cierto tiempo.
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
