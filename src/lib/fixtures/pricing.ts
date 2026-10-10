import { addDays, compareDays, diffDays, isoWeekday, zonedNow, type Day } from '../dates/day'
import { earliestCheckIn, isNightOccupied, AVAILABILITY_WINDOW_DAYS, type OccupiedRange } from '../calendar/availability'
import type { NightKind, Quote, QuoteNight } from '../pricing'

// SOLO DESARROLLO. Réplica aproximada de las reglas de pricing_core para ver
// la interfaz con datos de ejemplo sin base de datos. La verdad está en SQL
// (supabase/migrations/*_pricing_engine.sql, probada en supabase/tests/
// pricing.sql). Este archivo no existe en el build de producción.

interface FixtureSeason {
  name: string
  fromOffset: number // noches desde hoy + fromOffset …
  toOffset: number // … hasta hoy + toOffset (exclusivo)
  nightly: number
  dow: (number | null)[] | null // precio por día ISO (1 = lunes … 7 = domingo)
  minNights: number | null
  priority: number
}

interface FixtureRates {
  base: number
  dow: (number | null)[] | null
  minNights: number | null
  cleaning: number
  includedGuests: number
  extraGuest: number
  seasons: FixtureSeason[]
  discounts: { minNights: number; percent: number }[]
}

const FRI_SAT = (fri: number, sat: number) => [null, null, null, null, fri, sat, null]

const RATES: Record<string, FixtureRates> = {
  'ejemplo-departamento-costero': {
    base: 40000,
    dow: FRI_SAT(45000, 45000),
    minNights: null,
    cleaning: 6000,
    includedGuests: 2,
    extraGuest: 10000,
    seasons: [{ name: 'Verano', fromOffset: 20, toOffset: 41, nightly: 55000, dow: FRI_SAT(60000, 60000), minNights: 3, priority: 1 }],
    discounts: [{ minNights: 7, percent: 10 }, { minNights: 28, percent: 20 }],
  },
  'ejemplo-departamento-centro': {
    base: 35000,
    dow: null,
    minNights: null,
    cleaning: 6000,
    includedGuests: 2,
    extraGuest: 10000,
    seasons: [],
    discounts: [],
  },
  // La cabaña de ejemplo no tiene tarifa: muestra "Consultar precio".
}

function todayChile(): Day {
  return zonedNow(new Date()).day
}

// Temporada ganadora: la de mayor prioridad; desempate, la más corta.
function seasonOf(rates: FixtureRates, day: Day): FixtureSeason | null {
  const today = todayChile()
  return (
    rates.seasons
      .filter((s) => compareDays(day, addDays(today, s.fromOffset)) >= 0 && compareDays(day, addDays(today, s.toOffset)) < 0)
      .sort((a, b) => b.priority - a.priority || a.toOffset - a.fromOffset - (b.toOffset - b.fromOffset))[0] ?? null
  )
}

function nightOf(rates: FixtureRates, day: Day): QuoteNight {
  const season = seasonOf(rates, day)
  const dow = isoWeekday(day) - 1
  let kind: NightKind = 'base'
  let price = rates.base
  if (season && season.dow?.[dow] != null) [kind, price] = ['season_dow', season.dow[dow]!]
  else if (season) [kind, price] = ['season', season.nightly]
  else if (rates.dow?.[dow] != null) [kind, price] = ['dow', rates.dow[dow]!]
  return { date: day, kind, season: season?.name ?? null, price_clp: price }
}

export function fixturePriceFrom(slug: string): number | null {
  const rates = RATES[slug]
  if (!rates) return null
  const today = todayChile()
  return Math.min(...Array.from({ length: 90 }, (_, i) => nightOf(rates, addDays(today, i)).price_clp))
}

export function fixtureQuote(
  property: { slug: string; min_nights: number; max_guests: number | null; min_advance_hours: number; check_in_time: string | null },
  checkIn: Day,
  checkOut: Day,
  guests: number,
  ranges: OccupiedRange[],
): Quote {
  const today = todayChile()
  if (compareDays(checkOut, checkIn) <= 0 || compareDays(checkIn, today) < 0 || diffDays(today, checkOut) > AVAILABILITY_WINDOW_DAYS) {
    return { quotable: false, reason: 'invalid_dates' }
  }
  if (compareDays(checkIn, earliestCheckIn(new Date(), property.min_advance_hours, property.check_in_time)) < 0) {
    return { quotable: false, reason: 'advance' }
  }
  if (guests < 1 || (property.max_guests !== null && guests > property.max_guests)) return { quotable: false, reason: 'max_guests' }
  const rates = RATES[property.slug]
  if (!rates) return { quotable: false, reason: 'no_rate' }
  const minNights = Math.max(property.min_nights, seasonOf(rates, checkIn)?.minNights ?? rates.minNights ?? 1)
  const count = diffDays(checkIn, checkOut)
  if (count < minNights) return { quotable: false, reason: 'min_nights', min_nights: minNights }
  const nights = Array.from({ length: count }, (_, i) => nightOf(rates, addDays(checkIn, i)))
  if (nights.some((n) => isNightOccupied(n.date, ranges))) return { quotable: false, reason: 'unavailable', min_nights: minNights }
  const extraGuests = Math.max(0, guests - rates.includedGuests)
  const extraTotal = extraGuests * rates.extraGuest * count
  const nightsTotal = nights.reduce((sum, n) => sum + n.price_clp, 0)
  const tier = rates.discounts.filter((d) => d.minNights <= count).sort((a, b) => b.minNights - a.minNights)[0]
  const discount = tier ? Math.round(((nightsTotal + extraTotal) * tier.percent) / 100) : 0
  return {
    quotable: true,
    nights,
    nights_count: count,
    cleaning_clp: rates.cleaning,
    extra_guests: extraGuests,
    extra_guests_clp: extraTotal,
    ...(tier ? { long_stay_discount_percent: tier.percent, long_stay_discount_clp: discount } : {}),
    total_clp: nightsTotal + rates.cleaning + extraTotal - discount,
    min_nights: minNights,
  }
}
