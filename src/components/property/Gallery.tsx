import { useRef, useState } from 'react'
import { ImagesIcon } from '../icons'
import { PhotoFallback } from '../PhotoFallback'
import { PhotoViewer } from './PhotoViewer'
import type { PublicPhoto } from '../../types/public'
import { t } from '../../lib/i18n'

interface Props {
  photos: PublicPhoto[]
  propertyName: string
}

// Foto principal + 2 miniaturas + "Ver N fotos". Las fotos mandan (guía):
// sin bordes ni adornos alrededor.
export function Gallery({ photos, propertyName }: Props) {
  const [viewer, setViewer] = useState({ open: false, index: 0, session: 0 })
  const openerRef = useRef<HTMLButtonElement | null>(null)

  if (photos.length === 0) {
    return (
      <div className="grid gap-3 md:grid-cols-3" role="img" aria-label={t.gallery.noPhotos}>
        <PhotoFallback className="aspect-[4/3] md:col-span-2 md:row-span-2 md:aspect-auto" />
        <PhotoFallback className="hidden aspect-[4/3] md:flex" />
        <PhotoFallback className="hidden aspect-[4/3] md:flex" />
      </div>
    )
  }

  const open = (index: number, opener: HTMLButtonElement) => {
    openerRef.current = opener
    setViewer((v) => ({ open: true, index, session: v.session + 1 }))
  }
  const close = () => {
    setViewer((v) => ({ ...v, open: false }))
    openerRef.current?.focus()
  }

  const altOf = (i: number) => photos[i].alt ?? t.gallery.photoAlt(i + 1, propertyName)
  const thumbs = photos.slice(1, 3)

  return (
    <div className="relative">
      <div className="grid gap-3 md:grid-cols-3">
        <button
          type="button"
          onClick={(e) => open(0, e.currentTarget)}
          className="overflow-hidden rounded-l md:col-span-2 md:row-span-2"
        >
          <img src={photos[0].url} alt={altOf(0)} className="aspect-[4/3] h-full w-full object-cover md:aspect-auto" />
        </button>
        {thumbs.map((photo, i) => (
          <button
            key={photo.url}
            type="button"
            onClick={(e) => open(i + 1, e.currentTarget)}
            className="hidden overflow-hidden rounded-l md:block"
          >
            <img src={photo.url} alt={altOf(i + 1)} loading="lazy" className="aspect-[4/3] h-full w-full object-cover" />
          </button>
        ))}
      </div>

      {photos.length > 1 && (
        <button
          type="button"
          onClick={(e) => open(0, e.currentTarget)}
          className="absolute right-4 bottom-4 inline-flex min-h-10 items-center gap-2 rounded-pill border border-border-control bg-surface px-5 text-button text-ink"
        >
          <ImagesIcon size={20} />
          {t.gallery.openAll(photos.length)}
        </button>
      )}

      <PhotoViewer key={viewer.session} photos={photos} propertyName={propertyName} startIndex={viewer.index} open={viewer.open} onClose={close} />
    </div>
  )
}
