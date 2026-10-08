// RUT chileno: validación del dígito verificador (módulo 11) y formato.
// Fuente única: la usan el formulario (src/pages/CheckoutPage) y la Edge
// Function create-booking. Probado en rut.test.ts.

// "76.086.428-5", "76086428-5", "760864285" → { body: "76086428", dv: "5" }
export function parseRut(input: string): { body: string; dv: string } | null {
  const clean = input.replace(/[.\s]/g, '').replace(/‐|–|—/g, '-').toUpperCase()
  const match = /^(\d{1,8})-?([\dK])$/.exec(clean)
  if (!match) return null
  const body = match[1].replace(/^0+/, '')
  if (body.length < 6) return null // RUT reales tienen al menos 6 dígitos
  return { body, dv: match[2] }
}

export function computeDv(body: string): string {
  let sum = 0
  let factor = 2
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor
    factor = factor === 7 ? 2 : factor + 1
  }
  const rest = 11 - (sum % 11)
  return rest === 11 ? '0' : rest === 10 ? 'K' : String(rest)
}

export function isValidRut(input: string): boolean {
  const parsed = parseRut(input)
  return parsed !== null && computeDv(parsed.body) === parsed.dv
}

// Formato canónico: 76.086.428-5
export function formatRut(input: string): string | null {
  const parsed = parseRut(input)
  if (!parsed || computeDv(parsed.body) !== parsed.dv) return null
  return `${parsed.body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${parsed.dv}`
}
