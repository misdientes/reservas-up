import { useParams } from 'react-router'
import { t } from '../lib/i18n'

export function PropertyPage() {
  const { slug } = useParams()

  return (
    <section>
      <h1 className="text-2xl font-bold">
        {t.property.title}: {slug}
      </h1>
      <p className="mt-2 text-slate-600">{t.property.placeholder}</p>
    </section>
  )
}
