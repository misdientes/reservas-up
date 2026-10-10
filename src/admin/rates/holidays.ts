import { addDays, compareDays, isoWeekday, makeDay, type Day } from '../../lib/dates/day'

// Feriados nacionales de Chile para SUGERIR temporadas en el panel (Sesión
// 13). Es solo una ayuda: René revisa la lista, elige y pone el precio.
// No incluye feriados regionales ni elecciones (se agregan a mano).
// Reglas:
//  * Fijos: 1 ene, 1 may, 21 may, 16 jul, 15 ago, 18 y 19 sep, 1 nov, 8 dic, 25 dic.
//  * Semana Santa: viernes y sábado antes del domingo de Pascua.
//  * Pueblos Indígenas (Ley 21.357): día del solsticio de invierno, hora de Chile.
//  * San Pedro y San Pablo (29 jun) y Encuentro de Dos Mundos (12 oct), Ley
//    19.668: martes a jueves → lunes de esa semana; viernes → lunes siguiente.
//  * Iglesias Evangélicas (31 oct), Ley 20.299: martes → viernes anterior;
//    miércoles → viernes siguiente.
//  * 17 sep si cae lunes (Ley 20.215) y 20 sep si cae viernes (Ley 20.983).

export interface Holiday {
  day: Day
  name: string
}

// Domingo de Pascua (algoritmo gregoriano anónimo).
export function easterSunday(year: number): Day {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return makeDay(year, month, day)
}

// Solsticio de junio (Meeus, precisión de minutos) en la fecha de Chile
// continental (UTC−4 en junio).
export function juneSolsticeChile(year: number): Day {
  const y = (year - 2000) / 1000
  const jde = 2451716.56767 + 365241.62603 * y + 0.00325 * y ** 2 + 0.00888 * y ** 3 - 0.0003 * y ** 4
  const unixMs = (jde - 2440587.5) * 86_400_000 - 4 * 3_600_000
  return new Date(unixMs).toISOString().slice(0, 10)
}

function movedToMonday(day: Day): Day {
  const dow = isoWeekday(day)
  if (dow >= 2 && dow <= 4) return addDays(day, 1 - dow)
  if (dow === 5) return addDays(day, 3)
  return day
}

function reformationDay(year: number): Day {
  const day = makeDay(year, 10, 31)
  const dow = isoWeekday(day)
  if (dow === 2) return addDays(day, -4)
  if (dow === 3) return addDays(day, 2)
  return day
}

export function chileHolidays(year: number): Holiday[] {
  const easter = easterSunday(year)
  const list: Holiday[] = [
    { day: makeDay(year, 1, 1), name: 'Año Nuevo' },
    { day: addDays(easter, -2), name: 'Viernes Santo' },
    { day: addDays(easter, -1), name: 'Sábado Santo' },
    { day: makeDay(year, 5, 1), name: 'Día del Trabajo' },
    { day: makeDay(year, 5, 21), name: 'Glorias Navales' },
    { day: juneSolsticeChile(year), name: 'Pueblos Indígenas' },
    { day: movedToMonday(makeDay(year, 6, 29)), name: 'San Pedro y San Pablo' },
    { day: makeDay(year, 7, 16), name: 'Virgen del Carmen' },
    { day: makeDay(year, 8, 15), name: 'Asunción de la Virgen' },
    { day: makeDay(year, 9, 18), name: 'Fiestas Patrias' },
    { day: makeDay(year, 9, 19), name: 'Glorias del Ejército' },
    { day: movedToMonday(makeDay(year, 10, 12)), name: 'Encuentro de Dos Mundos' },
    { day: reformationDay(year), name: 'Iglesias Evangélicas' },
    { day: makeDay(year, 11, 1), name: 'Todos los Santos' },
    { day: makeDay(year, 12, 8), name: 'Inmaculada Concepción' },
    { day: makeDay(year, 12, 25), name: 'Navidad' },
  ]
  const sep17 = makeDay(year, 9, 17)
  if (isoWeekday(sep17) === 1) list.push({ day: sep17, name: 'Fiestas Patrias (17)' })
  const sep20 = makeDay(year, 9, 20)
  if (isoWeekday(sep20) === 5) list.push({ day: sep20, name: 'Fiestas Patrias (20)' })
  return list.sort((a, b) => compareDays(a.day, b.day))
}

export interface SeasonSuggestion {
  name: string
  // Noches [from, to): llegada la víspera del primer día libre, salida el
  // último día libre.
  from: Day
  to: Day
  holidays: Holiday[]
}

// Agrupa feriados + fines de semana seguidos en "fines de semana largos".
// Se omiten los bloques que son solo un sábado y domingo normales (feriado
// que cae en fin de semana).
export function suggestSeasons(years: number[], today: Day): SeasonSuggestion[] {
  const holidays = years.flatMap(chileHolidays)
  const isHoliday = (day: Day) => holidays.some((h) => h.day === day)
  const isFree = (day: Day) => isoWeekday(day) >= 6 || isHoliday(day)
  const result: SeasonSuggestion[] = []
  for (const holiday of holidays) {
    if (result.some((s) => compareDays(holiday.day, s.from) > 0 && compareDays(holiday.day, s.to) <= 0)) continue
    let first = holiday.day
    while (isFree(addDays(first, -1))) first = addDays(first, -1)
    let last = holiday.day
    while (isFree(addDays(last, 1))) last = addDays(last, 1)
    const inBlock = holidays.filter((h) => compareDays(h.day, first) >= 0 && compareDays(h.day, last) <= 0)
    if (inBlock.every((h) => isoWeekday(h.day) >= 6)) continue
    const from = addDays(first, -1)
    if (compareDays(from, today) < 0) continue
    result.push({ name: [...new Set(inBlock.map((h) => h.name))].join(' + '), from, to: last, holidays: inBlock })
  }
  return result
}
