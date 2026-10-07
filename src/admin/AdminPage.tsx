import { t } from '../lib/i18n'

export function AdminPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold">{t.admin.title}</h1>
      <p className="mt-2 text-slate-600">{t.admin.placeholder}</p>
    </section>
  )
}
