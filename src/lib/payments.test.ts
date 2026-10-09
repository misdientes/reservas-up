import { describe, expect, it } from 'vitest'
import { formatDeadline, whatsappMessageUrl } from './payments'
import { t } from './i18n'

describe('pagos manuales: plazos y WhatsApp', () => {
  it('el plazo se muestra en hora de Chile (verano, UTC−3)', () => {
    expect(formatDeadline('2026-11-27T18:00:00Z')).toBe('viernes 27 de noviembre, 15:00')
  })

  it('el plazo se muestra en hora de Chile (invierno, UTC−4)', () => {
    expect(formatDeadline('2026-07-10T19:30:00Z')).toBe('viernes 10 de julio, 15:30')
  })

  it('WhatsApp prellenado con el código corto y el monto, nunca el enlace secreto', () => {
    const settings = { siteName: '', whatsappNumber: '+56 9 7697 0000', whatsappMessage: 'Hola', bookingMode: 'online' as const, cancellationFreeDays: 5, cancellationRefundPercent: 100 }
    const url = whatsappMessageUrl(settings, t.bookingStatus.whatsappReceipt('UP-4K7QM', '$40.000'))
    expect(url).toBe('https://wa.me/56976970000?text=' + encodeURIComponent('Hola, envío el comprobante de la reserva UP-4K7QM por $40.000.'))
    expect(whatsappMessageUrl({ ...settings, whatsappNumber: '' }, 'x')).toBeNull()
  })
})
