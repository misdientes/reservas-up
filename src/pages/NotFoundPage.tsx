import { Link } from 'react-router'
import { container, textLink, usePageTitle } from '../components/ui'
import { t } from '../lib/i18n'

export function NotFoundPage() {
  usePageTitle(`${t.notFound.title} · ${t.meta.legalTitle}`)

  return (
    <section className={`${container} py-10`}>
      <h1 className="font-display text-heading text-ink">{t.notFound.title}</h1>
      <p className="mt-3 text-body text-ink-muted">{t.notFound.text}</p>
      <Link to="/" className={`${textLink} mt-5 inline-flex min-h-10 items-center`}>
        {t.notFound.backHome}
      </Link>
    </section>
  )
}
