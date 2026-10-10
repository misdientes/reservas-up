import { useEffect, useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { errorMessage, isStale, type AccountSummary, type PropertyRow } from '../api'
import { Check, OverrideNumber, SaveBar, Select } from '../ui'
import { ea } from '../../lib/i18n/es-admin'

// Cobro: cuenta, medios y plazos. Cada ajuste puede "usar valor global"
// (null en la propiedad = valor de app_settings).
const METHODS = ['bank_transfer', 'payment_link', 'gateway'] as const

export function PaymentSection({ property, settings, onSaved, onReload }: {
  property: PropertyRow
  settings: Record<string, string>
  onSaved: (p: PropertyRow) => void
  onReload: () => void
}) {
  const id = useId()
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [v, setV] = useState({
    payment_account_id: property.payment_account_id ?? '',
    allowed_payment_methods: property.allowed_payment_methods,
    deposit_percent: property.deposit_percent,
    deposit_min_nights: property.deposit_min_nights,
    manual_payment_window_hours: property.manual_payment_window_hours,
    balance_due_hours_before_checkin: property.balance_due_hours_before_checkin,
    cancellation_free_days: property.cancellation_free_days,
    cancellation_refund_percent: property.cancellation_refund_percent,
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [stale, setStale] = useState(false)

  useEffect(() => {
    supabase.rpc('admin_payment_accounts').then(({ data }) => setAccounts((data as AccountSummary[]) ?? []))
  }, [])

  const set = <K extends keyof typeof v>(k: K) => (value: (typeof v)[K]) => setV((s) => ({ ...s, [k]: value }))
  const globalMethods = (settings.allowed_payment_methods ?? '').split(',').filter(Boolean)
  const methods = v.allowed_payment_methods ?? globalMethods

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const { data, error } = await supabase.from('properties')
      .update({ ...v, payment_account_id: v.payment_account_id || null, updated_at: property.updated_at })
      .eq('id', property.id).select('*').single()
    setSaving(false)
    setStale(isStale(error))
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    onSaved(data as PropertyRow)
    setMessage({ ok: true, text: ea.common.saved })
  }

  const p = ea.properties.payment
  const label = (m: string) => p.methodLabels[m] ?? m
  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <Select id={`${id}-acc`} label={p.account} value={v.payment_account_id} onChange={(e) => set('payment_account_id')(e.target.value)}>
        <option value="">{ea.common.none}</option>
        {accounts.filter((a) => a.is_active || a.id === v.payment_account_id).map((a) => (
          <option key={a.id} value={a.id}>{a.label}{a.account_number_masked ? ` (${a.account_number_masked})` : ''}</option>
        ))}
      </Select>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-label uppercase tracking-widest text-ink">{p.methods}</legend>
        <Check label={ea.common.useGlobal} checked={v.allowed_payment_methods === null}
          onChange={(g) => set('allowed_payment_methods')(g ? null : [...globalMethods])} />
        <p className="text-body-s text-ink-muted">{ea.common.globalValue(globalMethods.map(label).join(', '))}</p>
        {v.allowed_payment_methods !== null &&
          METHODS.map((m) => (
            <Check key={m} label={label(m)} checked={methods.includes(m)}
              onChange={(on) => set('allowed_payment_methods')(on ? [...methods, m] : methods.filter((x) => x !== m))} />
          ))}
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <OverrideNumber id={`${id}-dp`} label={p.depositPercent} value={v.deposit_percent} globalValue={settings.deposit_percent ?? '30'} min={0} max={100} onChange={set('deposit_percent')} />
        <OverrideNumber id={`${id}-dn`} label={p.depositMinNights} value={v.deposit_min_nights} globalValue={settings.deposit_min_nights ?? '1'} min={0} max={30} onChange={set('deposit_min_nights')} />
        <OverrideNumber id={`${id}-w`} label={p.window} value={v.manual_payment_window_hours} globalValue={settings.manual_payment_window_hours ?? '12'} min={1} max={72} onChange={set('manual_payment_window_hours')} />
        <OverrideNumber id={`${id}-b`} label={p.balanceHours} value={v.balance_due_hours_before_checkin} globalValue={settings.balance_due_hours_before_checkin ?? '48'} min={0} max={720} onChange={set('balance_due_hours_before_checkin')} />
        <OverrideNumber id={`${id}-cd`} label={p.cancelDays} value={v.cancellation_free_days} globalValue={settings.cancellation_free_days ?? '5'} min={0} max={365} onChange={set('cancellation_free_days')} />
        <OverrideNumber id={`${id}-cp`} label={p.cancelPercent} value={v.cancellation_refund_percent} globalValue={settings.cancellation_refund_percent ?? '100'} min={0} max={100} onChange={set('cancellation_refund_percent')} />
      </div>
      <SaveBar saving={saving} message={message} stale={stale} onReload={onReload} />
    </form>
  )
}
