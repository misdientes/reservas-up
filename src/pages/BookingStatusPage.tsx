import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { fetchBookingStatus } from '../lib/api/public'
import { useDocumentMeta } from '../lib/document-meta'
import { useSiteData } from '../lib/site-data-context'
import { formatLong } from '../lib/dates/day'
import { formatCLP } from '../lib/money'
import { whatsappUrl } from '../lib/whatsapp'
import { AlertIcon, CheckIcon } from '../components/icons'
import { PaymentPanel } from '../components/booking/PaymentPanel'
import { formatDeadline } from '../lib/payments'
import { buttonSecondary, container, textLink } from '../components/ui'
import type { PublicBookingStatus } from '../types/public'
import { t } from '../lib/i18n'

// /reserva/:code — estado de la reserva con el código largo (128 bits).
// Sin email ni teléfono. Mientras el pago se procesa, consulta cada 3 s por
// hasta ~2 minutos; la confirmación la decide SOLO el webhook del proveedor.
// Esperando un pago manual, consulta cada minuto (el admin lo registra al
// ver el dinero en el banco).

const POLL_MS = 3000
const MAX_POLLS = 40
const MANUAL_POLL_MS = 60000

type State = { status: 'loading' } | { status: 'notFound' } | { status: 'ok'; booking: PublicBookingStatus; polls: number }

export function BookingStatusPage() {
  const { code = '' } = useParams()
  const { settings } = useSiteData()
  const [state, setState] = useState<State>({ status: 'loading' })

  useDocumentMeta(`${t.bookingStatus.metaTitle} · ${t.meta.legalTitle}`)

  const polls = state.status === 'ok' ? state.polls : 0
  const processing = state.status === 'loading' || (state.status === 'ok' && state.booking.status === 'procesando')
  const waitingManual = state.status === 'ok' && state.booking.status === 'esperando_pago' && state.booking.payment?.state === 'esperando_pago'
  // Volviendo de la pasarela (TUU agrega x_* a la URL): se consulta unos
  // minutos hasta que llegue el aviso del proveedor, que es lo que confirma.
  const [returningFromGateway] = useState(() => new URLSearchParams(window.location.search).has('x_reference'))
  const keepPolling = ((processing || returningFromGateway) && polls < MAX_POLLS) || waitingManual

  useEffect(() => {
    if (!keepPolling) return
    let cancelled = false
    const timer = window.setTimeout(
      () => {
        fetchBookingStatus(code)
          .then((booking) => {
            if (cancelled) return
            setState(booking ? { status: 'ok', booking, polls: polls + 1 } : { status: 'notFound' })
          })
          .catch(() => {
            // Un error de red cuenta como un intento más (no rompe la página).
            if (!cancelled) setState((s) => (s.status === 'ok' ? { ...s, polls: s.polls + 1 } : { status: 'notFound' }))
          })
      },
      state.status === 'loading' ? 0 : waitingManual ? MANUAL_POLL_MS : POLL_MS,
    )
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [code, keepPolling, polls, state.status, waitingManual])

  const whatsapp = whatsappUrl(settings, state.status === 'ok' ? t.bookingStatus.whatsappCode(state.booking.code) : undefined)

  if (state.status === 'loading') {
    return (
      <section className={`${container} min-h-screen py-10`}>
        <p role="status" className="text-body text-ink-muted">
          {t.bookingStatus.loading}
        </p>
      </section>
    )
  }

  if (state.status === 'notFound') {
    return (
      <section className={`${container} py-10`}>
        <h1 className="font-display text-heading text-ink">{t.bookingStatus.metaTitle}</h1>
        <p className="mt-3 text-body text-ink">{t.bookingStatus.notFound}</p>
        <Link to="/" className={`${textLink} mt-5 inline-flex min-h-10 items-center`}>
          {t.legal.backHome}
        </Link>
      </section>
    )
  }

  const { booking } = state
  const kind = booking.status
  const confirmed = kind === 'confirmada'
  const timedOut = kind === 'procesando' && !keepPolling
  const payment = booking.payment
  const expired = kind === 'esperando_pago' && payment?.state === 'vencida'
  const statusText = timedOut ? t.bookingStatus.stillProcessing : expired ? t.bookingStatus.expired : t.bookingStatus.texts[kind]
  // Abono recibido: saldo y su fecha; pagada completa: confirmación.
  const balanceText =
    confirmed && payment && payment.mode === 'manual'
      ? payment.balance_clp > 0 && payment.state !== 'saldo_vencido' && payment.balance_due_at
        ? t.bookingStatus.balanceDue(formatCLP(payment.balance_clp), formatDeadline(payment.balance_due_at))
        : payment.balance_clp === 0
          ? t.bookingStatus.fullyPaid
          : null
      : null

  return (
    <section className={`${container} py-10`}>
      <div className="mx-auto flex max-w-prose flex-col gap-7">
        <div aria-live="polite" className="flex flex-col gap-3">
          <span
            className={`inline-flex size-10 items-center justify-center rounded-pill ${confirmed ? 'bg-pacific text-surface' : 'bg-sand-100 text-earth'}`}
          >
            {confirmed ? <CheckIcon size={24} /> : <AlertIcon size={24} />}
          </span>
          <h1 className="font-display text-heading text-ink">{t.bookingStatus.titles[kind]}</h1>
          <p className="text-body text-ink">{statusText}</p>
          {balanceText && <p className="text-body text-ink">{balanceText}</p>}
        </div>

        <dl className="grid gap-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2">
          <Item term={t.bookingStatus.code} value={booking.code} />
          <Item term={t.checkout.stayHeading} value={booking.property_name} />
          <Item term={t.checkout.checkIn} value={formatLong(booking.check_in)} />
          <Item term={t.checkout.checkOut} value={formatLong(booking.check_out)} />
          <Item term={t.checkout.guests} value={t.booking.guestsShort(booking.guests)} />
          <Item term={confirmed && payment?.balance_clp === 0 ? t.bookingStatus.total : t.bookingStatus.totalPending} value={formatCLP(booking.total_clp)} />
          {payment && payment.amount_paid > 0 && payment.balance_clp > 0 && (
            <Item term={t.bookingStatus.paid} value={formatCLP(payment.amount_paid)} />
          )}
        </dl>

        {!expired && <PaymentPanel booking={booking} />}

        {confirmed && (
          <div>
            <h2 className="font-display text-heading-s text-ink">{t.bookingStatus.nextStepsHeading}</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {t.bookingStatus.nextSteps.map((step) => (
                <li key={step} className="flex items-start gap-2 text-body text-ink">
                  <CheckIcon size={20} className="mt-2 shrink-0 text-pacific" />
                  {step}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-4">
          {kind === 'no_completada' && (
            <Link to={`/propiedades/${booking.property_slug}`} className={buttonSecondary}>
              {t.bookingStatus.retry}
            </Link>
          )}
          {whatsapp && (
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${textLink} inline-flex min-h-10 items-center`}>
              {t.checkout.whatsappHelp}
            </a>
          )}
        </div>
      </div>
    </section>
  )
}

function Item({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-label uppercase tracking-widest text-earth">{term}</dt>
      <dd className="mt-2 text-body text-ink">{value}</dd>
    </div>
  )
}
