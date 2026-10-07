import { Outlet } from 'react-router'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import { useSiteData } from '../lib/site-data-context'
import { container } from './ui'
import { t } from '../lib/i18n'

export function Layout() {
  const { usingFixtures } = useSiteData()

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#contenido"
        className="sr-only rounded-pill bg-ink px-5 py-3 text-button text-sand-100 focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-20"
      >
        {t.layout.skipToContent}
      </a>

      {usingFixtures && (
        <p role="note" className="bg-dawn py-2 text-center text-body-s text-ink">
          <span className={container}>{t.layout.fixturesBanner}</span>
        </p>
      )}

      <SiteHeader />

      <main id="contenido" tabIndex={-1} className="flex-1 focus:outline-none">
        <Outlet />
      </main>

      <SiteFooter />
    </div>
  )
}
