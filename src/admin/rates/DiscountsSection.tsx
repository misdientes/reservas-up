import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Field } from '../../components/checkout/Field'
import { buttonSecondary } from '../../components/ui'
import { errorMessage, type DiscountRow } from '../api'
import { SaveBar } from '../ui'
import { validateDiscount } from './rules'
import { ea } from '../../lib/i18n/es-admin'

// Tramos de descuento por estadía larga. El cálculo vive SOLO en
// pricing_core; aquí solo se guardan los tramos.
export function DiscountsSection({ groupId }: { groupId: string }) {
  const id = useId()
  const [rows, setRows] = useState<DiscountRow[] | null>(null)
  const [minNights, setMinNights] = useState('7')
  const [percent, setPercent] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('rate_long_stay_discounts').select('*').eq('rate_group_id', groupId).order('min_nights')
    setRows((data as DiscountRow[]) ?? [])
  }, [groupId])

  useEffect(() => {
    let cancelled = false
    supabase.from('rate_long_stay_discounts').select('*').eq('rate_group_id', groupId).order('min_nights')
      .then(({ data }) => !cancelled && setRows((data as DiscountRow[]) ?? []))
    return () => {
      cancelled = true
    }
  }, [groupId])

  async function add(event: FormEvent) {
    event.preventDefault()
    const e = validateDiscount(minNights, percent)
    setErrors(e)
    if (Object.keys(e).length) return setMessage({ ok: false, text: ea.discounts.error })
    setSaving(true)
    const { error } = await supabase.from('rate_long_stay_discounts')
      .insert({ rate_group_id: groupId, min_nights: Number(minNights), percent: Number(percent) })
    setSaving(false)
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    setPercent('')
    setMessage({ ok: true, text: ea.common.saved })
    void load()
  }

  async function remove(row: DiscountRow) {
    const { error } = await supabase.from('rate_long_stay_discounts').delete().eq('id', row.id)
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    void load()
  }

  const d = ea.discounts
  return (
    <div className="flex flex-col gap-5">
      <p className="text-body-s text-ink-muted">{d.intro}</p>
      {rows?.length === 0 && <p className="text-body-s text-ink-muted">{d.empty}</p>}
      <ul className="flex flex-col gap-2">
        {rows?.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2">
            <span className="text-body text-ink">{d.row(row.min_nights, row.percent)}</span>
            <button type="button" className={buttonSecondary} aria-label={d.removeLabel(row.min_nights, row.percent)} onClick={() => remove(row)}>
              {d.remove}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} noValidate className="flex flex-col gap-4">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={`${id}-n`} label={d.minNights} type="number" inputMode="numeric" min={2} max={365} value={minNights}
            onChange={(e) => setMinNights(e.target.value)} error={errors.minNights ? d.error : null} />
          <Field id={`${id}-p`} label={d.percent} type="number" inputMode="numeric" min={1} max={60} value={percent}
            onChange={(e) => setPercent(e.target.value)} error={errors.percent ? d.error : null} />
        </div>
        <SaveBar saving={saving} message={message} label={d.add} />
      </form>
    </div>
  )
}
