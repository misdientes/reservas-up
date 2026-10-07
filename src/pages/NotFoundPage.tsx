import { Link } from 'react-router'
import { t } from '../lib/i18n'

export function NotFoundPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold">{t.notFound.title}</h1>
      <Link to="/" className="mt-4 inline-block text-sm underline">
        {t.notFound.backHome}
      </Link>
    </section>
  )
}
