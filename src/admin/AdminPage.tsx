import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { buttonSecondary, container, usePageTitle } from '../components/ui'
import { AdminLogin } from './AdminLogin'
import { PaymentsQueue } from './PaymentsQueue'
import { UpcomingArrivals } from './UpcomingArrivals'
import { t } from '../lib/i18n'

// Panel mínimo (Sesión 10a): solo el admin. Acceso con enlace mágico de
// Supabase Auth (sin contraseñas; el registro público está cerrado). El rol
// se lee de app_users (RLS: cada usuario ve solo su perfil) y además cada
// función del panel vuelve a exigir is_admin() en la base.

type Access = { status: 'loading' } | { status: 'anonymous' } | { status: 'denied' } | { status: 'admin'; session: Session }

export function AdminPage() {
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
          <PaymentsQueue />
          <UpcomingArrivals />
        </>
      )}
    </section>
  )
}
