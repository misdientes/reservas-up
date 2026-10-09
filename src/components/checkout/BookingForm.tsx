import { useId, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { validateBookingRequest } from '../../../supabase/functions/_shared/booking-input.ts'
import { createBooking } from '../../lib/api/booking'
import { quotePaymentPlan, quoteStay } from '../../lib/api/public'
import { formatCLP } from '../../lib/money'
import { reasonMessage, type Quote, type QuoteReason } from '../../lib/pricing'
import type { Day } from '../../lib/dates/day'
import { Field, FieldError, labelClass } from './Field'
import { Turnstile } from './Turnstile'
import { PaymentOptions } from './PaymentOptions'
import { depositAvailable } from '../../lib/payments'
import type { PaymentMethod, PaymentPlan, PaymentPlanQuote } from '../../types/public'
import { AlertIcon, LockIcon } from '../icons'
import { buttonPrimary, textLink } from '../ui'
import { t } from '../../lib/i18n'

interface Props {
  slug: string
  stay: { checkIn: Day; checkOut: Day; guests: number }
  // Total mostrado (quote_stay): solo se envía para comparar con el del servidor.
  total: number
  whatsapp: string | null
  // Plan de pago del servidor (abono, saldo, plazos y medios permitidos).
  plan: PaymentPlanQuote
  onPriceChanged: (quote: Quote) => void
  onPlanChanged: (plan: PaymentPlanQuote) => void
}

const PRICING_REASONS: QuoteReason[] = ['invalid_dates', 'advance', 'max_guests', 'no_rate', 'min_nights']

// Orden de los campos para enfocar el primer error.
const FIELD_ORDER = ['name', 'email', 'phone', 'country', 'invoice.rut', 'invoice.business_name', 'invoice.activity', 'invoice.address', 'accept_terms']

export function BookingForm({ slug, stay, total, whatsapp, plan, onPriceChanged, onPlanChanged }: Props) {
  const base = useId()
  const navigate = useNavigate()
  const [method, setMethod] = useState<PaymentMethod>(plan.allowed_payment_methods?.[0] ?? 'bank_transfer')
  const [payPlanChoice, setPayPlan] = useState<PaymentPlan>('deposit')
  // Sin abono disponible (pasarela, llegada cercana) siempre es el total.
  const payPlan: PaymentPlan = depositAvailable(plan, method) ? payPlanChoice : 'full'
  const id = (field: string) => `${base}-${field.replace('.', '-')}`
  const [values, setValues] = useState({ name: '', email: '', phone: '', country: 'Chile' })
  const [invoice, setInvoice] = useState({ requested: false, rut: '', business_name: '', activity: '', address: '' })
  const [accepted, setAccepted] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [turnstileKey, setTurnstileKey] = useState(0)
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [notice, setNotice] = useState<{ text: string; whatsapp: boolean } | null>(null)
  const [sending, setSending] = useState(false)
  const noticeRef = useRef<HTMLDivElement>(null)

  const fieldError = (field: string) => {
    const code = errors[field]
    return code ? (t.checkout.fieldErrors[code] ?? t.checkout.fieldErrors.invalid) : null
  }

  const showErrors = (next: Partial<Record<string, string>>) => {
    setErrors(next)
    const first = FIELD_ORDER.find((field) => next[field])
    if (first) document.getElementById(id(first))?.focus()
  }

  const showNotice = (text: string, withWhatsapp = false) => {
    setNotice({ text, whatsapp: withWhatsapp })
    // El aviso se anuncia (role=alert) y se lleva a la vista.
    window.requestAnimationFrame(() => noticeRef.current?.focus())
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending) return
    setNotice(null)

    const request = {
      slug,
      check_in: stay.checkIn,
      check_out: stay.checkOut,
      guests: stay.guests,
      ...values,
      invoice: invoice.requested ? invoice : { requested: false },
      accept_terms: accepted,
      payment_method: method,
      payment_plan: payPlan,
      turnstile_token: token ?? '',
      expected_total_clp: total,
    }
    // Mismas reglas que el servidor (booking-input.ts), para avisar antes.
    const validation = validateBookingRequest(request)
    if (!validation.ok) {
      const { turnstile_token: missingToken, ...fieldErrors } = validation.errors
      if (Object.keys(fieldErrors).length > 0) return showErrors(fieldErrors)
      if (missingToken) return showNotice(t.checkout.securityPending)
    }
    setErrors({})
    setSending(true)

    try {
      const response = await createBooking(validation.ok ? validation.value : request)
      if (response.ok) {
        // Pasarela: a la página del proveedor (la confirmación llega solo por el
        // webhook). Pago manual: a la página de la reserva con las instrucciones.
        if (response.payment_url) window.location.assign(response.payment_url)
        else navigate(`/reserva/${response.public_code}`)
        return
      }
      // Cada token de Turnstile sirve una vez: se pide uno nuevo.
      setTurnstileKey((n) => n + 1)
      setSending(false)

      if (response.reason === 'invalid' && response.errors) {
        const { turnstile_token: _ignored, ...fieldErrors } = response.errors
        return Object.keys(fieldErrors).length > 0 ? showErrors(fieldErrors) : showNotice(t.checkout.reasons.generic)
      }
      if (response.reason === 'price_changed' && typeof response.total_clp === 'number') {
        const [fresh, freshPlan] = await Promise.all([
          quoteStay(slug, stay.checkIn, stay.checkOut, stay.guests).catch(() => null),
          quotePaymentPlan(slug, stay.checkIn, stay.checkOut, stay.guests).catch(() => null),
        ])
        if (fresh?.quotable) onPriceChanged(fresh)
        if (freshPlan?.quotable) onPlanChanged(freshPlan)
        return showNotice(t.checkout.priceChanged(formatCLP(response.total_clp)))
      }
      if (response.reason === 'full_payment_required') {
        const freshPlan = await quotePaymentPlan(slug, stay.checkIn, stay.checkOut, stay.guests).catch(() => null)
        if (freshPlan?.quotable) onPlanChanged(freshPlan)
      }
      if (PRICING_REASONS.includes(response.reason as QuoteReason)) {
        return showNotice(reasonMessage(response.reason as QuoteReason, {}))
      }
      const text = t.checkout.reasons[response.reason] ?? t.checkout.reasons.generic
      showNotice(text, ['sync_stale', 'payments_unavailable', 'hold_limit', 'booking_disabled', 'payment_account_missing'].includes(response.reason))
    } catch (error) {
      console.warn('No se pudo crear la reserva', error)
      setTurnstileKey((n) => n + 1)
      setSending(false)
      showNotice(t.checkout.reasons.generic, true)
    }
  }

  const set = (field: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: e.target.value }))
  const setInv = (field: keyof Omit<typeof invoice, 'requested'>) => (e: { target: { value: string } }) =>
    setInvoice((v) => ({ ...v, [field]: e.target.value }))

  const acceptError = fieldError('accept_terms')

  return (
    <form noValidate onSubmit={submit} aria-labelledby={`${base}-title`} className="flex flex-col gap-7">
      <div>
        <h2 id={`${base}-title`} className="font-display text-heading-s text-ink">
          {t.checkout.formHeading}
        </h2>
        <p className="mt-2 text-body-s text-ink-muted">{t.checkout.formIntro}</p>
      </div>

      {Object.keys(errors).length > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-l border border-line bg-sand-50 p-4 text-body-s text-ink">
          <AlertIcon size={20} className="shrink-0 text-danger" />
          {t.checkout.errorSummary}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={id('name')} label={t.checkout.name} autoComplete="name" required maxLength={100}
          value={values.name} onChange={set('name')} error={fieldError('name')} className="sm:col-span-2" />
        <Field id={id('email')} label={t.checkout.email} type="email" autoComplete="email" inputMode="email" required
          maxLength={254} hint={t.checkout.emailHint} value={values.email} onChange={set('email')} error={fieldError('email')} />
        <Field id={id('phone')} label={t.checkout.phone} type="tel" autoComplete="tel" inputMode="tel" required
          maxLength={30} hint={t.checkout.phoneHint} value={values.phone} onChange={set('phone')} error={fieldError('phone')} />
        <Field id={id('country')} label={t.checkout.country} autoComplete="country-name" required maxLength={60}
          value={values.country} onChange={set('country')} error={fieldError('country')} />
      </div>

      <PaymentOptions plan={plan} method={method} payPlan={payPlan} onMethod={setMethod} onPayPlan={setPayPlan} />

      {/* Factura opcional */}
      <fieldset className="flex flex-col gap-5">
        <legend className="sr-only">{t.checkout.invoiceToggle}</legend>
        <label className="flex min-h-10 items-center gap-3 text-body text-ink">
          <input type="checkbox" className="size-5 accent-pacific" checked={invoice.requested}
            onChange={(e) => setInvoice((v) => ({ ...v, requested: e.target.checked }))} />
          {t.checkout.invoiceToggle}
        </label>
        {invoice.requested && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id={id('invoice.rut')} label={t.checkout.invoiceRut} hint={t.checkout.invoiceRutHint} required maxLength={12}
              value={invoice.rut} onChange={setInv('rut')} error={fieldError('invoice.rut')} />
            <Field id={id('invoice.business_name')} label={t.checkout.invoiceBusinessName} autoComplete="organization" required
              maxLength={150} value={invoice.business_name} onChange={setInv('business_name')} error={fieldError('invoice.business_name')} />
            <Field id={id('invoice.activity')} label={t.checkout.invoiceActivity} required maxLength={150}
              value={invoice.activity} onChange={setInv('activity')} error={fieldError('invoice.activity')} />
            <Field id={id('invoice.address')} label={t.checkout.invoiceAddress} autoComplete="street-address" required
              maxLength={200} value={invoice.address} onChange={setInv('address')} error={fieldError('invoice.address')} />
          </div>
        )}
      </fieldset>

      {/* Aceptación obligatoria (se guarda la versión de cada documento) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <input id={id('accept_terms')} type="checkbox" className="mt-1 size-5 shrink-0 accent-pacific" checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)} aria-invalid={acceptError ? true : undefined}
            aria-describedby={acceptError ? `${id('accept_terms')}-error` : undefined} />
          <label htmlFor={id('accept_terms')} className="text-body text-ink">
            {t.checkout.acceptPrefix}{' '}
            <Link to="/terminos" target="_blank" className={textLink}>{t.checkout.acceptTerms}</Link>,{' '}
            <Link to="/privacidad" target="_blank" className={textLink}>{t.checkout.acceptPrivacy}</Link>{' '}
            {t.checkout.acceptAnd}{' '}
            <Link to="/cancelaciones" target="_blank" className={textLink}>{t.checkout.acceptCancellation}</Link>.
          </label>
        </div>
        <FieldError id={`${id('accept_terms')}-error`} message={acceptError} />
      </div>

      <div className="flex flex-col gap-2">
        <span className={labelClass}>{t.checkout.security}</span>
        <Turnstile resetKey={turnstileKey} onToken={setToken} />
      </div>

      {notice && (
        <div ref={noticeRef} tabIndex={-1} role="alert" className="flex flex-col gap-3 rounded-l border border-line bg-sand-50 p-4 focus:outline-none">
          <p className="flex items-start gap-2 text-body text-ink">
            <AlertIcon size={20} className="mt-1 shrink-0 text-danger" />
            {notice.text}
          </p>
          {notice.whatsapp && whatsapp && (
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${textLink} inline-flex min-h-10 items-center`}>
              {t.checkout.whatsappHelp}
            </a>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <button type="submit" className={`${buttonPrimary} w-full sm:w-auto sm:self-start`} disabled={sending} aria-busy={sending}>
          <LockIcon size={20} />
          {sending
            ? t.checkout.paying
            : method === 'gateway'
              ? t.checkout.pay(formatCLP(total))
              : method === 'payment_link'
                ? t.checkout.reserveLink
                : t.checkout.reserveManual}
        </button>
        {method === 'gateway' && <p className="text-body-s text-ink-muted">{t.checkout.payNote}</p>}
      </div>
    </form>
  )
}
