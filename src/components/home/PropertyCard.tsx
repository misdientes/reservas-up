import { Link } from 'react-router'
import { UsersIcon } from '../icons'
import { PhotoFallback } from '../PhotoFallback'
import { eyebrow } from '../ui'
import type { PublicProperty } from '../../types/public'
import { t } from '../../lib/i18n'

interface Props {
  property: PublicProperty
  // Destino, fechas y huéspedes de la búsqueda, para que la ficha (Sesión 6) los reciba.
  stayQuery: string
}

export function PropertyCard({ property, stayQuery }: Props) {
  const place = [property.city, property.neighborhood].filter(Boolean).join(' · ')
  const href = `/propiedades/${property.slug}${stayQuery ? `?${stayQuery}` : ''}`

  return (
    <article className="relative flex flex-col gap-3 rounded-l has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-pacific">
      {property.cover ? (
        <img
          src={property.cover.url}
          alt={property.cover.alt ?? t.card.photoAlt(property.name)}
          loading="lazy"
          decoding="async"
          className="aspect-[4/3] w-full rounded-l object-cover"
        />
      ) : (
        <PhotoFallback className="aspect-[4/3] w-full" />
      )}

      <div className="flex flex-col gap-2">
        <p className={eyebrow}>{place}</p>
        <h3 className="text-title text-ink">
          {/* El enlace cubre toda la tarjeta (área clicable grande, un solo tabulador). */}
          <Link
            to={href}
            className="after:absolute after:inset-0 after:rounded-l hover:text-pacific focus-visible:outline-none"
          >
            {property.name}
          </Link>
        </h3>
        {property.max_guests && (
          <p className="inline-flex items-center gap-2 text-body-s text-ink-muted">
            <UsersIcon size={20} />
            {t.card.capacity(property.max_guests)}
          </p>
        )}
        <p className="border-t border-line pt-3 text-body-s text-ink">{t.card.priceFallback}</p>
      </div>
    </article>
  )
}
