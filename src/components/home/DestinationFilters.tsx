import { Link } from 'react-router'
import { toSearchParams, type StaySearch } from '../../lib/search-params'
import { t } from '../../lib/i18n'

interface Props {
  destinations: string[]
  search: StaySearch
}

// Chips por destino, generados desde las ciudades de las propiedades
// publicadas (nada fijo en el código: mañana aparecerá La Huayca sola).
export function DestinationFilters({ destinations, search }: Props) {
  const options = [{ value: '', label: t.listing.allDestinations }, ...destinations.map((city) => ({ value: city, label: city }))]

  return (
    <nav aria-label={t.listing.filtersLabel}>
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = search.destino === option.value
          const params = toSearchParams({ ...search, destino: option.value })
          return (
            <li key={option.value || 'todos'}>
              <Link
                to={{ pathname: '/', search: params.toString(), hash: 'propiedades' }}
                replace
                aria-current={active ? 'true' : undefined}
                className={
                  'inline-flex min-h-10 items-center rounded-pill border px-5 text-body-s ' +
                  (active
                    ? 'border-pacific bg-pacific text-surface'
                    : 'border-border-control text-ink hover:bg-sand-50')
                }
              >
                {option.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
