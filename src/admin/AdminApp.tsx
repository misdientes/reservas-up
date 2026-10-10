import { useEffect, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { buttonSecondary, container, usePageTitle } from '../components/ui'
import { AdminLogin } from './AdminLogin'
import { PaymentsQueue } from './PaymentsQueue'
import { UpcomingArrivals } from './UpcomingArrivals'
import { PropertiesList } from './properties/PropertiesList'
import { PropertyEditor } from './properties/PropertyEditor'
import { OwnersPage } from './owners/OwnersPage'
import { AccountsPage } from './accounts/AccountsPage'
import { AuditList } from './AuditList'
import { RatesPage } from './rates/RatesPage'
import { RateEditor } from './rates/RateEditor'
import { SimulatorPage } from './simulator/SimulatorPage'
import { t } from '../lib/i18n'
import { ea } from '../lib/i18n/es-admin'

// Panel /admin/* (chunk aparte: el sitio público no lo descarga). Solo el
// admin: acceso con enlace mágico; el rol se lee de app_users y cada función
// de la base vuelve a exigir is_admin(). El encargado ve "Sin acceso".

type Access = { status: 'loading' } | { status: 'anonymous' } | { status: 'denied' } | { status: 'admin'; session: Session }

const tab = ({ isActive }: { isActive: boolean }) =>
  'inline-flex min-h-10 items-center rounded-pill border px-4 text-body-s ' +
  (isActive ? 'border-pacific bg-pacific text-surface' : 'border-border-control text-ink hover:bg-sand-50')

export function AdminApp() {
  usePageTitle(`${t.admin.title} · ${t.meta.legalTitle}`)
  const [access, setAccess] = useState<Access>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function resolve(session: Session | null) {
      if (!session) return !cancelled && setAccess({ status: 'anonymous' })
      const { data } = await supabase.from('app_users').select('role, is_active').eq('id', session.user.id).maybeSingle()
      if (cancelled) return
      setAccess(data?.role === 'admin' && data.is_active ? { status: 'admin', session } : { status: 'denied' })
    }
    supabase.auth.getSession().then(({ data }) => resolve(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void resolve(session)
    })
    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  return (
    <section className={`${container} py-10`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-heading text-ink">{t.admin.title}</h1>
        {(access.status === 'admin' || access.status === 'denied') && (
          <button type="button" className={buttonSecondary} onClick={() => supabase.auth.signOut()}>
            {t.admin.signOut}
          </button>
        )}
      </div>

      {access.status === 'loading' && (
        <p role="status" className="mt-5 min-h-screen text-body text-ink-muted">
          {t.admin.loading}
        </p>
      )}
      {access.status === 'anonymous' && <AdminLogin />}
      {access.status === 'denied' && <p className="mt-5 text-body text-ink">{t.admin.noAccess}</p>}
      {access.status === 'admin' && (
        <>
          <nav aria-label={ea.nav.label} className="mt-5">
            <ul className="flex flex-wrap gap-2">
              <li><NavLink end to="/admin" className={tab}>{ea.nav.home}</NavLink></li>
              <li><NavLink to="/admin/propiedades" className={tab}>{ea.nav.properties}</NavLink></li>
              <li><NavLink to="/admin/duenos" className={tab}>{ea.nav.owners}</NavLink></li>
              <li><NavLink to="/admin/cuentas" className={tab}>{ea.nav.accounts}</NavLink></li>
              <li><NavLink to="/admin/tarifas" className={tab}>{ea.nav.rates}</NavLink></li>
              <li><NavLink to="/admin/simulador" className={tab}>{ea.nav.simulator}</NavLink></li>
              <li><NavLink to="/admin/cambios" className={tab}>{ea.nav.history}</NavLink></li>
            </ul>
          </nav>
          <Routes>
            <Route index element={<><PaymentsQueue /><UpcomingArrivals /></>} />
            <Route path="propiedades" element={<PropertiesList />} />
            <Route path="propiedades/:id" element={<PropertyEditor />} />
            <Route path="duenos" element={<OwnersPage />} />
            <Route path="cuentas" element={<AccountsPage />} />
            <Route path="tarifas" element={<RatesPage />} />
            <Route path="tarifas/:id" element={<RateEditor />} />
            <Route path="simulador" element={<SimulatorPage />} />
            <Route path="cambios" element={<AuditList />} />
          </Routes>
        </>
      )}
    </section>
  )
}
