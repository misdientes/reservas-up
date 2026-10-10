import { useId, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { diffDays, formatDayShort, parts, zonedNow } from '../../lib/dates/day'
import { buttonSecondary } from '../../components/ui'
import { errorMessage } from '../api'
import { Check, SaveBar } from '../ui'
import { parseClp, priceOk } from './rules'
import { suggestSeasons } from './holidays'
import { ea } from '../../lib/i18n/es-admin'

// Ayuda opcional: feriados de Chile del año (y del siguiente) como
// temporadas sugeridas de prioridad Alta. René elige y pone el precio;
// nada se crea sin su clic.
export function HolidaySuggest({ groupId, onDone, onClose }: { groupId: string; onDone: () => void; onClose: () => void }) {
  const id = useId()
  const [today] = useState(() => zonedNow(new Date()).day)
  const year = parts(today).year
  const suggestions = useMemo(() => suggestSeasons([year, year + 1], today), [year, today])
  const [picked, setPicked] = useState<Record<number, { on: boolean; price: string }>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const chosen = suggestions.map((s, i) => ({ s, i, ...(picked[i] ?? { on: false, price: '' }) })).filter((x) => x.on)

  async function create(event: FormEvent) {
    event.preventDefault()
    if (chosen.length === 0) return
    if (chosen.some((x) => !priceOk(parseClp(x.price)))) return setMessage({ ok: false, text: ea.holidays.needPrice })
    setSaving(true)
    let created = 0
    const failures: string[] = []
    for (const x of chosen) {
      const { error } = await supabase.from('rate_seasons').insert({
        rate_group_id: groupId, name: x.s.name.slice(0, 80), dates: `[${x.s.from},${x.s.to})`,
        nightly_gross_clp: parseClp(x.price), priority: 2,
      })
      if (error) failures.push(`${x.s.name}: ${errorMessage(error)}`)
      else created += 1
    }
    setSaving(false)
    if (failures.length) return setMessage({ ok: false, text: [ea.holidays.created(created), ...failures].join(' ') })
    onDone()
  }

  const h = ea.holidays
  return (
    <form onSubmit={create} noValidate className="flex flex-col gap-5 rounded-xl border border-border-control bg-sand-50 p-5">
      <h3 className="text-title text-ink">{h.heading(`${year}–${year + 1}`)}</h3>
      <p className="text-body-s text-ink-muted">{h.intro}</p>
      {suggestions.length === 0 && <p className="text-body-s text-ink-muted">{h.none}</p>}
      <ul className="flex flex-col gap-3">
        {suggestions.map((s, i) => {
          const state = picked[i] ?? { on: false, price: '' }
          const update = (patch: Partial<typeof state>) => setPicked((p) => ({ ...p, [i]: { ...state, ...patch } }))
          return (
            <li key={`${s.from}-${s.name}`} className="flex flex-col gap-2 border-t border-line pt-3">
              <Check label={`${s.name} · ${ea.seasons.nights(formatDayShort(s.from), formatDayShort(s.to), diffDays(s.from, s.to))}`}
                checked={state.on} onChange={(on) => update({ on })} />
              {state.on && (
                <div className="flex flex-col gap-2">
                  <label htmlFor={`${id}-${i}`} className="text-body-s text-ink">{h.price}</label>
                  <input id={`${id}-${i}`} inputMode="numeric" value={state.price} onChange={(e) => update({ price: e.target.value })}
                    className="min-h-10 w-full rounded-m border border-border-control bg-surface px-3 text-body text-ink sm:w-1/3" />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <SaveBar saving={saving} message={message} label={h.create(chosen.length)} />
      <button type="button" className={`${buttonSecondary} self-start`} onClick={onClose}>{h.close}</button>
    </form>
  )
}
