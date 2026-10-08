import { addDays, compareDays, formatLong, parts, type Day } from './dates/day'
import { t } from './i18n'

// Política de cancelación moderada (configurable en app_settings): reembolso
// del porcentaje indicado hasta N días antes de la llegada, hasta las 23:59
// (hora de Chile) del día límite. La misma regla se congela en la reserva
// al crearla (create_booking_hold).

export interface CancellationInfo {
  refundable: boolean
  freeUntil: Day
}

export function cancellationInfo(checkIn: Day, today: Day, freeDays: number): CancellationInfo {
  const freeUntil = addDays(checkIn, -Math.max(0, freeDays))
  return { refundable: compareDays(today, freeUntil) <= 0, freeUntil }
}

// "el jueves 15 de noviembre" (con el año si no es el año en curso).
function deadlineText(day: Day, today: Day): string {
  const long = formatLong(day) // "jueves 15 de noviembre de 2026"
  return parts(day).year === parts(today).year ? long.replace(/ de \d{4}$/, '') : long
}

export function cancellationText(info: CancellationInfo, today: Day, refundPercent: number): string {
  if (!info.refundable) return t.checkout.nonRefundable
  return refundPercent >= 100
    ? t.checkout.freeCancellationUntil(deadlineText(info.freeUntil, today))
    : t.checkout.partialCancellationUntil(refundPercent, deadlineText(info.freeUntil, today))
}
