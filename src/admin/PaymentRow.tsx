import { useId, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { formatLong } from '../lib/dates/day'
import { formatCLP } from '../lib/money'
import { formatDeadline } from '../lib/payments'
import { Field, fieldClass, labelClass } from '../components/checkout/Field'
import { AlertIcon } from '../components/icons'
import { buttonPrimary, buttonSecondary } from '../components/ui'
import type { PaymentMethod, PaymentPlan, PaymentState } from '../types/public'
import { t } from '../lib/i18n'

// Fila de admin_payment_queue (solo admin).
export interface QueueItem {
  reservation_id: string
  code: string
  property_name: string
  check_in: string
  check_out: string
  guests: number
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  status: 'hold' | 'confirmada' | 'completada' | 'cancelada' | 'conflicto'
  payment_mode: 'gateway' | 'manual'
  payment_method: PaymentMethod | null
  payment_plan: PaymentPlan | null
  total_clp: number
  deposit_required_clp: number | null
  amount_paid: number
  balance_due: number
  balance_due_at: string | null
  hold_expires_at: string | null
  payment_state: PaymentState
  access_released: boolean
}

type Panel = 'none' | 'register' | 'release'

interface RpcResult {
  ok: boolean
  outcome?: string
  reason?: string
}

export function PaymentRow({ item, onDone }: { item: QueueItem; onDone: (message: string) => void }) {
  const [panel, setPanel] = useState<Panel>('none')
  const waiting = item.status === 'hold'
  const expired = item.payment_state === 'vencida' // calculado en el servidor

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-display text-heading-s text-ink">{item.code}</p>
        <p className="text-body-s text-ink-muted">{item.property_name}</p>
      </div>
      <p className="text-body text-ink">
        {formatLong(item.check_in)} → {formatLong(item.check_out)} · {t.booking.guestsShort(item.guests)}
      </p>
      <p className="text-body-s text-ink">
        {[item.contact_name, item.contact_phone, item.contact_email].filter(Boolean).join(' · ')}
      </p>
      <p className="text-body text-ink">
        {t.admin.amounts(formatCLP(item.amount_paid), formatCLP(item.total_clp), formatCLP(item.balance_due))}
      </p>
      <p className="text-body-s text-ink">
        {waiting && item.hold_expires_at &&
          (expired ? t.admin.expiredAt(formatDeadline(item.hold_expires_at)) : t.admin.expiresAt(formatDeadline(item.hold_expires_at)))}
        {waiting && item.deposit_required_clp !== null && ` · ${t.admin.depositMin(formatCLP(item.deposit_required_clp))}`}
        {!waiting && item.balance_due_at && t.admin.balanceDueAt(formatDeadline(item.balance_due_at))}
      </p>

      {item.payment_state !== 'reembolso_pendiente' && panel === 'none' && (
        <div className="flex flex-wrap gap-3">
          {item.balance_due > 0 && (
            <button type="button" className={buttonPrimary} onClick={() => setPanel('register')}>
              {t.admin.register}
            </button>
          )}
          {waiting && item.payment_mode === 'manual' && item.amount_paid === 0 && (
            <button type="button" className={buttonSecondary} onClick={() => setPanel('release')}>
              {t.admin.release}
            </button>
          )}
        </div>
      )}

      {panel === 'register' && <RegisterForm item={item} onClose={() => setPanel('none')} onDone={onDone} />}
      {panel === 'release' && <ReleaseConfirm item={item} onClose={() => setPanel('none')} onDone={onDone} />}
    </article>
  )
}

// Monto sugerido: el abono (o el total) si espera pago; el saldo si ya abonó.
function suggestedAmount(item: QueueItem): number {
  if (item.status !== 'hold') return item.balance_due
  return item.payment_plan === 'deposit' && item.deposit_required_clp ? item.deposit_required_clp : item.total_clp
}

function RegisterForm({ item, onClose, onDone }: { item: QueueItem; onClose: () => void; onDone: (m: string) => void }) {
  const id = useId()
  const [method, setMethod] = useState<'bank_transfer' | 'payment_link'>(item.payment_method === 'payment_link' ? 'payment_link' : 'bank_transfer')
  const [amount, setAmount] = useState(String(suggestedAmount(item)))
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSending(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('register_manual_payment', {
      p_reservation_id: item.reservation_id,
      p_method: method,
      p_amount_clp: Number(amount.replace(/\D/g, '')),
      p_reference: reference,
      p_note: note || null,
    })
    setSending(false)
    const result = data as RpcResult | null
    if (rpcError || !result) return setError(t.admin.errors.generic)
    if (result.outcome) return onDone(t.admin.outcomes[result.outcome] ?? t.admin.outcomes.payment_registered)
    setError(t.admin.errors[result.reason ?? ''] ?? t.admin.errors.generic)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-l border border-border-control bg-sand-50 p-4">
      <h4 className="text-title text-ink">{t.admin.form.heading(item.code)}</h4>
      <p role="note" className="flex items-start gap-2 rounded-l bg-dawn p-3 text-body-s text-ink">
        <AlertIcon size={20} className="shrink-0" />
        {t.admin.form.warning}
      </p>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-method`} className={labelClass}>
          {t.admin.form.method}
        </label>
        <select id={`${id}-method`} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}
          className={`${fieldClass} border-border-control`}>
          <option value="bank_transfer">{t.checkout.methods.bank_transfer.label}</option>
          <option value="payment_link">{t.checkout.methods.payment_link.label}</option>
        </select>
      </div>
      <Field id={`${id}-amount`} label={t.admin.form.amount} inputMode="numeric" required value={amount}
        onChange={(e) => setAmount(e.target.value)} />
      <Field id={`${id}-reference`} label={t.admin.form.reference} required maxLength={120} value={reference}
        onChange={(e) => setReference(e.target.value)} />
      <Field id={`${id}-note`} label={t.admin.form.note} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <p role="alert" className="text-body-s text-danger">
        {error}
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={buttonPrimary} disabled={sending} aria-busy={sending}>
          {sending ? t.admin.form.sending : t.admin.form.submit}
        </button>
        <button type="button" className={buttonSecondary} onClick={onClose}>
          {t.admin.form.cancel}
        </button>
      </div>
    </form>
  )
}

function ReleaseConfirm({ item, onClose, onDone }: { item: QueueItem; onClose: () => void; onDone: (m: string) => void }) {
  const id = useId()
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function release() {
    setSending(true)
    const { data, error: rpcError } = await supabase.rpc('release_manual_hold', { p_reservation_id: item.reservation_id, p_note: note || null })
    setSending(false)
    const result = data as RpcResult | null
    if (!rpcError && result?.ok) return onDone(t.admin.releaseDone)
    setError(t.admin.errors[result?.reason ?? ''] ?? t.admin.errors.generic)
  }

  return (
    <div className="flex flex-col gap-4 rounded-l border border-border-control bg-sand-50 p-4" role="group" aria-labelledby={`${id}-q`}>
      <p id={`${id}-q`} className="text-body text-ink">
        {t.admin.releaseConfirm(item.code)}
      </p>
      <Field id={`${id}-note`} label={t.admin.releaseNote} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <p role="alert" className="text-body-s text-danger">
        {error}
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={buttonPrimary} onClick={release} disabled={sending} aria-busy={sending}>
          {t.admin.release}
        </button>
        <button type="button" className={buttonSecondary} onClick={onClose}>
          {t.admin.form.cancel}
        </button>
      </div>
    </div>
  )
}
