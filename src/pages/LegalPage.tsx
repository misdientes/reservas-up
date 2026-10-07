import { Link } from 'react-router'
import { container, textLink, usePageTitle } from '../components/ui'
import { t } from '../lib/i18n'

// Páginas legales vacías por ahora; el contenido versionado llega en la Sesión 16.
export function LegalPage({ title }: { title: string }) {
  usePageTitle(`${title} · ${t.meta.legalTitle}`)

  return (
    <section className={`${container} py-10`}>
      <h1 className="font-display text-heading text-ink">{title}</h1>
      <p className="mt-3 max-w-prose text-body text-ink-muted">{t.legal.pending}</p>
      <Link to="/" className={`${textLink} mt-5 inline-flex min-h-10 items-center`}>
        {t.legal.backHome}
      </Link>
    </section>
  )
}
