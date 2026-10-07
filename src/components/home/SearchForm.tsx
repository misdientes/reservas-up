import { useId, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { buttonPrimary } from '../ui'
import { MAX_GUESTS_OPTION, toSearchParams, todayInSantiago, type StaySearch } from '../../lib/search-params'
import { t } from '../../lib/i18n'

interface Props {
  destinations: string[]
  initial: StaySearch
}

const fieldClass =
  'min-h-10 w-full rounded-m border border-border-control bg-sand-50 px-3 text-body text-ink'
const labelClass = 'text-label uppercase tracking-widest text-ink'

// Buscador: lleva al listado filtrado y deja destino, fechas y huéspedes en
// la URL (la Sesión 6 los usa en la ficha y el calendario).
export function SearchForm({ destinations, initial }: Props) {
  const navigate = useNavigate()
  const ids = { destino: useId(), llegada: useId(), salida: useId(), huespedes: useId(), error: useId() }
  const [values, setValues] = useState({
    destino: initial.destino,
    llegada: initial.llegada,
    salida: initial.salida,
    huespedes: initial.huespedes ? String(initial.huespedes) : '',
  })
  const today = todayInSantiago()
  const datesInvalid = Boolean(values.llegada && values.salida && values.salida <= values.llegada)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (datesInvalid) return
    const params = toSearchParams({
      destino: values.destino,
      llegada: values.llegada,
      salida: values.salida,
      huespedes: values.huespedes ? Number(values.huespedes) : null,
    })
    navigate({ pathname: '/', search: params.toString(), hash: 'propiedades' })
  }

  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }))

  return (
    <form
      role="search"
      aria-label={t.search.heading}
      onSubmit={onSubmit}
      noValidate
      className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-surface p-4 md:grid-cols-4 md:items-end md:p-5 compact:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
    >
      <div className="flex flex-col gap-2 col-span-full md:col-span-1">
        <label htmlFor={ids.destino} className={labelClass}>
          {t.search.destination}
        </label>
        <select id={ids.destino} className={fieldClass} value={values.destino} onChange={set('destino')}>
          <option value="">{t.search.anyDestination}</option>
          {destinations.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2 col-span-1">
        <label htmlFor={ids.llegada} className={labelClass}>
          {t.search.checkIn}
        </label>
        <input
          id={ids.llegada}
          type="date"
          className={fieldClass}
          min={today}
          value={values.llegada}
          onChange={set('llegada')}
        />
      </div>

      <div className="flex flex-col gap-2 col-span-1">
        <label htmlFor={ids.salida} className={labelClass}>
          {t.search.checkOut}
        </label>
        <input
          id={ids.salida}
          type="date"
          className={fieldClass}
          min={values.llegada || today}
          value={values.salida}
          onChange={set('salida')}
          aria-invalid={datesInvalid}
          aria-describedby={datesInvalid ? ids.error : undefined}
        />
      </div>

      <div className="flex flex-col gap-2 col-span-full md:col-span-1">
        <label htmlFor={ids.huespedes} className={labelClass}>
          {t.search.guests}
        </label>
        <select id={ids.huespedes} className={fieldClass} value={values.huespedes} onChange={set('huespedes')}>
          <option value="">—</option>
          {Array.from({ length: MAX_GUESTS_OPTION }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {t.search.guestsOption(n)}
            </option>
          ))}
        </select>
      </div>

      {datesInvalid && (
        <p id={ids.error} role="alert" className="text-body-s text-terracotta col-span-full">
          {t.search.checkOutError}
        </p>
      )}

      <div className="col-span-full md:col-span-4 md:flex md:justify-end lg:col-span-1">
        <button type="submit" className={`${buttonPrimary} w-full md:w-auto`}>
          {t.search.submit}
        </button>
      </div>
    </form>
  )
}
