import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { t } from '../lib/i18n'

type State = { status: 'loading' } | { status: 'error' } | { status: 'ok'; siteName: string }

export function HomePage() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    // El nombre del sitio se lee desde la base para que se edite sin tocar código.
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'site_name')
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          console.error(error)
          setState({ status: 'error' })
        } else {
          setState({ status: 'ok', siteName: data.value })
        }
      })
  }, [])

  if (state.status === 'loading') return <p className="text-slate-500">{t.home.loading}</p>
  if (state.status === 'error') return <p className="text-red-600">{t.home.loadError}</p>

  return (
    <section>
      <h1 className="text-3xl font-bold">{state.siteName}</h1>
      <p className="mt-2 text-slate-600">{t.home.subtitle}</p>
    </section>
  )
}
