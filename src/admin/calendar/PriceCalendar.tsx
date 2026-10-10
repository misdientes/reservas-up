import { useState } from 'react'
import { formatCLP } from '../../lib/money'
import { addMonths, compareDays, formatDayShort, formatLong, formatMonthYear, isoWeekday, monthGrid, parts, startOfMonth, WEEKDAYS_SHORT, type Day } from '../../lib/dates/day'
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons'
import type { CalendarDayRow } from '../api'
import { ea } from '../../lib/i18n/es-admin'

// Vista mensual: en escritorio una cuadrícula (lunes a domingo); en el
// celular una lista por semanas. Solo muestra lo que entrega la base.

const STATE_CLASS: Record<string, string> = {
  free: 'bg-surface text-ink',
  reservation: 'bg-pacific text-surface',
  hold: 'bg-dawn text-ink',
  manual_block: 'bg-unavailable text-ink',
  ical_block: 'bg-earth text-surface',
}

const stateOf = (d: CalendarDayRow | undefined) => d?.occupancy_kind ?? 'free'

export function PriceCalendar({ days, today, lastMonth }: { days: CalendarDayRow[]; today: Day; lastMonth: Day }) {
  const [month, setMonth] = useState(() => startOfMonth(today))
  const byDay = new Map(days.map((d) => [d.day, d]))
  const weeks = monthGrid(month)
  const c = ea.calendar
  const label = (day: Day, d: CalendarDayRow | undefined) =>
    c.dayLabel(formatLong(day), d?.price_clp != null ? formatCLP(d.price_clp) : '—', c.states[stateOf(d)], d?.season_name ?? null)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="inline-flex size-10 items-center justify-center rounded-pill border border-border-control text-ink disabled:opacity-50"
          aria-label={c.prev} disabled={compareDays(month, startOfMonth(today)) <= 0} onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeftIcon size={20} />
        </button>
        <h3 className="text-title text-ink first-letter:uppercase" aria-live="polite">{formatMonthYear(month)}</h3>
        <button type="button" className="inline-flex size-10 items-center justify-center rounded-pill border border-border-control text-ink disabled:opacity-50"
          aria-label={c.next} disabled={compareDays(month, lastMonth) >= 0} onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRightIcon size={20} />
        </button>
      </div>

      <ul className="flex flex-wrap gap-3" aria-label={c.intro}>
        {Object.entries(c.states).map(([key, text]) => (
          <li key={key} className="flex items-center gap-2 text-body-s text-ink">
            <span aria-hidden="true" className={`size-4 rounded-s border border-line ${STATE_CLASS[key]}`} />
            {text}
          </li>
        ))}
      </ul>

      {/* Escritorio: cuadrícula del mes. */}
      <table className="hidden w-full table-fixed border-collapse md:table">
        <thead>
          <tr>
            {WEEKDAYS_SHORT.map((w, i) => (
              <th key={w} scope="col" className="pb-2 text-label uppercase tracking-widest text-ink-muted">
                <abbr title={ea.weekdays[i]} className="no-underline">{w}</abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((day, di) => {
                const d = day ? byDay.get(day) : undefined
                return (
                  <td key={di} className="border border-line p-0 align-top">
                    {day && (
                      <div aria-label={label(day, d)} role="group"
                        className={`flex min-h-10 flex-col gap-0 p-2 ${d ? STATE_CLASS[stateOf(d)] : 'bg-sand-50 text-ink-muted'}`}>
                        <span className="text-body-s">{parts(day).day}</span>
                        {d && (
                          <>
                            <span className="text-title">{d.price_clp != null ? formatCLP(d.price_clp) : '—'}</span>
                            {d.season_name && <span className="truncate text-label">{d.season_name}</span>}
                            {d.min_nights && d.min_nights > 1 && <span className="text-label">{c.minNights(d.min_nights)}</span>}
                          </>
                        )}
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Celular: lista por semanas. */}
      <div className="flex flex-col gap-4 md:hidden">
        {weeks.map((week, wi) => {
          const inMonth = week.filter((x): x is Day => x !== null && byDay.has(x))
          if (inMonth.length === 0) return null
          return (
            <section key={wi} className="flex flex-col gap-2">
              <h4 className="text-label uppercase tracking-widest text-earth">{c.week(formatDayShort(inMonth[0]))}</h4>
              <ul className="flex flex-col gap-2">
                {inMonth.map((day) => {
                  const d = byDay.get(day)!
                  return (
                    <li key={day} className={`flex min-h-10 items-center justify-between gap-3 rounded-m border border-line px-3 py-2 ${STATE_CLASS[stateOf(d)]}`}>
                      <span className="text-body-s">
                        {WEEKDAYS_SHORT[isoWeekday(day) - 1]} {parts(day).day}
                        {d.season_name ? ` · ${d.season_name}` : ''}
                        {d.min_nights && d.min_nights > 1 ? ` · ${c.minNights(d.min_nights)}` : ''}
                      </span>
                      <span className="text-title">
                        {d.price_clp != null ? formatCLP(d.price_clp) : '—'} · {c.states[stateOf(d)]}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
