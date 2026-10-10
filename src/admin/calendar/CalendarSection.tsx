import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { addDays, addMonths, startOfMonth, zonedNow } from '../../lib/dates/day'
import type { CalendarDayRow, PropertyRow } from '../api'
import { PriceCalendar } from './PriceCalendar'
import { BlocksPanel } from './BlocksPanel'
import { IcalPanel } from './IcalPanel'
import { ea } from '../../lib/i18n/es-admin'

// Calendario de la propiedad (Sesión 13): precio de cada noche (night_price),
// mínimo de llegada (effective_min_nights) y ocupación (active_occupancies),
// todo desde admin_price_calendar: el panel no recalcula nada.
export function CalendarSection({ property }: { property: PropertyRow }) {
  const [today] = useState(() => zonedNow(new Date()).day)
  const [days, setDays] = useState<CalendarDayRow[] | null>(null)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let cancelled = false
    // 12 meses completos desde el mes actual (≤ 400 días).
    const to = addMonths(startOfMonth(today), 12)
    supabase.rpc('admin_price_calendar', { p_property_id: property.id, p_from: today, p_to: to }).then(({ data }) => {
      if (!cancelled) setDays((data as CalendarDayRow[]) ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [property.id, today, version])

  return (
    <div className="flex flex-col gap-7">
      <p className="text-body-s text-ink-muted">{ea.calendar.intro}</p>
      {!property.rate_group_id && <p className="text-body-s text-ink">{ea.calendar.noRate}</p>}
      {days === null ? (
        <p className="text-body-s text-ink-muted">{ea.common.loading}</p>
      ) : (
        <PriceCalendar days={days} today={today} lastMonth={addMonths(startOfMonth(today), 11)} />
      )}
      <BlocksPanel propertyId={property.id} days={days ?? []} minDay={today} maxDay={addDays(today, 547)} onChanged={reload} />
      <IcalPanel propertyId={property.id} onSynced={reload} />
    </div>
  )
}
