import { formatLong, type Day } from '../../lib/dates/day'
import { formatCLP } from '../../lib/money'
import { quoteLines, type Quote } from '../../lib/pricing'
import { t } from '../../lib/i18n'

interface Props {
  propertyName: string
  place: string
  checkIn: Day
  checkOut: Day
  guests: number
  quote: Quote
  cancellation: string
}

// Resumen de la estadía en el checkout: fechas, detalle de precio (solo
// precios finales, de quote_stay) y la fecha límite de cancelación.
export function StaySummary({ propertyName, place, checkIn, checkOut, guests, quote, cancellation }: Props) {
  return (
    <section aria-labelledby="stay-title" className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-5">
      <div>
        <h2 id="stay-title" className="text-label uppercase tracking-widest text-earth">
          {t.checkout.stayHeading}
        </h2>
        <p className="mt-2 font-display text-heading-s text-ink">{propertyName}</p>
        {place && <p className="mt-2 text-body-s text-ink-muted">{place}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <Item term={t.checkout.checkIn} value={formatLong(checkIn)} />
        <Item term={t.checkout.checkOut} value={formatLong(checkOut)} />
        <Item term={t.checkout.guests} value={t.booking.guestsShort(guests)} />
      </dl>

      <div className="border-t border-line pt-4">
        <dl className="flex flex-col gap-2">
          {quoteLines(quote).map((line) => (
            <div key={line.label} className="flex items-baseline justify-between gap-4 text-body-s text-ink">
              <dt>{line.label}</dt>
              <dd className="shrink-0">{line.amount}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-line pt-4">
          <p className="text-title text-ink">{t.price.total}</p>
          <p className="font-display text-heading-s text-ink">{formatCLP(quote.total_clp ?? 0)}</p>
        </div>
        <p className="mt-3 text-body-s text-ink-muted">{t.price.noPlatformFees}</p>
      </div>

      <div className="rounded-l bg-sand-50 p-4">
        <h3 className="text-title text-ink">{t.checkout.cancellationHeading}</h3>
        <p className="mt-2 text-body-s text-ink">{cancellation}</p>
      </div>
    </section>
  )
}

function Item({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-label uppercase tracking-widest text-earth">{term}</dt>
      <dd className="mt-2 text-body-s text-ink">{value}</dd>
    </div>
  )
}
