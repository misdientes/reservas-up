import { ChatIcon } from '../icons'
import { buttonSecondary, container } from '../ui'
import { useSiteData } from '../../lib/site-data-context'
import { whatsappUrl } from '../../lib/whatsapp'
import { t } from '../../lib/i18n'

// Viajes de trabajo: invitación a coordinar por WhatsApp. No promete factura
// ni descuentos (no están confirmados).
export function WorkBlock() {
  const { settings } = useSiteData()
  const whatsapp = whatsappUrl(settings)

  return (
    <section id="por-trabajo" aria-labelledby="work-title" className={`${container} scroll-mt-5`}>
      <div className="grid gap-5 border-t border-line pt-10 md:grid-cols-12 md:items-center">
        <div className="md:col-span-8">
          <h2 id="work-title" className="font-display text-heading-s md:text-heading">
            {t.work.heading}
          </h2>
          <p className="mt-3 max-w-prose text-body text-ink-muted">{t.work.text}</p>
        </div>
        {whatsapp && (
          <div className="md:col-span-4 md:flex md:justify-end">
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${buttonSecondary} w-full md:w-auto`}>
              <ChatIcon size={20} />
              {t.work.cta}
            </a>
          </div>
        )}
      </div>
    </section>
  )
}
