import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { formatCLP } from '../../lib/money'
import { compareDays, diffDays, formatDayShort, zonedNow } from '../../lib/dates/day'
import { Field } from '../../components/checkout/Field'
import { buttonPrimary, buttonSecondary } from '../../components/ui'
import { errorMessage, isStale, parseRange, type SeasonRow } from '../api'
import { SaveBar, Select } from '../ui'
import { dowFromDb, dowToDb, parseClp, validateSeason, type SeasonValues } from './rules'
import { DowInputs } from './DowInputs'
import { HolidaySuggest } from './HolidaySuggest'
import { ea } from '../../lib/i18n/es-admin'

// Temporadas de una tarifa. La prioridad decide cuál manda si se cruzan;
// dos de la misma prioridad no pueden cruzarse (lo impide la base).

const today = () => zonedNow(new Date()).day

function fromRow(s: SeasonRow | null): SeasonValues {
  const range = s ? parseRange(s.dates) : { from: '', to: '' }
  return {
    name: s?.name ?? '',
    from: range.from,
    to: range.to,
    price: s ? String(s.nightly_gross_clp) : '',
    dow: dowFromDb(s?.dow_gross_clp ?? null),
    minNights: s?.min_nights ? String(s.min_nights) : '',
    priority: s ? String(s.priority) : '1',
  }
}

export function SeasonsSection({ groupId }: { groupId: string }) {
  const [rows, setRows] = useState<SeasonRow[] | null>(null)
  const [editing, setEditing] = useState<SeasonRow | 'new' | null>(null)
  const [suggesting, setSuggesting] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('rate_seasons').select('*').eq('rate_group_id', groupId)
    setRows(((data as SeasonRow[]) ?? []).sort((a, b) => compareDays(parseRange(a.dates).from, parseRange(b.dates).from)))
  }, [groupId])

  useEffect(() => {
    let cancelled = false
    supabase.from('rate_seasons').select('*').eq('rate_group_id', groupId).then(({ data }) => {
      if (!cancelled) setRows(((data as SeasonRow[]) ?? []).sort((a, b) => compareDays(parseRange(a.dates).from, parseRange(b.dates).from)))
    })
    return () => {
      cancelled = true
    }
  }, [groupId])

  const done = () => {
    setEditing(null)
    setSuggesting(false)
    void load()
  }

  const s = ea.seasons
  return (
    <div className="flex flex-col gap-5">
      <p className="text-body-s text-ink-muted">{s.intro}</p>
      {editing === null && !suggesting && (
        <div className="flex flex-wrap gap-3">
          <button type="button" className={buttonPrimary} onClick={() => setEditing('new')}>{s.new}</button>
          <button type="button" className={buttonSecondary} onClick={() => setSuggesting(true)}>{ea.holidays.open}</button>
        </div>
      )}
      {editing !== null && <SeasonForm groupId={groupId} season={editing === 'new' ? null : editing} onDone={done} onCancel={() => setEditing(null)} />}
      {suggesting && <HolidaySuggest groupId={groupId} onDone={done} onClose={() => setSuggesting(false)} />}
      {rows?.length === 0 && <p className="text-body-s text-ink-muted">{s.empty}</p>}
      <ul className="flex flex-col gap-3">
        {rows?.map((row) => {
          const { from, to } = parseRange(row.dates)
          const past = compareDays(to, today()) <= 0
          return (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
              <div className="min-w-0">
                <p className="text-title text-ink">
                  {row.name}{' '}
                  <span className="text-label uppercase tracking-widest text-earth">{s.priorities[String(row.priority)]}</span>
                  {past && <span className="text-label uppercase tracking-widest text-ink-muted"> · {s.past}</span>}
                </p>
                <p className="text-body-s text-ink">{s.nights(formatDayShort(from), formatDayShort(to), diffDays(from, to))}</p>
                <p className="text-body-s text-ink-muted">
                  {formatCLP(row.nightly_gross_clp)} {ea.rates.perNight}
                  {row.min_nights ? ` · ${ea.calendar.minNights(row.min_nights)}` : ''}
                </p>
              </div>
              <button type="button" className={buttonSecondary} onClick={() => setEditing(row)}>{ea.common.edit}</button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SeasonForm({ groupId, season, onDone, onCancel }: { groupId: string; season: SeasonRow | null; onDone: () => void; onCancel: () => void }) {
  const id = useId()
  const [v, setV] = useState<SeasonValues>(() => fromRow(season))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [stale, setStale] = useState(false)
  const set = (k: keyof SeasonValues) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))

  async function save(event: FormEvent) {
    event.preventDefault()
    const e = validateSeason(v)
    setErrors(e)
    if (Object.keys(e).length) return setMessage({ ok: false, text: e.from || e.to ? ea.seasons.dateError : ea.common.genericError })
    setSaving(true)
    const values = {
      name: v.name.trim(),
      dates: `[${v.from},${v.to})`,
      nightly_gross_clp: parseClp(v.price),
      dow_gross_clp: dowToDb(v.dow),
      min_nights: v.minNights.trim() === '' ? null : Number(v.minNights),
      priority: Number(v.priority),
    }
    const { error } = season
      ? await supabase.from('rate_seasons').update({ ...values, updated_at: season.updated_at }).eq('id', season.id)
      : await supabase.from('rate_seasons').insert({ ...values, rate_group_id: groupId })
    setSaving(false)
    setStale(isStale(error))
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    onDone()
  }

  async function remove() {
    if (!season || !window.confirm(ea.seasons.deleteConfirm)) return
    const { error } = await supabase.from('rate_seasons').delete().eq('id', season.id)
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    onDone()
  }

  const s = ea.seasons
  const err = (k: string) => (errors[k] ? (errors[k] === 'price' ? ea.rates.priceError : errors[k] === 'date' ? s.dateError : errors[k] === 'name' ? ea.rates.nameError : ea.rates.rangeError) : null)
  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-5 rounded-xl border border-border-control bg-sand-50 p-5">
      <Field id={`${id}-name`} label={s.name} required maxLength={80} value={v.name} onChange={set('name')} error={err('name')} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={`${id}-from`} label={s.from} type="date" required value={v.from} onChange={set('from')} error={err('from')} />
        <Field id={`${id}-to`} label={s.to} type="date" required value={v.to} onChange={set('to')} error={err('to')} />
        <Field id={`${id}-price`} label={s.price} hint={ea.rates.priceHint} required inputMode="numeric" value={v.price} onChange={set('price')} error={err('price')} />
        <Select id={`${id}-prio`} label={s.priority} hint={s.priorityHint} value={v.priority} onChange={set('priority')}>
          {Object.entries(s.priorities).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Field id={`${id}-min`} label={s.minNights} type="number" inputMode="numeric" min={1} max={60} value={v.minNights} onChange={set('minNights')} error={err('minNights')} />
      </div>
      <DowInputs idPrefix={`${id}-dow`} legend={ea.rates.dowHeading} hint={ea.rates.dowHint.replace('precio base', 'precio de la temporada')}
        values={v.dow} errors={errors} onChange={(dow) => setV((x) => ({ ...x, dow }))} />
      <SaveBar saving={saving} message={message} stale={stale} onReload={onDone} />
      <div className="flex flex-wrap gap-3">
        <button type="button" className={buttonSecondary} onClick={onCancel}>{ea.common.cancel}</button>
        {season && <button type="button" className={buttonSecondary} onClick={remove}>{ea.common.delete}</button>}
      </div>
    </form>
  )
}
