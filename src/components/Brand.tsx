import { t } from '../lib/i18n'

// Marca tipográfica (sin logo por ahora): "Reservas" en Instrument Serif y
// "UP" en Manrope negrita sobre una pastilla terracota.
export function Brand({ onDark = false }: { onDark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2" aria-hidden="true">
      <span className={`font-display text-heading-s ${onDark ? 'text-sand-100' : 'text-ink'}`}>{t.layout.brandWord}</span>
      <span className="rounded-pill bg-terracotta px-2 text-button text-surface">{t.layout.brandPill}</span>
    </span>
  )
}
