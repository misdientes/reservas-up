import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Brand } from './Brand'
import { ChatIcon, CloseIcon, MenuIcon } from './icons'
import { container } from './ui'
import { useSiteData } from '../lib/site-data-context'
import { whatsappUrl } from '../lib/whatsapp'
import { t } from '../lib/i18n'

const NAV = [
  { to: '/#propiedades', label: t.layout.navProperties },
  { to: '/#reserva-directo', label: t.layout.navDirect },
  { to: '/#por-trabajo', label: t.layout.navWork },
]

export function SiteHeader() {
  const { settings } = useSiteData()
  const whatsapp = whatsappUrl(settings)
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)

  // Escape cierra el menú y devuelve el foco al botón que lo abrió.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const linkClass = 'inline-flex min-h-10 items-center text-body-s text-ink hover:text-pacific'

  return (
    <header className="border-b border-line bg-sand-100">
      <div className={`${container} flex min-h-10 items-center justify-between gap-4 py-3`}>
        <Link to="/" aria-label={t.layout.brandHomeLabel} className="inline-flex min-h-10 items-center rounded-m">
          <Brand />
        </Link>

        <nav aria-label={t.layout.navLabel} className="hidden md:block">
          <ul className="flex items-center gap-7">
            {NAV.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className={linkClass}>
                  {item.label}
                </Link>
              </li>
            ))}
            {whatsapp && (
              <li>
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${linkClass} gap-2`}>
                  <ChatIcon size={20} />
                  {t.layout.navWhatsapp}
                </a>
              </li>
            )}
          </ul>
        </nav>

        <button
          ref={toggleRef}
          type="button"
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-pill border border-border-control text-ink md:hidden"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? t.layout.menuClose : t.layout.menuOpen}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      <nav id={menuId} aria-label={t.layout.navLabel} hidden={!open} className="border-t border-line md:hidden">
        <ul className={`${container} flex flex-col py-2`}>
          {NAV.map((item) => (
            <li key={item.to} className="border-b border-line last:border-b-0">
              <Link to={item.to} className={`${linkClass} w-full text-body`} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            </li>
          ))}
          {whatsapp && (
            <li>
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className={`${linkClass} w-full gap-2 text-body`}
                onClick={() => setOpen(false)}
              >
                <ChatIcon size={20} />
                {t.layout.navWhatsapp}
              </a>
            </li>
          )}
        </ul>
      </nav>
    </header>
  )
}
