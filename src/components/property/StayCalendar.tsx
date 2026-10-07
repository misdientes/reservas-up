import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '../icons'
import { textLink } from '../ui'
import {
  addDays,
  addMonths,
  compareDays,
  diffDays,
  formatLong,
  formatMonthYear,
  formatRange,
  isoWeekday,
  monthGrid,
  startOfMonth,
  WEEKDAYS_SHORT,
  type Day,
} from '../../lib/dates/day'
import {
  canCheckIn,
  canCheckOut,
  isNightBlocked,
  validateStay,
  type StayContext,
} from '../../lib/calendar/availability'
import { DESKTOP_QUERY, useMediaQuery } from '../../lib/use-media-query'
import { t } from '../../lib/i18n'

interface Props {
  ctx: StayContext
  minAdvanceHours: number
  llegada: Day | null
  salida: Day | null
  onChange: (llegada: Day | null, salida: Day | null) => void
  // Aviso externo (fechas de la URL descartadas, fechas recién ocupadas).
  notice: string | null
}

type DayState = 'unavailable' | 'available' | 'checkIn' | 'checkOut' | 'inRange' | 'checkoutOnly'

// Calendario de disponibilidad: 1 mes en celular, 2 en escritorio.
// Cuadrícula accesible con teclado (patrón "grid" de WAI-ARIA, foco
// itinerante): flechas, Inicio/Fin, Re Pág/Av Pág (Mayús = año), Enter.
export function StayCalendar({ ctx, minAdvanceHours, llegada, salida, onChange, notice }: Props) {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const monthsShown = desktop ? 2 : 1
  const firstMonth = startOfMonth(ctx.today)
  const lastMonth = startOfMonth(addDays(ctx.windowEnd, -1))

  const [viewMonth, setViewMonth] = useState<Day>(startOfMonth(llegada ?? ctx.today))
  const [focused, setFocused] = useState<Day>(llegada ?? (compareDays(ctx.earliest, ctx.windowEnd) < 0 ? ctx.earliest : ctx.today))
  const [message, setMessage] = useState<string | null>(null)
  const moveFocusRef = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const helpId = useId()

  const visibleMonths = Array.from({ length: monthsShown }, (_, i) => addMonths(viewMonth, i))
  const lastVisible = visibleMonths[visibleMonths.length - 1]

  // Tras moverse con el teclado, el foco va al botón del día enfocado.
  useEffect(() => {
    if (!moveFocusRef.current) return
    moveFocusRef.current = false
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus()
  }, [focused, viewMonth])

  function stateOf(day: Day): DayState {
    if (llegada && day === llegada) return 'checkIn'
    if (salida && day === salida) return 'checkOut'
    if (llegada && salida && compareDays(day, llegada) > 0 && compareDays(day, salida) < 0) return 'inRange'
    if (llegada && !salida && compareDays(day, llegada) > 0 && canCheckOut(llegada, day, ctx) && isNightBlocked(day, ctx)) {
      return 'checkoutOnly'
    }
    if (llegada && !salida && compareDays(day, llegada) > 0 && canCheckOut(llegada, day, ctx)) return 'available'
    return canCheckIn(day, ctx) ? 'available' : 'unavailable'
  }

  function select(day: Day) {
    const pickArrival = () => {
      if (canCheckIn(day, ctx)) {
        onChange(day, null)
        setMessage(t.calendar.pickCheckOut(formatLong(day)))
      } else if (compareDays(day, ctx.today) >= 0 && compareDays(day, ctx.earliest) < 0) {
        setMessage(t.calendar.errorAdvance(minAdvanceHours))
      } else {
        setMessage(t.calendar.errorUnavailable)
      }
    }

    if (!llegada || salida || compareDays(day, llegada) <= 0) {
      pickArrival()
      return
    }
    const error = validateStay(llegada, day, ctx)
    if (error === null) {
      onChange(llegada, day)
      setMessage(t.calendar.selected(formatRange(llegada, day), diffDays(llegada, day)))
    } else if (error === 'minNights') {
      setMessage(t.calendar.errorMinNights(ctx.minNights))
    } else if (error === 'crosses') {
      setMessage(t.calendar.errorCrosses)
    } else {
      setMessage(t.calendar.errorUnavailable)
    }
  }

  function moveTo(day: Day) {
    // No salir de la ventana navegable.
    let target = day
    if (compareDays(target, firstMonth) < 0) target = firstMonth
    const lastDay = addDays(addMonths(lastMonth, 1), -1)
    if (compareDays(target, lastDay) > 0) target = lastDay
    moveFocusRef.current = true
    setFocused(target)
    const targetMonth = startOfMonth(target)
    if (compareDays(targetMonth, viewMonth) < 0) setViewMonth(targetMonth)
    else if (compareDays(targetMonth, lastVisible) > 0) setViewMonth(addMonths(targetMonth, -(monthsShown - 1)))
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, day: Day) {
    const weekday = isoWeekday(day)
    const moves: Record<string, () => Day> = {
      ArrowLeft: () => addDays(day, -1),
      ArrowRight: () => addDays(day, 1),
      ArrowUp: () => addDays(day, -7),
      ArrowDown: () => addDays(day, 7),
      Home: () => addDays(day, 1 - weekday),
      End: () => addDays(day, 7 - weekday),
      PageUp: () => sameDayIn(day, event.shiftKey ? -12 : -1),
      PageDown: () => sameDayIn(day, event.shiftKey ? 12 : 1),
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      moveTo(move())
    }
  }

  const canGoBack = compareDays(viewMonth, firstMonth) > 0
  const canGoForward = compareDays(lastVisible, lastMonth) < 0
  const shift = (n: number) => {
    const next = addMonths(viewMonth, n)
    setViewMonth(next)
    setFocused(next)
  }

  const fallbackText =
    llegada && salida
      ? t.calendar.selected(formatRange(llegada, salida), diffDays(llegada, salida))
      : llegada
        ? t.calendar.pickCheckOut(formatLong(llegada))
        : t.calendar.pickCheckIn
  const liveText = notice ?? message ?? fallbackText

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => shift(-1)}
          disabled={!canGoBack}
          aria-label={t.calendar.previousMonth}
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-pill border border-border-control text-ink disabled:opacity-50"
        >
          <ChevronLeftIcon />
        </button>
        {(llegada || salida) && (
          <button
            type="button"
            onClick={() => {
              onChange(null, null)
              setMessage(null)
            }}
            className={`${textLink} inline-flex min-h-10 items-center text-body-s`}
          >
            {t.calendar.clear}
          </button>
        )}
        <button
          type="button"
          onClick={() => shift(1)}
          disabled={!canGoForward}
          aria-label={t.calendar.nextMonth}
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-pill border border-border-control text-ink disabled:opacity-50"
        >
          <ChevronRightIcon />
        </button>
      </div>

      <p id={helpId} className="sr-only">
        {t.calendar.keyboardHelp}
      </p>

      <div ref={gridRef} className="mt-4 grid gap-7 md:grid-cols-2">
        {visibleMonths.map((month) => (
          <table key={month} role="grid" aria-describedby={helpId} className="w-full border-collapse">
            <caption className="pb-3 text-title text-ink first-letter:uppercase">{formatMonthYear(month)}</caption>
            <thead>
              <tr>
                {WEEKDAYS_SHORT.map((name) => (
                  <th key={name} scope="col" className="pb-2 text-label uppercase text-ink-muted">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthGrid(month).map((week, w) => (
                <tr key={w}>
                  {week.map((day, d) => {
                    if (!day) return <td key={d} role="gridcell" />
                    const state = stateOf(day)
                    const selected = state === 'checkIn' || state === 'checkOut' || state === 'inRange'
                    return (
                      <td key={day} role="gridcell" aria-selected={selected} className="p-0">
                        <button
                          type="button"
                          data-day={day}
                          tabIndex={day === focused ? 0 : -1}
                          aria-label={`${formatLong(day)}, ${stateLabel(state)}${day === ctx.today ? `, ${t.calendar.today}` : ''}`}
                          aria-disabled={state === 'unavailable'}
                          onClick={() => {
                            setFocused(day)
                            select(day)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') return
                            onKeyDown(event, day)
                          }}
                          className={dayClass(state, day === ctx.today)}
                        >
                          {Number(day.slice(8))}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>

      <p role="status" aria-live="polite" className="mt-4 text-body-s text-ink">
        {liveText}
      </p>
    </div>
  )
}

// Mismo día del mes en otro mes (o el último día si no existe: 31 → 30).
function sameDayIn(day: Day, months: number): Day {
  const target = addMonths(day, months)
  const wanted = Number(day.slice(8))
  let result = target
  for (let i = 1; i < wanted; i++) {
    const next = addDays(target, i)
    if (next.slice(0, 7) !== target.slice(0, 7)) break
    result = next
  }
  return result
}

function stateLabel(state: DayState): string {
  switch (state) {
    case 'checkIn':
      return t.calendar.stateCheckIn
    case 'checkOut':
      return t.calendar.stateCheckOut
    case 'inRange':
      return t.calendar.stateInRange
    case 'checkoutOnly':
      return t.calendar.stateCheckoutOnly
    case 'available':
      return t.calendar.stateAvailable
    default:
      return t.calendar.stateUnavailable
  }
}

// No disponible: color unavailable Y tachado (el color nunca es la única señal).
function dayClass(state: DayState, isToday: boolean): string {
  const base = 'flex min-h-10 w-full items-center justify-center rounded-m border text-body-s'
  const today = isToday ? ' underline underline-offset-4' : ''
  switch (state) {
    case 'checkIn':
    case 'checkOut':
      return `${base} border-pacific bg-pacific text-surface${today}`
    case 'inRange':
      return `${base} border-pacific bg-sand-50 text-ink${today}`
    case 'checkoutOnly':
      return `${base} border-border-control bg-surface text-ink${today}`
    case 'available':
      return `${base} border-transparent text-ink hover:border-border-control hover:bg-sand-50${today}`
    default:
      return `${base} border-transparent bg-unavailable text-ink-muted line-through`
  }
}
