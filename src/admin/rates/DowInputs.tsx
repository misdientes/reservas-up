import { FieldError, fieldClass, labelClass } from '../../components/checkout/Field'
import { ea } from '../../lib/i18n/es-admin'

// 7 precios opcionales, de lunes a domingo (vacío = precio base o de la
// temporada). Errores por posición: errors.dow0 … errors.dow6.
export function DowInputs({ idPrefix, legend, hint, values, errors, onChange, placeholder }: {
  idPrefix: string
  legend: string
  hint: string
  values: string[]
  errors: Record<string, string>
  onChange: (values: string[]) => void
  placeholder?: string
}) {
  const hasError = values.some((_, i) => errors[`dow${i}`])
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className={labelClass}>{legend}</legend>
      <p id={`${idPrefix}-ayuda`} className="text-body-s text-ink-muted">{hint}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {ea.weekdays.map((day, i) => (
          <div key={day} className="flex flex-col gap-2">
            <label htmlFor={`${idPrefix}-${i}`} className="text-body-s text-ink">{day}</label>
            <input id={`${idPrefix}-${i}`} inputMode="numeric" value={values[i]} placeholder={placeholder}
              aria-invalid={errors[`dow${i}`] ? true : undefined} aria-describedby={`${idPrefix}-ayuda`}
              onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
              className={`${fieldClass} ${errors[`dow${i}`] ? 'border-danger' : 'border-border-control'}`} />
          </div>
        ))}
      </div>
      <FieldError message={hasError ? ea.rates.priceError : null} />
    </fieldset>
  )
}
