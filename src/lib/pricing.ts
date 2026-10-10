import { formatCLP } from './money'
import { weekdayName, type Day } from './dates/day'
import { t } from './i18n'

// Cotización pública (respuesta de quote_stay). Solo precios finales: el
// sitio público nunca muestra neto ni impuestos (decisión de René, Sesión 7).

// dow / season_dow: la noche tiene un precio propio por su día de la semana (Sesión 13).
export type NightKind = 'base' | 'dow' | 'season' | 'season_dow'
export type QuoteReason = 'not_found' | 'invalid_dates' | 'advance' | 'max_guests' | 'no_rate' | 'min_nights' | 'unavailable'

export interface QuoteNight {
  date: Day
  kind: NightKind
  season?: string | null
  price_clp: number
}

export interface Quote {
  quotable: boolean
  reason?: QuoteReason
  min_nights?: number
  nights?: QuoteNight[]
  nights_count?: number
  cleaning_clp?: number
  extra_guests?: number
  extra_guests_clp?: number
  // Descuento por estadía larga (Sesión 13): ya restado en total_clp.
  long_stay_discount_percent?: number
  long_stay_discount_clp?: number
  total_clp?: number
}

export interface PriceLine {
  label: string
  amount: string
}

// Agrupa las noches por tipo, temporada, precio y (si el precio es del día)
// día de la semana, en el orden en que aparecen: "3 noches × $40.000",
// "1 noche de viernes × $45.000".
export function nightLines(nights: QuoteNight[]): PriceLine[] {
  const groups: { kind: NightKind; season: string | null; weekday: string | null; price: number; count: number }[] = []
  for (const night of nights) {
    const season = night.season ?? null
    const weekday = night.kind === 'dow' || night.kind === 'season_dow' ? weekdayName(night.date) : null
    const group = groups.find((g) => g.kind === night.kind && g.season === season && g.weekday === weekday && g.price === night.price_clp)
    if (group) group.count += 1
    else groups.push({ kind: night.kind, season, weekday, price: night.price_clp, count: 1 })
  }
  return groups.map((g) => ({
    label: `${t.price.nights(g.count, g.kind, g.season, g.weekday)} × ${formatCLP(g.price)}`,
    amount: formatCLP(g.price * g.count),
  }))
}

// Detalle completo de una cotización: noches, aseo, huéspedes extra y descuento.
export function quoteLines(quote: Quote): PriceLine[] {
  const lines = nightLines(quote.nights ?? [])
  if (quote.cleaning_clp) lines.push({ label: t.price.cleaning, amount: formatCLP(quote.cleaning_clp) })
  if (quote.extra_guests && quote.extra_guests_clp) {
    lines.push({ label: t.price.extraGuests(quote.extra_guests, quote.nights_count ?? 0), amount: formatCLP(quote.extra_guests_clp) })
  }
  if (quote.long_stay_discount_clp && quote.long_stay_discount_percent) {
    lines.push({ label: t.price.longStayDiscount(quote.long_stay_discount_percent), amount: `−${formatCLP(quote.long_stay_discount_clp)}` })
  }
  return lines
}

// Mensaje claro para cada motivo por el que no se puede cotizar.
export function reasonMessage(
  reason: QuoteReason | undefined,
  info: { minNights?: number; maxGuests?: number | null; advanceHours?: number },
): string {
  switch (reason) {
    case 'min_nights':
      return t.price.reasonMinNights(info.minNights ?? 1)
    case 'advance':
      return t.price.reasonAdvance(info.advanceHours ?? 24)
    case 'max_guests':
      return info.maxGuests ? t.price.reasonMaxGuests(info.maxGuests) : t.price.reasonGuests
    case 'unavailable':
      return t.price.reasonUnavailable
    case 'invalid_dates':
      return t.price.reasonInvalidDates
    case 'no_rate':
      return t.price.reasonNoRate
    case 'not_found':
      return t.price.reasonNotFound
    default:
      return t.price.reasonError
  }
}
