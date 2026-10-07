import { ChatIcon } from '../icons'
import { buttonPrimary } from '../ui'
import { useSiteData } from '../../lib/site-data-context'
import { whatsappUrl } from '../../lib/whatsapp'
import { t } from '../../lib/i18n'

// Sin propiedades publicadas: una invitación a escribir, no un vacío.
// Aquí WhatsApp es la acción principal (no hay buscador que usar).
export function EmptyState() {
  const { settings } = useSiteData()
  const whatsapp = whatsappUrl(settings)

  return (
    <div className="rounded-xl border border-line bg-sand-50 p-7 md:p-10">
      <h2 className="font-display text-heading-s text-ink md:text-heading">{t.empty.heading}</h2>
      <p className="mt-3 max-w-prose text-body text-ink-muted">{t.empty.text}</p>
      {whatsapp && (
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${buttonPrimary} mt-7 w-full md:w-auto`}>
          <ChatIcon size={20} />
          {t.empty.cta}
        </a>
      )}
    </div>
  )
}
