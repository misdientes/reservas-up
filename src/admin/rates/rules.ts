// Validaciones del formulario de tarifas (Sesión 13). Son una ayuda para
// René: los mismos límites viven en la base (CHECK y triggers), que es la
// que decide.

export const PRICE_MIN = 1000
export const PRICE_MAX = 5_000_000

// "$40.000", "40.000" o "40000" → 40000. Vacío → null. Pesos enteros.
export function parseClp(input: string): number | null {
  const clean = input.replace(/[$.\s]/g, '')
  if (clean === '') return null
  return /^\d+$/.test(clean) ? Number(clean) : NaN
}

export const priceOk = (n: number | null) => n !== null && Number.isInteger(n) && n >= PRICE_MIN && n <= PRICE_MAX
const intIn = (n: number | null, min: number, max: number) => n !== null && Number.isInteger(n) && n >= min && n <= max

export interface RateValues {
  name: string
  base: string
  dow: string[] // 7 posiciones (lunes … domingo); '' = precio base
  cleaning: string
  includedGuests: string
  extraGuest: string
  minNights: string
}

export function validateRate(v: RateValues): Record<string, string> {
  const e: Record<string, string> = {}
  if (v.name.trim().length < 2 || v.name.trim().length > 80) e.name = 'name'
  if (!priceOk(parseClp(v.base))) e.base = 'price'
  v.dow.forEach((d, i) => {
    if (d.trim() !== '' && !priceOk(parseClp(d))) e[`dow${i}`] = 'price'
  })
  const cleaning = parseClp(v.cleaning) ?? 0
  if (!intIn(cleaning, 0, 1_000_000)) e.cleaning = 'range'
  if (!intIn(Number(v.includedGuests), 1, 30)) e.includedGuests = 'range'
  const extra = parseClp(v.extraGuest) ?? 0
  if (!intIn(extra, 0, 500_000)) e.extraGuest = 'range'
  if (v.minNights.trim() !== '' && !intIn(Number(v.minNights), 1, 60)) e.minNights = 'range'
  return e
}

// 7 textos → arreglo para la base; todo vacío = null (sin precios por día).
export function dowToDb(dow: string[]): (number | null)[] | null {
  const values = dow.map((d) => parseClp(d))
  return values.every((x) => x === null) ? null : values
}

export function dowFromDb(dow: (number | null)[] | null): string[] {
  return Array.from({ length: 7 }, (_, i) => (dow?.[i] != null ? String(dow[i]) : ''))
}

export interface SeasonValues {
  name: string
  from: string
  to: string // día de SALIDA (exclusivo): noches [from, to)
  price: string
  dow: string[]
  minNights: string
  priority: string
}

export function validateSeason(v: SeasonValues): Record<string, string> {
  const e: Record<string, string> = {}
  if (v.name.trim().length < 2 || v.name.trim().length > 80) e.name = 'name'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.from)) e.from = 'date'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.to) || v.to <= v.from) e.to = 'date'
  if (!priceOk(parseClp(v.price))) e.price = 'price'
  v.dow.forEach((d, i) => {
    if (d.trim() !== '' && !priceOk(parseClp(d))) e[`dow${i}`] = 'price'
  })
  if (v.minNights.trim() !== '' && !intIn(Number(v.minNights), 1, 60)) e.minNights = 'range'
  if (!['1', '2', '3'].includes(v.priority)) e.priority = 'range'
  return e
}

export function validateDiscount(minNights: string, percent: string): Record<string, string> {
  const e: Record<string, string> = {}
  if (!intIn(Number(minNights), 2, 365)) e.minNights = 'range'
  if (!intIn(Number(percent), 1, 60)) e.percent = 'range'
  return e
}
