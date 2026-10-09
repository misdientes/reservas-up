// Renderizado de correos (plantillas de message_templates). Puro y probado
// (render.test.ts). Formato de plantilla:
//   {{variable}}            valor (escapado en HTML)
//   {{#v}} … {{/v}}         solo si v tiene valor
//   {{^v}} … {{/v}}         solo si v NO tiene valor
// Párrafos separados por una línea en blanco; "- " inicia un ítem de lista.
// Montos y fechas se formatean aquí, en hora de Chile y sin impuestos.

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// Mismo formato que el sitio (src/lib/money.ts): "$40.000".
export function formatCLP(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const digits = Math.abs(Math.round(amount)).toString()
  return `${sign}$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

// "2026-12-28" → "lunes 28 de diciembre de 2026" (fecha de calendario, sin zona).
export function formatDay(day: string): string {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${WEEKDAYS[weekday]} ${d} de ${MONTHS[m - 1]} de ${y}`
}

// Instante → "viernes 9 de octubre, 15:45" en hora de Chile.
const chileParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Santiago',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
export function formatInstant(iso: string): string {
  const p = Object.fromEntries(chileParts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  const weekday = WEEKDAYS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)]
  return `${weekday} ${Number(p.day)} de ${MONTHS[Number(p.month) - 1]}, ${p.hour}:${p.minute}`
}

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Transferencia bancaria',
  payment_link: 'Link de pago',
  gateway: 'Pago con tarjeta',
}

type Raw = Record<string, unknown>

// Variables de la base (email_context.vars) → textos listos para la plantilla.
export function formatVars(raw: Raw, siteUrl: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined || value === false || value === '') continue
    if (key.endsWith('_clp') && typeof value === 'number') out[key.slice(0, -4)] = formatCLP(value)
    else if (key === 'check_in' || key === 'check_out') out[key] = formatDay(String(value))
    else if (key.endsWith('_at')) out[key] = formatInstant(String(value))
    else if (key === 'guests') out[key] = Number(value) === 1 ? '1 huésped' : `${value} huéspedes`
    else out[key] = String(value)
  }
  const site = siteUrl.replace(/\/$/, '')
  if (raw.public_code) out.booking_url = `${site}/reserva/${raw.public_code}`
  out.admin_url = `${site}/admin`
  if (raw.payment_method) out.method_label = METHOD_LABELS[String(raw.payment_method)] ?? String(raw.payment_method)
  if (raw.payment_method === 'payment_link') out.is_link = 'true'
  // El código secreto del enlace solo viaja dentro de booking_url.
  delete out.public_code
  return out
}

function applySections(template: string, vars: Record<string, string>): string {
  let text = template
  for (let i = 0; i < 20; i++) {
    const next = text.replace(/\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/, (_m, kind: string, key: string, inner: string) =>
      (kind === '#') === Boolean(vars[key]) ? inner : '',
    )
    if (next === text) break
    text = next
  }
  return text
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function fill(template: string, vars: Record<string, string>, escape: (s: string) => string): string {
  return applySections(template, vars).replace(/\{\{(\w+)\}\}/g, (_m, key: string) => escape(vars[key] ?? ''))
}

// Bloques de texto ya rellenados → HTML simple (párrafos, listas y enlaces).
function blocksToHtml(text: string): string {
  const link = (s: string) => s.replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:#0f4c5c;word-break:break-all">${url}</a>`)
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim())
      const items = lines.filter((l) => l.startsWith('- '))
      const intro = lines.filter((l) => !l.startsWith('- '))
      const p = intro.length ? `<p style="margin:0 0 16px">${link(intro.join('<br>'))}</p>` : ''
      const ul = items.length
        ? `<ul style="margin:0 0 16px;padding-left:20px">${items.map((l) => `<li>${link(l.slice(2))}</li>`).join('')}</ul>`
        : ''
      return p + ul
    })
    .join('')
}

export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

// Colores de docs/diseno/tokens.json (los correos no leen CSS del sitio).
export function renderEmail(template: { subject: string; body: string }, vars: Record<string, string>): RenderedEmail {
  const subject = fill(template.subject, vars, (s) => s).replace(/\s+/g, ' ').trim()
  const text = fill(template.body, vars, (s) => s).replace(/\n{3,}/g, '\n\n').trim()
  const body = blocksToHtml(fill(template.body, vars, escapeHtml))
  const html =
    `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;background:#f3ece2">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:25px;color:#1e2a2f">` +
    `<p style="margin:0 0 20px;font-family:Georgia,serif;font-size:22px">Reservas <span style="background:#b5452f;color:#ffffff;border-radius:999px;padding:0 8px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700">UP</span></p>` +
    `<div style="background:#ffffff;border:1px solid #e2d6c6;border-radius:18px;padding:24px">${body}</div>` +
    `<p style="margin:16px 0 0;font-size:12px;color:#5d6a6e">Reservas UP · reserva directo, precio final y sin cargos de plataforma.</p>` +
    `</div></body></html>`
  return { subject, text, html }
}
