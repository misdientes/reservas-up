import { formatCLP } from '../../lib/money'
import { quoteLines, reasonMessage, type Quote } from '../../lib/pricing'
import { t } from '../../lib/i18n'

export type QuoteState =
  | { status: 'idle' }
  | { status: 'loading'; previous: Quote | null }
  | { status: 'done'; quote: Quote }
  | { status: 'error' }

interface Props {
  state: QuoteState
  maxGuests: number | null
  advanceHours: number
}

// Precio de la estadía: solo precios finales (nunca impuestos en público).
// Al recotizar se conserva lo anterior marcado como "actualizando", así el
// bloque no parpadea ni cambia de tamaño mientras llega la respuesta.
export function PriceBlock({ state, maxGuests, advanceHours }: Props) {
  const quote = state.status === 'done' ? state.quote : state.status === 'loading' ? state.previous : null
  const busy = state.status === 'loading'

  return (
    <section
      aria-labelledby="price-title"
      aria-busy={busy}
      className="rounded-xl border border-line bg-surface p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="price-title" className="text-label uppercase tracking-widest text-earth">
          {t.property.priceHeading}
        </h2>
        <p className="text-body-s text-ink-muted" aria-live="polite">
          {busy ? t.price.updating : ''}
        </p>
      </div>

      <div aria-live="polite" className={busy ? 'opacity-50' : undefined}>
        {state.status === 'idle' && <p className="mt-3 text-body text-ink">{t.price.pickDates}</p>}

        {state.status === 'error' && <p className="mt-3 text-body text-ink">{t.price.reasonError}</p>}

        {state.status === 'loading' && !quote && <p className="mt-3 text-body text-ink-muted">{t.price.updating}</p>}

        {quote && !quote.quotable && (
          <p className="mt-3 text-body text-ink">
            {reasonMessage(quote.reason, { minNights: quote.min_nights, maxGuests, advanceHours })}
          </p>
        )}

        {quote?.quotable && quote.total_clp !== undefined && (
          <>
            <dl className="mt-3 flex flex-col gap-2">
              {quoteLines(quote).map((line) => (
                <div key={line.label} className="flex items-baseline justify-between gap-4 text-body-s text-ink">
                  <dt>{line.label}</dt>
                  <dd className="shrink-0">{line.amount}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-line pt-4">
              <p className="text-title text-ink">{t.price.total}</p>
              <p className="font-display text-heading-s text-ink">{formatCLP(quote.total_clp)}</p>
            </div>
          </>
        )}
      </div>

      <p className="mt-3 text-body-s text-ink-muted">{t.price.noPlatformFees}</p>
    </section>
  )
}
