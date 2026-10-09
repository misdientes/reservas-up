// Transporte de correo desacoplado (como los pagos): Resend en producción,
// Mailpit solo en la pila local (mismo candado de entorno que el mock).

import { isLocalSupabase } from '../payments/provider.ts'

export interface OutgoingEmail {
  from: string
  to: string
  subject: string
  text: string
  html: string
  // Clave del evento: Resend descarta un segundo envío con la misma clave.
  idempotencyKey: string
}

export type SendResult = { ok: true; messageId: string | null } | { ok: false; error: string }

export interface EmailTransport {
  name: 'resend' | 'mailpit'
  send(email: OutgoingEmail): Promise<SendResult>
}

export interface TransportEnv {
  EMAIL_TRANSPORT?: string
  RESEND_API_KEY?: string
  MAILPIT_URL?: string
  SUPABASE_URL?: string
}

type Fetch = typeof fetch

export function createResendTransport(apiKey: string, fetchImpl: Fetch = fetch): EmailTransport {
  return {
    name: 'resend',
    async send(email) {
      try {
        const response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': email.idempotencyKey.slice(0, 256),
          },
          body: JSON.stringify({ from: email.from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
        })
        const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string }
        if (!response.ok) return { ok: false, error: `resend ${response.status}: ${data.name ?? ''} ${data.message ?? ''}`.trim() }
        return { ok: true, messageId: data.id ?? null }
      } catch (error) {
        return { ok: false, error: `resend: ${error instanceof Error ? error.message : 'error de red'}` }
      }
    },
  }
}

export function createMailpitTransport(baseUrl: string, fetchImpl: Fetch = fetch): EmailTransport {
  return {
    name: 'mailpit',
    async send(email) {
      const match = /^(.*)<(.+)>$/.exec(email.from)
      const from = match ? { Name: match[1].trim(), Email: match[2].trim() } : { Email: email.from }
      try {
        const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/v1/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ From: from, To: [{ Email: email.to }], Subject: email.subject, Text: email.text, HTML: email.html }),
        })
        const data = (await response.json().catch(() => ({}))) as { ID?: string }
        if (!response.ok) return { ok: false, error: `mailpit ${response.status}` }
        return { ok: true, messageId: data.ID ?? null }
      } catch (error) {
        return { ok: false, error: `mailpit: ${error instanceof Error ? error.message : 'error de red'}` }
      }
    },
  }
}

// null = sin transporte utilizable (el worker no toma correos).
export function getTransport(env: TransportEnv, fetchImpl: Fetch = fetch): EmailTransport | null {
  if (env.EMAIL_TRANSPORT === 'resend' && env.RESEND_API_KEY) return createResendTransport(env.RESEND_API_KEY, fetchImpl)
  if (env.EMAIL_TRANSPORT === 'mailpit' && env.MAILPIT_URL && isLocalSupabase(env.SUPABASE_URL)) {
    return createMailpitTransport(env.MAILPIT_URL, fetchImpl)
  }
  return null
}
