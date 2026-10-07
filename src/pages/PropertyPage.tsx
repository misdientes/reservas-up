import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { PropertyTopBar } from '../components/property/PropertyTopBar'
import { Gallery } from '../components/property/Gallery'
import { PropertyFacts } from '../components/property/PropertyFacts'
import { Amenities } from '../components/property/Amenities'
import { StayCalendar } from '../components/property/StayCalendar'
import { BookingBar, type BookingMode } from '../components/property/BookingBar'
import { PriceBlock, type QuoteState } from '../components/property/PriceBlock'
import { PropertyNotFound } from '../components/property/PropertyNotFound'
import { KeyIcon, MapPinIcon } from '../components/icons'
import { buttonSecondary, container, eyebrow } from '../components/ui'
import { loadQuote, usePropertyPage } from '../lib/property-page'
import { useDocumentMeta } from '../lib/document-meta'
import { useSiteData } from '../lib/site-data-context'
import { whatsappUrl, stayMessage } from '../lib/whatsapp'
import { MAX_GUESTS_OPTION, toSearchParams } from '../lib/search-params'
import { buildStayContext, isStillAvailable, parseStayFromUrl, type OccupiedRange, type UrlNotice } from '../lib/calendar/availability'
import type { Day } from '../lib/dates/day'
import type { PublicPropertyDetail } from '../types/public'
import type { Quote } from '../lib/pricing'
import { formatCLP } from '../lib/money'
import { t } from '../lib/i18n'

// Hasta la Sesión 9 la ficha solo permite consultar por WhatsApp.
const BOOKING_MODE: BookingMode = 'consult'

export function PropertyPage() {
  const { slug = '' } = useParams()
  const { state, retry, refreshAvailability } = usePropertyPage(slug)

  if (state.status === 'notFound') return <PropertyNotFound />

  if (state.status === 'error') {
    return (
      <section className={`${container} py-10`}>
        <div className="flex flex-col items-start gap-4 rounded-xl border border-line bg-sand-50 p-7" role="alert">
          <p className="text-body text-ink">{t.property.loadError}</p>
          <button type="button" className={buttonSecondary} onClick={retry}>
            {t.property.retry}
          </button>
        </div>
      </section>
    )
  }

  if (state.status === 'loading') {
    // Una pantalla reservada: lo que llega después no desplaza nada visible.
    return (
      <p className={`${container} min-h-screen py-10 text-body text-ink-muted`} role="status">
        {t.property.loading}
      </p>
    )
  }

  return <PropertyDetail key={slug} detail={state.detail} ranges={state.ranges} refreshAvailability={refreshAvailability} />
}

interface DetailProps {
  detail: PublicPropertyDetail
  ranges: OccupiedRange[]
  refreshAvailability: () => Promise<OccupiedRange[] | null>
}

const NOTICE_TEXT: Record<UrlNotice, string> = {
  invalidDates: t.calendar.noticeInvalidDates,
  unavailableDates: t.calendar.noticeUnavailableDates,
  invalidGuests: t.calendar.noticeInvalidGuests,
}

function PropertyDetail({ detail, ranges, refreshAvailability }: DetailProps) {
  const { property, photos } = detail
  const { settings } = useSiteData()
  const [params, setParams] = useSearchParams()
  const guestsId = useId()
  const maxGuests = property.max_guests ?? MAX_GUESTS_OPTION

  // "Ahora" se fija al abrir la ficha; la disponibilidad se refresca aparte.
  const [now] = useState(() => new Date())
  const ctx = useMemo(
    () =>
      buildStayContext({
        now,
        minAdvanceHours: property.min_advance_hours,
        checkInTime: property.check_in_time,
        ranges,
        minNights: property.min_nights,
      }),
    [now, property, ranges],
  )

  // Fechas y huéspedes de la URL: lo inválido se descarta con aviso.
  const [initial] = useState(() => parseStayFromUrl(params, ctx, maxGuests))
  const [stay, setStay] = useState({ llegada: initial.llegada, salida: initial.salida, huespedes: initial.huespedes })
  const [notice, setNotice] = useState<string | null>(initial.notices.map((n) => NOTICE_TEXT[n]).join(' ') || null)
  const [busy, setBusy] = useState(false)

  const writeUrl = useCallback(
    (next: { llegada: Day | null; salida: Day | null; huespedes: number | null }) => {
      setParams(
        (current) => {
          const merged = toSearchParams({
            destino: current.get('destino') ?? '',
            llegada: next.llegada ?? '',
            salida: next.salida ?? '',
            huespedes: next.huespedes,
          })
          return merged
        },
        { replace: true, preventScrollReset: true },
      )
    },
    [setParams],
  )

  // Si la URL traía datos inválidos, se limpia para que el enlace compartido no los repita.
  useEffect(() => {
    if (initial.notices.length > 0) writeUrl(stay)
    // Solo al abrir la ficha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateStay = (next: typeof stay) => {
    setStay(next)
    setNotice(null)
    writeUrl(next)
  }

  // Disponibilidad fresca: al volver a la pestaña se vuelve a consultar y,
  // si las fechas elegidas se ocuparon, se limpian con aviso.
  const stayRef = useRef(stay)
  const ctxRef = useRef(ctx)
  useEffect(() => {
    stayRef.current = stay
    ctxRef.current = ctx
  }, [stay, ctx])

  const checkFresh = useCallback(async (): Promise<boolean> => {
    const fresh = await refreshAvailability()
    const current = stayRef.current
    if (!fresh || !current.llegada || !current.salida) return true
    if (isStillAvailable(current.llegada, current.salida, fresh, ctxRef.current)) return true
    const cleared = { ...current, llegada: null, salida: null }
    setStay(cleared)
    writeUrl(cleared)
    setNotice(t.booking.justTaken)
    return false
  }, [refreshAvailability, writeUrl])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkFresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [checkFresh])

  // ─── Cotización (motor único en la base: quote_stay) ──────────────────
  // Se recotiza al cambiar fechas o huéspedes y al refrescarse la
  // disponibilidad. Sin huéspedes elegidos se cotiza para 1.
  const guestsForQuote = stay.huespedes ?? 1
  const quoteKey = stay.llegada && stay.salida ? `${stay.llegada}|${stay.salida}|${guestsForQuote}` : null
  const [quoteResult, setQuoteResult] = useState<{ key: string; quote: Quote | null } | null>(null)

  useEffect(() => {
    if (!quoteKey || !stay.llegada || !stay.salida) return
    let cancelled = false
    loadQuote(property, stay.llegada, stay.salida, guestsForQuote)
      .then((quote) => !cancelled && setQuoteResult({ key: quoteKey, quote }))
      .catch((error: unknown) => {
        console.warn('No se pudo cotizar', error)
        if (!cancelled) setQuoteResult({ key: quoteKey, quote: null })
      })
    return () => {
      cancelled = true
    }
    // ranges: al refrescar la disponibilidad también se recotiza.
  }, [quoteKey, property, ranges, stay.llegada, stay.salida, guestsForQuote])

  // Estado derivado: "actualizando" = la última respuesta es de otra selección.
  const quoteState: QuoteState = !quoteKey
    ? { status: 'idle' }
    : quoteResult?.key === quoteKey
      ? quoteResult.quote
        ? { status: 'done', quote: quoteResult.quote }
        : { status: 'error' }
      : { status: 'loading', previous: quoteResult?.quote ?? null }
  const currentQuote = quoteState.status === 'done' && quoteState.quote.quotable ? quoteState.quote : null
  const total = currentQuote?.total_clp !== undefined ? { amount: currentQuote.total_clp, nights: currentQuote.nights_count ?? 0 } : null

  const whatsapp = whatsappUrl(
    settings,
    [stayMessage({ propertyName: property.name, ...stay }), total ? t.booking.whatsappTotal(formatCLP(total.amount)) : null]
      .filter(Boolean)
      .join(' '),
  )

  async function consult() {
    if (!whatsapp) return
    if (!stay.llegada || !stay.salida) {
      window.open(whatsapp, '_blank', 'noopener')
      return
    }
    // La ventana se abre ya (gesto del usuario, sin bloqueo de ventanas
    // emergentes) y recibe WhatsApp solo si las fechas siguen libres.
    const win = window.open('about:blank', '_blank')
    if (win) win.opener = null
    setBusy(true)
    const ok = await checkFresh()
    setBusy(false)
    if (!ok) {
      win?.close()
      return
    }
    if (win) win.location.href = whatsapp
    else window.location.href = whatsapp
  }

  const place = [property.neighborhood, property.city].filter(Boolean).join(', ')
  useDocumentMeta(`${property.name} · ${t.meta.legalTitle}`, t.property.metaDescription(property.name, place, property.max_guests))

  const backHref = `/?${toSearchParams({
    destino: params.get('destino') ?? '',
    llegada: stay.llegada ?? '',
    salida: stay.salida ?? '',
    huespedes: stay.huespedes,
  }).toString()}#propiedades`

  const label = [property.city, property.neighborhood].filter(Boolean).join(' · ')
  const time = (value: string | null) => value?.slice(0, 5) ?? null
  const checkIn = time(property.check_in_time)
  const checkOut = time(property.check_out_time)

  return (
    <div>
      <PropertyTopBar backHref={backHref} title={property.name} />

      <div className={container}>
        <Gallery photos={photos} propertyName={property.name} />
      </div>

      <div className={`${container} flex flex-col gap-10 py-10`}>
        <div className="flex flex-col gap-10 md:w-2/3">
          {/* 3. Encabezado */}
          <header className="flex flex-col gap-3">
            <p className={eyebrow}>{label}</p>
            <h1 className="font-display text-heading text-ink md:text-display-l">{property.name}</h1>
            <PropertyFacts property={property} />
          </header>

          {/* 4. Descripción y llegada autónoma */}
          {(property.description || property.self_check_in) && (
            <div className="flex flex-col gap-5">
              {property.description?.split('\n').filter(Boolean).map((paragraph) => (
                <p key={paragraph} className="max-w-prose text-body text-ink">
                  {paragraph}
                </p>
              ))}
              {property.self_check_in && (
                <div className="flex gap-3 rounded-l border border-line bg-sand-50 p-4">
                  <KeyIcon size={24} className="shrink-0 text-pacific" />
                  <div>
                    <p className="text-title text-ink">{t.property.selfCheckInTitle}</p>
                    <p className="mt-2 text-body-s text-ink-muted">{t.property.selfCheckInText}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 5. Lo que incluye */}
          <Amenities items={property.amenities} />

          {/* 6. Calendario */}
          <section aria-labelledby="calendar-title" className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 id="calendar-title" className="font-display text-heading-s text-ink">
                {t.property.calendarHeading}
              </h2>
              <div className="flex flex-col gap-2">
                <label htmlFor={guestsId} className="text-label uppercase tracking-widest text-ink">
                  {t.calendar.guests}
                </label>
                <select
                  id={guestsId}
                  value={stay.huespedes ?? ''}
                  onChange={(e) => updateStay({ ...stay, huespedes: e.target.value ? Number(e.target.value) : null })}
                  className="min-h-10 rounded-m border border-border-control bg-sand-50 px-3 text-body text-ink"
                >
                  <option value="">—</option>
                  {Array.from({ length: maxGuests }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {t.booking.guestsShort(n)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <StayCalendar
              ctx={ctx}
              minAdvanceHours={property.min_advance_hours}
              llegada={stay.llegada}
              salida={stay.salida}
              notice={notice}
              onChange={(llegada, salida) => updateStay({ ...stay, llegada, salida })}
            />
          </section>

          {/* 7. Precio (quote_stay: solo precios finales) */}
          <PriceBlock state={quoteState} maxGuests={property.max_guests} advanceHours={property.min_advance_hours} />

          {/* 8. Ubicación: solo comuna/sector; nunca la dirección exacta */}
          <section aria-labelledby="location-title">
            <h2 id="location-title" className="font-display text-heading-s text-ink">
              {t.property.locationHeading}
            </h2>
            <p className="mt-3 inline-flex items-center gap-2 text-body text-ink">
              <MapPinIcon size={20} className="text-earth" />
              {place}
            </p>
            <p className="mt-2 text-body-s text-ink-muted">{t.property.locationNote}</p>
          </section>

          {/* 9. Antes de reservar */}
          <section aria-labelledby="before-title">
            <h2 id="before-title" className="font-display text-heading-s text-ink">
              {t.property.beforeHeading}
            </h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              {checkIn && <Fact term={t.property.checkIn} value={t.property.checkInFrom(checkIn)} />}
              {checkOut && <Fact term={t.property.checkOut} value={t.property.checkOutUntil(checkOut)} />}
              <Fact term={t.property.minNights} value={t.property.minNightsValue(property.min_nights)} />
            </dl>
            {property.house_rules && (
              <div className="mt-5">
                <h3 className="text-title text-ink">{t.property.houseRules}</h3>
                {property.house_rules.split('\n').filter(Boolean).map((rule) => (
                  <p key={rule} className="mt-2 max-w-prose text-body text-ink">
                    {rule}
                  </p>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* 10. Barra de reserva */}
      <BookingBar
        mode={BOOKING_MODE}
        llegada={stay.llegada}
        salida={stay.salida}
        huespedes={stay.huespedes}
        total={total}
        busy={busy}
        disabled={!whatsapp}
        onAction={consult}
      />
    </div>
  )
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="border-t border-line pt-3">
      <dt className="text-label uppercase tracking-widest text-earth">{term}</dt>
      <dd className="mt-2 text-body text-ink">{value}</dd>
    </div>
  )
}
