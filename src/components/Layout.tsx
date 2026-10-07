import { NavLink, Outlet } from 'react-router'
import { t } from '../lib/i18n'

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-800">
      <header className="border-b border-slate-200">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <NavLink to="/" className="text-lg font-semibold">
            {t.layout.brandFallback}
          </NavLink>
          <div className="flex gap-4 text-sm">
            <NavLink to="/" end className={navClass}>
              {t.layout.navHome}
            </NavLink>
            <NavLink to="/admin" className={navClass}>
              {t.layout.navAdmin}
            </NavLink>
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200">
        <p className="mx-auto max-w-5xl px-4 py-6 text-sm text-slate-500">{t.layout.footer}</p>
      </footer>
    </div>
  )
}

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'font-medium text-slate-900' : 'text-slate-500 hover:text-slate-900'
}
