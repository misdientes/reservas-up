import { ChatIcon } from '../icons'
import { buttonPrimary, container } from '../ui'
import { formatRangeShort, type Day } from '../../lib/dates/day'
import { formatCLP } from '../../lib/money'
import { t } from '../../lib/i18n'

// Modo de la barra: hoy "consult" (WhatsApp). En la Sesión 9 se activa
// "book" (Reservar con pago) sin cambiar la página que la usa.
export type BookingMode = 'consult' | 'book'

interface Props {
  mode: BookingMode
  llegada: Day | null
  salida: Day | null
  huespedes: number | null
  // Total cotizado (precio final) y noches; null si no hay cotización válida.
  total: { amount: number; nights: number } | null
  busy: boolean
  // Consultar: abre WhatsApp. Reservar (Sesión 9): iniciará el pago.
  onAction: () => void
  // Sin acción disponible (por ejemplo, sin número de WhatsApp configurado).
  disabled?: boolean
}

// Barra de reserva: queda pegada abajo mientras se recorre la ficha (sticky,
// no tapa el pie). Es lo único que "flota", por eso lleva sombra (guía).
export function BookingBar({ mode, llegada, salida, huespedes, total, busy, onAction, disabled = false }: Props) {
  const summary = [
    llegada && salida ? formatRangeShort(llegada, salida) : t.booking.noDates,
    huespedes ? t.booking.guestsShort(huespedes) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const label = busy ? t.booking.checking : mode === 'book' ? t.booking.book : t.booking.consult

  return (
    <div className="sticky bottom-0 z-10 border-t border-line bg-surface shadow-float">
      <div className={`${container} flex items-center justify-between gap-4 py-3`}>
        <div>
          {total && <p className="text-title text-ink">{t.booking.totalShort(formatCLP(total.amount), total.nights)}</p>}
          <p className="text-body-s text-ink-muted">{summary}</p>
        </div>
        <button type="button" onClick={onAction} disabled={busy || disabled} aria-busy={busy} className={buttonPrimary}>
          {mode === 'consult' && <ChatIcon size={20} />}
          {label}
        </button>
      </div>
    </div>
  )
}
