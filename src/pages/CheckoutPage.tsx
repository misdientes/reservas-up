import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { fetchPublicProperty, quotePaymentPlan, quoteStay } from '../lib/api/public'
import { useSiteData } from '../lib/site-data-context'
import { useDocumentMeta } from '../lib/document-meta'
import { isValidDay, zonedNow, type Day } from '../lib/dates/day'
import { cancellationInfo, cancellationText } from '../lib/cancellation'
import { reasonMessage, type Quote } from '../lib/pricing'
import { whatsappUrl } from '../lib/whatsapp'
import { MAX_GUESTS_OPTION, toSearchParams } from '../lib/search-params'
import { StaySummary } from '../components/checkout/StaySummary'
import { BookingForm } from '../components/checkout/BookingForm'
import { PropertyNotFound } from '../components/property/PropertyNotFound'
import { ArrowLeftIcon } from '../components/icons'
import { buttonSecondary, container, textLink } from '../components/ui'
import type { PaymentPlanQuote, PublicProperty } from '../types/public'
import { t } from '../lib/i18n'

// /reservar/:slug?llegada&salida&huespedes — resumen + datos mínimos + pago.
// El precio mostrado viene de quote_stay; el que se cobra lo decide el
// servidor (create-booking) y, si cambió, se avisa antes de cobrar.

type State =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'error' }
  | { status: 'ok'; property: PublicProperty; quote: Quote; plan: PaymentPlanQuote }

function readStay(params: URLSearchParams): { checkIn: Day; checkOut: Day; guests: number } | null {
  const checkIn = params.get('llegada')
  const checkOut = params.get('salida')
  const guests = Number(params.get('huespedes') ?? '1')
  if (!isValidDay(checkIn) || !isValidDay(checkOut) || checkOut <= checkIn) return null
  if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS_OPTION) return null
  return { checkIn, checkOut, guests }
}

export function CheckoutPage() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const { settings } = useSiteData()
  const stay = readStay(params)
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useDocumentMeta(`${t.checkout.metaTitle} · ${t.meta.legalTitle}`)

  const stayKey = stay ? `${stay.checkIn}|${stay.checkOut}|${stay.guests}` : null
  useEffect(() => {
    if (!stay) return
    let cancelled = false
    Promise.all([
      fetchPublicProperty(slug),
      quoteStay(slug, stay.checkIn, stay.checkOut, stay.guests),
      quotePaymentPlan(slug, stay.checkIn, stay.checkOut, stay.guests),
    ])
      .then(([detail, quote, plan]) => {
        if (cancelled) return
        setState(detail ? { status: 'ok', property: detail.property, quote, plan } : { status: 'notFound' })
      })
      .catch((error: unknown) => {
        console.warn('No se pudo preparar la reserva', error)
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
    // stayKey resume las fechas y huéspedes de la URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, stayKey, attempt])

  const propertyHref = `/propiedades/${slug}?${toSearchParams({
    llegada: stay?.checkIn ?? '',
    salida: stay?.checkOut ?? '',
    huespedes: stay?.guests ?? null,
  }).toString()}`
  const whatsapp = whatsappUrl(settings)

  if (state.status === 'notFound') return <PropertyNotFound />

  const message = (text: string, action?: { href: string; label: string }) => (
    <Shell backHref={propertyHref}>
      <div className="flex flex-col items-start gap-4 rounded-xl border border-line bg-sand-50 p-7" role="alert">
        <p className="text-body text-ink">{text}</p>
        {action && (
          <Link to={action.href} className={buttonSecondary}>
            {action.label}
          </Link>
        )}
        {whatsapp && (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${textLink} inline-flex min-h-10 items-center`}>
            {t.checkout.whatsappHelp}
          </a>
        )}
      </div>
    </Shell>
  )

  // Modo WhatsApp (producción hoy): no hay reservas en línea.
  if (settings && settings.bookingMode !== 'online') {
    return message(t.checkout.onlineDisabled, { href: propertyHref, label: t.checkout.back })
  }
  if (!stay) return message(t.checkout.missingDates, { href: `/propiedades/${slug}`, label: t.checkout.backToProperty })

  if (state.status === 'error') {
    return (
      <Shell backHref={propertyHref}>
        <div className="flex flex-col items-start gap-4 rounded-xl border border-line bg-sand-50 p-7" role="alert">
          <p className="text-body text-ink">{t.property.loadError}</p>
          <button type="button" className={buttonSecondary} onClick={() => setAttempt((n) => n + 1)}>
            {t.property.retry}
          </button>
        </div>
      </Shell>
    )
  }

  if (state.status === 'loading' || !settings) {
    return (
      <Shell backHref={propertyHref}>
        <p className="min-h-screen text-body text-ink-muted" role="status">
          {t.checkout.loading}
        </p>
      </Shell>
    )
  }

  const { property, quote, plan } = state
  if (!quote.quotable || quote.total_clp === undefined || !plan.quotable) {
    const text = reasonMessage(quote.reason, {
      minNights: quote.min_nights,
      maxGuests: property.max_guests,
      advanceHours: property.min_advance_hours,
    })
    return message(text, { href: propertyHref, label: t.checkout.backToProperty })
  }

  // Política de cancelación de ESTA propiedad (o la global), desde el servidor.
  const today = zonedNow(new Date()).day
  const cancellation = cancellationText(
    cancellationInfo(stay.checkIn, today, plan.cancellation_free_days ?? settings.cancellationFreeDays),
    today,
    plan.cancellation_refund_percent ?? settings.cancellationRefundPercent,
  )

  return (
    <Shell backHref={propertyHref}>
      <h1 className="font-display text-heading text-ink md:text-display-l">{t.checkout.title}</h1>
      <div className="mt-7 grid gap-7 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-start">
        <div className="md:order-2 md:sticky md:top-4">
          <StaySummary
            propertyName={property.name}
            place={[property.neighborhood, property.city].filter(Boolean).join(', ')}
            checkIn={stay.checkIn}
            checkOut={stay.checkOut}
            guests={stay.guests}
            quote={quote}
            cancellation={cancellation}
          />
        </div>
        <div className="md:order-1">
          <BookingForm
            slug={slug}
            stay={stay}
            total={quote.total_clp}
            whatsapp={whatsapp}
            plan={plan}
            onPriceChanged={(fresh) => setState((s) => (s.status === 'ok' ? { ...s, quote: fresh } : s))}
            onPlanChanged={(fresh) => setState((s) => (s.status === 'ok' ? { ...s, plan: fresh } : s))}
          />
        </div>
      </div>
    </Shell>
  )
}

function Shell({ backHref, children }: { backHref: string; children: React.ReactNode }) {
  return (
    <div className={`${container} pb-10`}>
      <div className="py-4">
        <Link to={backHref} className="inline-flex min-h-10 items-center gap-2 rounded-pill text-body-s text-ink hover:text-pacific">
          <ArrowLeftIcon size={20} />
          {t.checkout.back}
        </Link>
      </div>
      {children}
    </div>
  )
}
