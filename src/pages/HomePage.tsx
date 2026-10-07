import { useEffect, useMemo, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { Hero } from '../components/home/Hero'
import { SearchForm } from '../components/home/SearchForm'
import { DestinationFilters } from '../components/home/DestinationFilters'
import { PropertyCard } from '../components/home/PropertyCard'
import { DirectBlock } from '../components/home/DirectBlock'
import { WorkBlock } from '../components/home/WorkBlock'
import { EmptyState } from '../components/home/EmptyState'
import { buttonSecondary, container, textLink, usePageTitle } from '../components/ui'
import { useSiteData } from '../lib/site-data-context'
import { readStaySearch, toSearchParams } from '../lib/search-params'
import { t } from '../lib/i18n'

export function HomePage() {
  usePageTitle(t.meta.homeTitle)
  const { properties, reload } = useSiteData()
  const [params] = useSearchParams()
  const search = readStaySearch(params)
  const location = useLocation()
  const listingHeading = useRef<HTMLHeadingElement>(null)

  const all = useMemo(() => (properties.status === 'ok' ? properties.properties : []), [properties])

  // Destinos desde los datos: ciudades únicas de las propiedades publicadas.
  const destinations = useMemo(
    () => [...new Set(all.map((p) => p.city))].sort((a, b) => a.localeCompare(b, 'es')),
    [all],
  )

  // Las fechas no filtran todavía (la disponibilidad llega en la Sesión 6).
  // Si falta la capacidad de una propiedad, se muestra igual.
  const visible = all.filter(
    (p) =>
      (!search.destino || p.city === search.destino) &&
      (!search.huespedes || p.max_guests === null || p.max_guests >= search.huespedes),
  )

  // Fechas y huéspedes viajan a la ficha de cada propiedad.
  const stayQuery = toSearchParams({ llegada: search.llegada, salida: search.salida, huespedes: search.huespedes }).toString()

  // Al buscar o filtrar (#propiedades), lleva la vista y el foco al listado.
  useEffect(() => {
    if (location.hash !== '#propiedades' || properties.status !== 'ok') return
    const section = document.getElementById('propiedades')
    section?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    listingHeading.current?.focus({ preventScroll: true })
  }, [location.hash, location.search, properties.status])

  const isEmpty = properties.status === 'ok' && all.length === 0

  // Mientras cargan los datos solo se muestra el hero y un espacio de una
  // pantalla: lo que llega después (buscador o estado vacío) se agrega sin
  // mover nada visible, sea cual sea el resultado (evita saltos de diseño).
  if (properties.status === 'loading') {
    return (
      <div className="flex flex-col gap-10 pb-10">
        <Hero />
        <p className={`${container} min-h-screen text-body text-ink-muted`} role="status">
          {t.listing.loading}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-10 pb-10">
      <Hero />

      {!isEmpty && (
        <div className={container}>
          <SearchForm key={params.toString()} destinations={destinations} initial={search} />
        </div>
      )}

      <section id="propiedades" aria-labelledby="listing-title" className={`${container} scroll-mt-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2
            id="listing-title"
            ref={listingHeading}
            tabIndex={-1}
            className="font-display text-heading-s text-ink focus:outline-none md:text-heading"
          >
            {t.listing.heading}
          </h2>
          {properties.status === 'ok' && !isEmpty && (
            <p className="text-body-s text-ink-muted" aria-live="polite">
              {t.listing.resultsCount(visible.length)}
            </p>
          )}
        </div>

        <div className="mt-5">
          {properties.status === 'error' && (
            <div className="flex flex-col items-start gap-4 rounded-xl border border-line bg-sand-50 p-7" role="alert">
              <p className="text-body text-ink">{t.listing.loadError}</p>
              <button type="button" className={buttonSecondary} onClick={reload}>
                {t.listing.retry}
              </button>
            </div>
          )}

          {isEmpty && <EmptyState />}

          {properties.status === 'ok' && !isEmpty && (
            <>
              <DestinationFilters destinations={destinations} search={search} />
              {visible.length > 0 ? (
                <ul className="mt-7 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
                  {visible.map((property) => (
                    <li key={property.id}>
                      <PropertyCard property={property} stayQuery={stayQuery} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-7 text-body text-ink-muted">
                  {t.listing.noMatches}{' '}
                  <a href="/#propiedades" className={textLink}>
                    {t.listing.clearFilters}
                  </a>
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <DirectBlock />
      <WorkBlock />
    </div>
  )
}
