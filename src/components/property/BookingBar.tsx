import { ChatIcon } from '../icons'
import { buttonPrimary, container } from '../ui'
import { formatRangeShort, type Day } from '../../lib/dates/day'
import { t } from '../../lib/i18n'

// Modo de la barra: hoy "consult" (WhatsApp). En la Sesión 9 se activa
// "book" (Reservar con pago) sin cambiar la página que la usa.
export type BookingMode = 'consult' | 'book'

interface Props {
  mode: BookingMode
  llegada: Day | null
  salida: Day | null
  huespedes: number | null
  busy: boolean
  // Consultar: abre WhatsApp. Reservar (Sesión 9): iniciará el pago.
  onAction: () => void
  // Sin acción disponible (por ejemplo, sin número de WhatsApp configurado).
  disabled?: boolean
}

// Barra de reserva: queda pegada abajo mientras se recorre la ficha (sticky,
// no tapa el pie). Es lo único que "flota", por eso lleva sombra (guía).
export function BookingBar({ mode, llegada, salida, huespedes, busy, onAction, disabled = false }: Props) {
  const summary = [
    llegada && salida ? formatRangeShort(llegada, salida) : t.booking.noDates,
    huespedes ? t.booking.guestsShort(huespedes) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const label = busy ? t.booking.checking : mode === 'book' ? t.booking.book : t.booking.consult

  return (
    <div className="sticky bottom-0 z-10 border-t border-line bg-surface shadow-[0_-8px_24px_-12px_var(--color-ink)]">
      <div className={`${container} flex items-center justify-between gap-4 py-3`}>
        <p className="text-body-s text-ink">{summary}</p>
        <button type="button" onClick={onAction} disabled={busy || disabled} aria-busy={busy} className={buttonPrimary}>
          {mode === 'consult' && <ChatIcon size={20} />}
          {label}
        </button>
      </div>
    </div>
  )
}
