import { describe, expect, it } from 'vitest'
import { formatCLP, formatDay, formatInstant, formatVars, renderEmail } from './render.ts'
import { createResendTransport, getTransport } from './transport.ts'

describe('correos: formato', () => {
  it('pesos, días y horas en Chile', () => {
    expect(formatCLP(111000)).toBe('$111.000')
    expect(formatDay('2026-12-28')).toBe('lunes 28 de diciembre de 2026')
    expect(formatInstant('2026-12-26T18:00:00Z')).toBe('sábado 26 de diciembre, 15:00') // verano, UTC−3
    expect(formatInstant('2026-07-10T19:30:00Z')).toBe('viernes 10 de julio, 15:30') // invierno, UTC−4
  })

  it('variables: montos, enlaces, medio y el código secreto solo dentro del enlace', () => {
    const vars = formatVars(
      { code: 'UP-7ZNJ8', public_code: 'a'.repeat(32), total_clp: 111000, pay_now_clp: 35000, guests: 2, payment_method: 'payment_link', fully_paid: false },
      'https://reservas-up.pages.dev/',
    )
    expect(vars).toMatchObject({
      total: '$111.000',
      pay_now: '$35.000',
      guests: '2 huéspedes',
      booking_url: `https://reservas-up.pages.dev/reserva/${'a'.repeat(32)}`,
      admin_url: 'https://reservas-up.pages.dev/admin',
      method_label: 'Link de pago',
      is_link: 'true',
    })
    expect(vars.public_code).toBeUndefined()
    expect(vars.fully_paid).toBeUndefined()
  })
})

describe('correos: plantillas', () => {
  const tpl = {
    subject: 'Hola {{code}}',
    body: 'Hola {{name}}:\n\n{{#bank}}Datos:\n- Banco: {{bank}}{{/bank}}{{^bank}}Sin banco.{{/bank}}\n\nVer: {{url}}',
  }

  it('secciones condicionales, listas y enlaces', () => {
    const out = renderEmail(tpl, { code: 'UP-1', name: 'Ana', bank: 'Banco X', url: 'https://x.cl/r/1' })
    expect(out.subject).toBe('Hola UP-1')
    expect(out.text).toBe('Hola Ana:\n\nDatos:\n- Banco: Banco X\n\nVer: https://x.cl/r/1')
    expect(out.html).toContain('<li>Banco: Banco X</li>')
    expect(out.html).toContain('<a href="https://x.cl/r/1"')
    expect(renderEmail(tpl, { code: 'UP-1', name: 'Ana', url: 'u' }).text).toContain('Sin banco.')
  })

  it('escapa los datos en HTML (nada inyectable desde un nombre)', () => {
    const out = renderEmail(tpl, { code: 'UP-1', name: '<script>x</script>', url: 'u' })
    expect(out.html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(out.html).not.toContain('<script>')
  })
})

describe('correos: transporte', () => {
  it('Resend con Idempotency-Key = clave del evento', async () => {
    let sent: { url: string; init: RequestInit } | null = null
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, init }
      return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 })
    }) as unknown as typeof fetch
    const result = await createResendTransport('re_test', fake).send({
      from: 'Reservas UP <r@x.cl>', to: 'a@b.cl', subject: 's', text: 't', html: 'h', idempotencyKey: 'res:1:booking_created',
    })
    expect(result).toEqual({ ok: true, messageId: 'msg_1' })
    const headers = sent!.init.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBe('res:1:booking_created')
    expect(headers.Authorization).toBe('Bearer re_test')
  })

  it('error del proveedor → reintento (ok: false con detalle)', async () => {
    const fake = (async () => new Response(JSON.stringify({ name: 'validation_error', message: 'dominio no verificado' }), { status: 403 })) as unknown as typeof fetch
    const result = await createResendTransport('re_test', fake).send({ from: 'a', to: 'b', subject: 's', text: 't', html: 'h', idempotencyKey: 'k' })
    expect(result.ok).toBe(false)
  })

  it('Mailpit solo en la pila local', () => {
    const env = { EMAIL_TRANSPORT: 'mailpit', MAILPIT_URL: 'http://mailpit:8025' }
    expect(getTransport({ ...env, SUPABASE_URL: 'https://ygsckeyfewlcitrwbywf.supabase.co' })).toBeNull()
    expect(getTransport({ ...env, SUPABASE_URL: 'http://kong:8000' })?.name).toBe('mailpit')
    expect(getTransport({ EMAIL_TRANSPORT: 'resend' })).toBeNull() // sin clave
  })
})
