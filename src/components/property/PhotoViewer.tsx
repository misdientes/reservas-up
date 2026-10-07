import { useEffect, useRef, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from '../icons'
import type { PublicPhoto } from '../../types/public'
import { t } from '../../lib/i18n'

interface Props {
  photos: PublicPhoto[]
  propertyName: string
  startIndex: number
  open: boolean
  onClose: () => void
}

// Visor de fotos con <dialog> nativo: showModal() deja el resto de la página
// inerte (foco atrapado) y Escape lo cierra. Flechas ← → cambian de foto.
export function PhotoViewer({ photos, propertyName, startIndex, open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [index, setIndex] = useState(startIndex)

  // El visor se vuelve a montar en cada apertura (key en Gallery), así
  // empieza en la foto elegida sin sincronizar estado en un efecto.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  const total = photos.length
  const go = (step: number) => setIndex((current) => (current + step + total) % total)
  const photo = photos[index]

  return (
    <dialog
      ref={dialogRef}
      aria-label={t.gallery.dialogLabel(propertyName)}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(1)
        if (event.key === 'ArrowLeft') go(-1)
      }}
      className="m-auto h-full max-h-full w-full max-w-full bg-ink p-0 text-sand-100 backdrop:bg-ink"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <p aria-live="polite" className="text-body-s">
            {t.gallery.counter(index + 1, total)}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.gallery.close}
            autoFocus
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-pill border border-sand-100 text-sand-100"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="relative flex flex-1 items-center justify-center px-5 pb-5">
          {photo && (
            <img
              src={photo.url}
              alt={photo.alt ?? t.gallery.photoAlt(index + 1, propertyName)}
              className="max-h-full max-w-full rounded-l object-contain"
            />
          )}
          {total > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label={t.gallery.previous}
                className="absolute top-1/2 left-5 inline-flex min-h-10 min-w-10 -translate-y-1/2 items-center justify-center rounded-pill bg-ink text-sand-100"
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label={t.gallery.next}
                className="absolute top-1/2 right-5 inline-flex min-h-10 min-w-10 -translate-y-1/2 items-center justify-center rounded-pill bg-ink text-sand-100"
              >
                <ChevronRightIcon />
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  )
}
