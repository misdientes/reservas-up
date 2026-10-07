import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeftIcon, ShareIcon } from '../icons'
import { buttonSecondary, container } from '../ui'
import { t } from '../../lib/i18n'

interface Props {
  backHref: string
  title: string
}

// Volver (conserva destino, fechas y huéspedes) y compartir. Si el
// navegador no tiene la hoja de compartir, copia el enlace y avisa.
export function PropertyTopBar({ backHref, title }: Props) {
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function share() {
    const url = window.location.href
    if (navigator.share) {
      try {
        await navigator.share({ title, url })
      } catch {
        // El usuario canceló: no es un error que mostrar.
      }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setNotice(t.property.shareCopied)
    } catch {
      setNotice(t.property.shareFailed)
    }
  }

  return (
    <div className={`${container} flex items-center justify-between gap-3 py-4`}>
      <Link to={backHref} className="inline-flex min-h-10 items-center gap-2 rounded-pill text-body-s text-ink hover:text-pacific">
        <ArrowLeftIcon size={20} />
        {t.property.back}
      </Link>
      <div className="flex items-center gap-3">
        <p role="status" aria-live="polite" className="text-body-s text-ink-muted">
          {notice}
        </p>
        <button type="button" onClick={share} className={`${buttonSecondary} px-5`}>
          <ShareIcon size={20} />
          {t.property.share}
        </button>
      </div>
    </div>
  )
}
