import { Link } from 'react-router'
import { buttonPrimary, container } from '../ui'
import { useDocumentMeta } from '../../lib/document-meta'
import { t } from '../../lib/i18n'

// Propiedad inexistente o en borrador: el mismo mensaje en ambos casos
// (no se revela si existe un borrador con ese enlace).
export function PropertyNotFound() {
  useDocumentMeta(`${t.notFound.propertyTitle} · ${t.meta.legalTitle}`)

  return (
    <section className={`${container} py-10`}>
      <div className="rounded-xl border border-line bg-sand-50 p-7 md:p-10">
        <h1 className="font-display text-heading text-ink">{t.notFound.propertyTitle}</h1>
        <p className="mt-3 max-w-prose text-body text-ink-muted">{t.notFound.propertyText}</p>
        <Link to="/#propiedades" className={`${buttonPrimary} mt-7`}>
          {t.notFound.propertyCta}
        </Link>
      </div>
    </section>
  )
}
