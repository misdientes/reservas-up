import { container, usePageTitle } from '../components/ui'
import { t } from '../lib/i18n'

export function AdminPage() {
  usePageTitle(`${t.admin.title} · ${t.meta.legalTitle}`)

  return (
    <section className={`${container} py-10`}>
      <h1 className="font-display text-heading text-ink">{t.admin.title}</h1>
      <p className="mt-3 text-body text-ink-muted">{t.admin.placeholder}</p>
    </section>
  )
}
