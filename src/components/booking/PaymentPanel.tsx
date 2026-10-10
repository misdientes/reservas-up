import { useState } from 'react'
import { payOnline } from '../../lib/api/booking'
import { formatCLP } from '../../lib/money'
import { formatDeadline, whatsappMessageUrl } from '../../lib/payments'
import { useSiteData } from '../../lib/site-data-context'
import type { BankDetails, PublicBookingStatus } from '../../types/public'
import { ChatIcon } from '../icons'
import { buttonPrimary, buttonSecondary } from '../ui'
import { t } from '../../lib/i18n'

// Instrucciones de pago manual para quien tiene el enlace de la reserva:
// monto, plazo, el código CORTO para el comentario de la transferencia
// (nunca el código secreto del enlace), datos bancarios y WhatsApp prellenado.
export function PaymentPanel({ booking }: { booking: PublicBookingStatus }) {
  const { settings } = useSiteData()
  const payment = booking.payment
  if (!payment) return null

  const amount = formatCLP(payment.pay_now_clp)
  const manual = payment.mode === 'manual'
  const waiting = booking.status === 'esperando_pago'
  const balanceOpen = booking.status === 'confirmada' && payment.balance_clp > 0
  const online = Boolean(payment.can_pay_online)
  // Pasarela sin nada que mostrar salvo el botón (reintento de un hold o saldo).
  if (!online && (!manual || (!waiting && !balanceOpen))) return null
  if (!manual) {
    return (
      <section aria-labelledby="pay-title" className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
        <h2 id="pay-title" className="font-display text-heading-s text-ink">
          {t.bookingStatus.payHeading}
        </h2>
        <PayOnline publicCode={publicCodeFromUrl()} amount={amount} />
      </section>
    )
  }

  const whatsappText = balanceOpen
    ? t.bookingStatus.whatsappBalance(booking.code, amount)
    : payment.method === 'payment_link'
      ? t.bookingStatus.whatsappLink(booking.code, amount)
      : t.bookingStatus.whatsappReceipt(booking.code, amount)
  const whatsapp = whatsappMessageUrl(settings, whatsappText)
  const deadline = waiting ? payment.expires_at : payment.balance_due_at

  return (
    <section aria-labelledby="pay-title" className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-5">
      <h2 id="pay-title" className="font-display text-heading-s text-ink">
        {t.bookingStatus.payHeading}
      </h2>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-label uppercase tracking-widest text-earth">{t.bookingStatus.payNow}</dt>
          <dd className="mt-2 font-display text-heading-s text-ink">{amount}</dd>
        </div>
        {deadline && (
          <div>
            <dt className="text-label uppercase tracking-widest text-earth">{t.bookingStatus.payDeadline}</dt>
            <dd className="mt-2 text-body text-ink">{t.bookingStatus.payDeadlineValue(formatDeadline(deadline))}</dd>
          </div>
        )}
      </dl>

      {payment.state === 'saldo_vencido' && (
        <p className="text-body text-ink">{t.bookingStatus.balanceOverdue(formatCLP(payment.balance_clp))}</p>
      )}

      {payment.method === 'bank_transfer' && (
        <div className="flex flex-col gap-3 rounded-l bg-sand-50 p-4">
          <p className="text-body-s text-ink">{t.bookingStatus.referenceLabel}</p>
          <CopyRow label={t.bookingStatus.referenceLabel} value={booking.code} large />
        </div>
      )}

      {payment.method === 'bank_transfer' && payment.bank && <BankData bank={payment.bank} />}

      {online && <PayOnline publicCode={publicCodeFromUrl()} amount={amount} />}

      {whatsapp && (
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${online ? buttonSecondary : buttonPrimary} self-start`}>
          <ChatIcon size={20} />
          {balanceOpen ? t.bookingStatus.payBalance : payment.method === 'payment_link' ? t.bookingStatus.askLink : t.bookingStatus.sendReceipt}
        </a>
      )}
    </section>
  )
}

// El código secreto viene en la URL (/reserva/:code): nunca en la respuesta.
function publicCodeFromUrl(): string {
  return window.location.pathname.split('/').filter(Boolean).at(-1) ?? ''
}

// Pago con tarjeta (pay-online). Al volver de la pasarela, la página se
// actualiza sola: el aviso del proveedor es lo único que confirma.
function PayOnline({ publicCode, amount }: { publicCode: string; amount: string }) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function start() {
    setSending(true)
    setError(null)
    try {
      const result = await payOnline(publicCode)
      if (result.ok && result.payment_url) {
        window.location.assign(result.payment_url)
        return
      }
      setError(t.bookingStatus.payOnlineErrors[result.reason ?? ''] ?? t.bookingStatus.payOnlineErrors.generic)
    } catch {
      setError(t.bookingStatus.payOnlineErrors.generic)
    }
    setSending(false)
  }
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={start} disabled={sending} aria-busy={sending} className={`${buttonPrimary} self-start`}>
        {sending ? t.bookingStatus.payOnlineSending : t.bookingStatus.payOnline(amount)}
      </button>
      <p className="text-body-s text-ink-muted">{t.bookingStatus.payOnlineHint}</p>
      <p role="alert" className="text-body-s text-danger">
        {error}
      </p>
    </div>
  )
}

function BankData({ bank }: { bank: BankDetails }) {
  const fields = (['bank_name', 'account_type', 'account_number', 'holder_name', 'holder_rut', 'holder_email'] as const).filter(
    (key) => bank[key],
  )
  return (
    <div>
      <h3 className="text-title text-ink">{t.bookingStatus.bankHeading}</h3>
      <dl className="mt-3 flex flex-col gap-3">
        {fields.map((key) => (
          <div key={key} className="border-t border-line pt-3">
            <dt className="text-label uppercase tracking-widest text-earth">{t.bookingStatus.bank[key]}</dt>
            <dd className="mt-2">
              <CopyRow label={t.bookingStatus.bank[key]} value={bank[key] ?? ''} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function CopyRow({ label, value, large = false }: { label: string; value: string; large?: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      // Sin portapapeles: el dato queda visible para copiarlo a mano.
    }
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={large ? 'font-display text-heading-s text-ink' : 'text-body text-ink break-all'}>{value}</span>
      <button type="button" onClick={copy} className={`${buttonSecondary} shrink-0 px-5`}>
        <span aria-live="polite">{copied ? t.bookingStatus.copied : t.bookingStatus.copy}</span>
        <span className="sr-only"> {label}</span>
      </button>
    </div>
  )
}
