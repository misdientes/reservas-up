import { useEffect, useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { formatCLP } from '../../lib/money'
import { addDays, zonedNow } from '../../lib/dates/day'
import { quoteLines, reasonMessage, type Quote } from '../../lib/pricing'
import { Field } from '../../components/checkout/Field'
import { errorMessage } from '../api'
import { SaveBar, Select } from '../ui'
import { t } from '../../lib/i18n'
import { ea } from '../../lib/i18n/es-admin'

// Simulador (Sesión 13): admin_quote devuelve la MISMA forma pública que
// quote_stay (public_quote_shape sobre pricing_core) y se muestra con las
// mismas líneas que la ficha (quoteLines). Aparte, solo para el admin, el
// plan de pago y el desglose interno.

interface AdminQuote {
  public: Quote
  plan?: { deposit_clp: number; balance_clp: number; requires_full: boolean }
  internal?: { tax_status: string; net_clp?: number; vat_clp?: number; avaluo_rebate_base_clp?: number }
}

export function SimulatorPage() {
  const id = useId()
  const [today] = useState(() => zonedNow(new Date()).day)
  const [props, setProps] = useState<{ id: string; name: string; min_advance_hours: number; max_guests: number | null }[]>([])
  const [propertyId, setPropertyId] = useState('')
  const [checkIn, setCheckIn] = useState(addDays(today, 7))
  const [checkOut, setCheckOut] = useState(addDays(today, 10))
  const [guests, setGuests] = useState('2')
  const [result, setResult] = useState<AdminQuote | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    supabase.from('properties').select('id, name, min_advance_hours, max_guests').order('name').then(({ data }) => {
      setProps(data ?? [])
      if (data?.length) setPropertyId(data[0].id)
    })
  }, [])

  async function run(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const { data, error } = await supabase.rpc('admin_quote', {
      p_property_id: propertyId, p_check_in: checkIn, p_check_out: checkOut, p_guests: Number(guests),
    })
    setSaving(false)
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    setMessage(null)
    setResult(data as AdminQuote)
  }

  const s = ea.simulator
  const prop = props.find((p) => p.id === propertyId)
  const quote = result?.public
  return (
    <div className="mt-7 flex flex-col gap-5">
      <h2 className="font-display text-heading-s text-ink">{s.heading}</h2>
      <p className="text-body-s text-ink-muted">{s.intro}</p>
      <form onSubmit={run} noValidate className="flex flex-col gap-5">
        <Select id={`${id}-p`} label={s.property} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
          {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field id={`${id}-in`} label={s.checkIn} type="date" min={today} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
          <Field id={`${id}-out`} label={s.checkOut} type="date" min={checkIn} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          <Field id={`${id}-g`} label={s.guests} type="number" inputMode="numeric" min={1} max={30} value={guests} onChange={(e) => setGuests(e.target.value)} />
        </div>
        <SaveBar saving={saving} message={message} label={s.run} />
      </form>

      {quote && (
        <div className="grid gap-5 md:grid-cols-2">
          <section aria-labelledby={`${id}-g-h`} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
            <h3 id={`${id}-g-h`} className="text-label uppercase tracking-widest text-earth">{s.guestView}</h3>
            {quote.quotable ? (
              <>
                <ul className="flex flex-col gap-2">
                  {quoteLines(quote).map((line) => (
                    <li key={line.label} className="flex justify-between gap-3 text-body text-ink">
                      <span>{line.label}</span>
                      <span>{line.amount}</span>
                    </li>
                  ))}
                </ul>
                <p className="flex justify-between gap-3 border-t border-line pt-3 text-title text-ink">
                  <span>{t.price.total}</span>
                  <span>{formatCLP(quote.total_clp ?? 0)}</span>
                </p>
              </>
            ) : (
              <p className="text-body text-ink">
                {s.notQuotable} {reasonMessage(quote.reason, { minNights: quote.min_nights, maxGuests: prop?.max_guests, advanceHours: prop?.min_advance_hours })}
              </p>
            )}
          </section>
          {result.plan && result.internal && (
            <section aria-labelledby={`${id}-a-h`} className="flex flex-col gap-3 rounded-xl border border-border-control bg-sand-50 p-5">
              <h3 id={`${id}-a-h`} className="text-label uppercase tracking-widest text-earth">{s.adminView}</h3>
              <dl className="flex flex-col gap-2 text-body text-ink">
                <Row label={s.deposit} value={formatCLP(result.plan.deposit_clp)} />
                <Row label={s.balance} value={formatCLP(result.plan.balance_clp)} />
                {result.internal.tax_status === 'ok' && (
                  <>
                    <Row label={s.net} value={formatCLP(result.internal.net_clp ?? 0)} />
                    <Row label={s.vat} value={formatCLP(result.internal.vat_clp ?? 0)} />
                    {!!result.internal.avaluo_rebate_base_clp && <Row label={s.rebate} value={formatCLP(result.internal.avaluo_rebate_base_clp)} />}
                  </>
                )}
              </dl>
              {result.plan.requires_full && <p className="text-body-s text-ink">{s.requiresFull}</p>}
              {result.internal.tax_status === 'pending' && <p className="text-body-s text-ink">{s.taxPending}</p>}
              {result.internal.tax_status === 'exempt' && <p className="text-body-s text-ink">{s.taxExempt}</p>}
              {result.internal.tax_status === 'mode_not_implemented' && <p className="text-body-s text-ink">{s.taxNotImplemented}</p>}
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
