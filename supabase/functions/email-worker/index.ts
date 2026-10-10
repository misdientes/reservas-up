// Edge Function email-worker: envía los correos de email_outbox. La llama
// pg_cron cada minuto (pg_net) con el secreto compartido x-cron-secret
// (ICAL_CRON_SECRET, el mismo de ical-import, guardado también en Vault).
// Toma un lote (claim_emails), arma cada correo con los datos ACTUALES
// (email_context), lo envía y registra el resultado (mark_email_result):
// reintentos con backoff y 'fallido' tras 6 intentos.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { formatVars, renderEmail } from '../_shared/email/render.ts'
import { workerReady } from '../_shared/email/transport.ts'
import { safeEqual } from '../_shared/payments/mock.ts'
import { json } from '../_shared/http.ts'

interface Context {
  skip?: string
  id: string
  event_key: string
  to_email: string
  subject: string
  body: string
  from_address: string
  from_name: string
  vars: Record<string, unknown>
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('ICAL_CRON_SECRET') ?? ''
  if (req.method !== 'POST' || !secret || !safeEqual(req.headers.get('x-cron-secret') ?? '', secret)) {
    return json({ ok: false }, 401)
  }

  // Sin transporte o sin SITE_URL no se reclama NADA (antes de claim_emails):
  // los correos quedan pendientes sin consumir intentos.
  const ready = workerReady({
    EMAIL_TRANSPORT: Deno.env.get('EMAIL_TRANSPORT'),
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY'),
    MAILPIT_URL: Deno.env.get('MAILPIT_URL'),
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SITE_URL: Deno.env.get('SITE_URL'),
  })
  if (!ready) return json({ ok: false, reason: 'email_not_configured' }, 503)
  const { transport, siteUrl } = ready

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: claimed, error } = await db.rpc('claim_emails', { p_limit: 20 })
  if (error) return json({ ok: false, reason: 'claim_failed' }, 500)

  const summary = { sent: 0, skipped: 0, failed: 0 }
  for (const row of (claimed ?? []) as { id: string }[]) {
    const { data: ctxData, error: ctxError } = await db.rpc('email_context', { p_id: row.id })
    const ctx = ctxData as Context | null
    if (ctxError || !ctx) {
      await db.rpc('mark_email_result', { p_id: row.id, p_status: 'error', p_error: 'contexto no disponible' })
      summary.failed++
      continue
    }
    if (ctx.skip) {
      await db.rpc('mark_email_result', { p_id: row.id, p_status: 'omitido', p_error: ctx.skip })
      summary.skipped++
      continue
    }
    if (!ctx.from_address) {
      await db.rpc('mark_email_result', { p_id: row.id, p_status: 'error', p_error: 'falta email_from_address' })
      summary.failed++
      continue
    }

    const email = renderEmail({ subject: ctx.subject, body: ctx.body }, formatVars(ctx.vars, siteUrl))
    const result = await transport.send({
      from: `${ctx.from_name} <${ctx.from_address}>`,
      to: ctx.to_email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      idempotencyKey: ctx.event_key,
    })
    if (result.ok) {
      await db.rpc('mark_email_result', { p_id: row.id, p_status: 'enviado', p_provider_message_id: result.messageId })
      summary.sent++
    } else {
      await db.rpc('mark_email_result', { p_id: row.id, p_status: 'error', p_error: result.error })
      summary.failed++
    }
  }

  // Sin datos personales en el registro: solo conteos.
  console.log(JSON.stringify({ evento: 'email-worker', transporte: transport.name, ...summary }))
  return json({ ok: true, ...summary })
})
