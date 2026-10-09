import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { formatLong } from '../lib/dates/day'
import { formatDeadline } from '../lib/payments'
import { Field } from '../components/checkout/Field'
import { buttonSecondary } from '../components/ui'
import { t } from '../lib/i18n'

// Próximas llegadas (admin_upcoming_arrivals): el admin carga el código de
// acceso de cada reserva mientras no haya cerradura integrada. Si las
// instrucciones de llegada ya salieron, el código se envía en otro correo.

interface Arrival {
  reservation_id: string
  code: string
  property_name: string
  check_in: string
  check_out: string
  guests: number
  contact_name: string | null
  access_released: boolean
  access_code: string | null
  arrival_email_status: string | null
  arrival_email_send_after: string | null
}

export function UpcomingArrivals() {
  const [items, setItems] = useState<Arrival[] | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('admin_upcoming_arrivals', { p_days: 14 })
    if (rpcError) setError(true)
    else setItems(data as Arrival[])
  }, [])

  useEffect(() => {
    let cancelled = false
    supabase.rpc('admin_upcoming_arrivals', { p_days: 14 }).then(({ data, error: rpcError }) => {
      if (cancelled) return
      if (rpcError) setError(true)
      else setItems(data as Arrival[])
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section aria-labelledby="llegadas" className="mt-10 flex flex-col gap-4">
      <h2 id="llegadas" className="font-display text-heading-s text-ink">
        {t.admin.arrivals.heading}
      </h2>
      {error && <p role="alert" className="text-body text-ink">{t.admin.loadError}</p>}
      {items && items.length === 0 && <p className="text-body text-ink-muted">{t.admin.arrivals.empty}</p>}
      <ul className="flex flex-col gap-4">
        {items?.map((item) => (
          <li key={item.reservation_id}>
            <ArrivalRow item={item} onSaved={load} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function emailStatus(item: Arrival): string {
  if (!item.access_released) return t.admin.arrivals.notPaid
  if (item.arrival_email_status === 'enviado') return t.admin.arrivals.emailSent
  if (item.arrival_email_send_after) return t.admin.arrivals.emailScheduled(formatDeadline(item.arrival_email_send_after))
  return t.admin.arrivals.emailPending
}

function ArrivalRow({ item, onSaved }: { item: Arrival; onSaved: () => void }) {
  const id = useId()
  const [code, setCode] = useState(item.access_code ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    setSending(true)
    const { data, error } = await supabase.rpc('set_reservation_access_code', { p_reservation_id: item.reservation_id, p_code: code })
    setSending(false)
    const ok = !error && (data as { ok?: boolean } | null)?.ok
    setMessage(ok ? t.admin.arrivals.saved : t.admin.errors.generic)
    if (ok) onSaved()
  }

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-display text-heading-s text-ink">{item.code}</p>
        <p className="text-body-s text-ink-muted">{item.property_name}</p>
      </div>
      <p className="text-body text-ink">
        {formatLong(item.check_in)} → {formatLong(item.check_out)} · {t.booking.guestsShort(item.guests)}
        {item.contact_name ? ` · ${item.contact_name}` : ''}
      </p>
      <p className="text-body-s text-ink">{emailStatus(item)}</p>
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <Field id={`${id}-code`} label={t.admin.arrivals.codeLabel} maxLength={40} required value={code}
          onChange={(e) => setCode(e.target.value)} className="min-w-0 flex-1" />
        <button type="submit" className={buttonSecondary} disabled={sending || !code.trim()} aria-busy={sending}>
          {t.admin.arrivals.save}
        </button>
      </form>
      <p role="status" aria-live="polite" className="text-body-s text-ink">
        {message}
      </p>
    </article>
  )
}
