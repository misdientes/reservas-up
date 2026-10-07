import { Link } from 'react-router'
import { Brand } from './Brand'
import { ChatIcon } from './icons'
import { container } from './ui'
import { useSiteData } from '../lib/site-data-context'
import { whatsappUrl } from '../lib/whatsapp'
import { t } from '../lib/i18n'

// Año del pie, calculado una vez al cargar el sitio.
const YEAR = new Date().getFullYear()

const LEGAL = [
  { to: '/terminos', label: t.footer.terms },
  { to: '/privacidad', label: t.footer.privacy },
  { to: '/cancelaciones', label: t.footer.cancellation },
]

export function SiteFooter() {
  const { settings } = useSiteData()
  const whatsapp = whatsappUrl(settings)
  const linkClass = 'inline-flex min-h-10 items-center text-body-s text-sand-100 underline-offset-4 hover:underline'

  return (
    <footer className="bg-ink text-sand-100">
      <div className={`${container} grid gap-7 py-10 md:grid-cols-3`}>
        <div className="flex flex-col gap-3">
          <Brand onDark />
          <p className="text-body-s">{t.footer.tagline}</p>
        </div>

        <nav aria-labelledby="footer-legal">
          <h2 id="footer-legal" className="text-label uppercase tracking-widest text-dawn">
            {t.footer.legalHeading}
          </h2>
          <ul className="mt-2">
            {LEGAL.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className={linkClass}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {whatsapp && (
          <div>
            <h2 className="text-label uppercase tracking-widest text-dawn">{t.footer.contactHeading}</h2>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${linkClass} mt-2 gap-2`}>
              <ChatIcon size={20} className="text-dawn" />
              {t.footer.whatsapp}
            </a>
          </div>
        )}
      </div>
      <div className="border-t border-ink-muted">
        <p className={`${container} py-4 text-body-s`}>
          © {YEAR} {t.footer.rights}
        </p>
      </div>
    </footer>
  )
}
