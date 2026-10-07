import { useParams } from 'react-router'
import { container, usePageTitle } from '../components/ui'
import { t } from '../lib/i18n'

// Ficha y calendario: Sesión 6. Recibe ?llegada&salida&huespedes del listado.
export function PropertyPage() {
  const { slug } = useParams()
  usePageTitle(`${t.property.title} · ${t.meta.legalTitle}`)

  return (
    <section className={`${container} py-10`}>
      <h1 className="font-display text-heading text-ink">
        {t.property.title}: {slug}
      </h1>
      <p className="mt-3 text-body text-ink-muted">{t.property.placeholder}</p>
    </section>
  )
}
