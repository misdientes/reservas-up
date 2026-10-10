import { useEffect, useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Field } from '../../components/checkout/Field'
import { buttonSecondary } from '../../components/ui'
import { CloseIcon } from '../../components/icons'
import { errorMessage, isStale, type PropertyRow } from '../api'
import { validatePropertyPublic } from '../validation'
import { Check, SaveBar, Select, TextArea } from '../ui'
import { ea } from '../../lib/i18n/es-admin'

type Values = Pick<PropertyRow,
  'name' | 'slug' | 'property_type' | 'city' | 'neighborhood' | 'region' | 'description' | 'house_rules' | 'self_check_in' | 'amenities'> & {
  max_guests: string; bedrooms: string; beds: string; bathrooms: string
  check_in_time: string; check_out_time: string; min_nights: string; min_advance_hours: string
}

const str = (n: number | null) => (n === null || n === undefined ? '' : String(n))
const num = (s: string) => (s.trim() === '' ? null : Number(s))

function fromRow(p: PropertyRow): Values {
  return {
    name: p.name, slug: p.slug, property_type: p.property_type, city: p.city, neighborhood: p.neighborhood, region: p.region,
    description: p.description, house_rules: p.house_rules, self_check_in: p.self_check_in, amenities: p.amenities,
    max_guests: str(p.max_guests), bedrooms: str(p.bedrooms), beds: str(p.beds), bathrooms: str(p.bathrooms),
    check_in_time: p.check_in_time?.slice(0, 5) ?? '', check_out_time: p.check_out_time?.slice(0, 5) ?? '',
    min_nights: str(p.min_nights), min_advance_hours: str(p.min_advance_hours),
  }
}

export function PublicSection({ property, onSaved, onReload }: { property: PropertyRow; onSaved: (p: PropertyRow) => void; onReload: () => void }) {
  const id = useId()
  const [v, setV] = useState<Values>(() => fromRow(property))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [stale, setStale] = useState(false)
  const [vocabulary, setVocabulary] = useState<string[]>([])
  const [amenity, setAmenity] = useState('')
  const slugLocked = property.first_published_at !== null

  useEffect(() => {
    supabase.rpc('amenity_vocabulary').then(({ data }) => setVocabulary((data as string[]) ?? []))
  }, [])

  const set = <K extends keyof Values>(key: K) => (value: Values[K]) => setV((s) => ({ ...s, [key]: value }))
  const input = (key: keyof Values) => (e: { target: { value: string } }) => set(key)(e.target.value as never)

  function addAmenity(label: string) {
    const clean = label.trim()
    if (!clean) return
    const match = vocabulary.find((x) => x.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, '') === clean.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, ''))
    const final = match ?? clean
    if (!v.amenities.some((a) => a.toLowerCase() === final.toLowerCase())) set('amenities')([...v.amenities, final])
    setAmenity('')
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const e = validatePropertyPublic({ ...v }) as Record<string, string>
    setErrors(e)
    if (Object.keys(e).length) return setMessage({ ok: false, text: ea.common.genericError })
    setSaving(true)
    const patch = {
      name: v.name.trim(), property_type: v.property_type, city: v.city.trim(), neighborhood: v.neighborhood?.trim() || null,
      region: v.region?.trim() || null, description: v.description?.trim() || null, house_rules: v.house_rules?.trim() || null,
      self_check_in: v.self_check_in, amenities: v.amenities, max_guests: num(v.max_guests), bedrooms: num(v.bedrooms),
      beds: num(v.beds), bathrooms: num(v.bathrooms), check_in_time: v.check_in_time || null, check_out_time: v.check_out_time || null,
      min_nights: num(v.min_nights), min_advance_hours: num(v.min_advance_hours),
      ...(slugLocked ? {} : { slug: v.slug }),
      updated_at: property.updated_at, // concurrencia optimista
    }
    const { data, error } = await supabase.from('properties').update(patch).eq('id', property.id).select('*').single()
    setSaving(false)
    setStale(isStale(error))
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    onSaved(data as PropertyRow)
    setV(fromRow(data as PropertyRow))
    setMessage({ ok: true, text: ea.common.saved })
  }

  const f = ea.properties.fields
  const rangeMsg = (k: string) => (errors[k] ? ea.common.genericError : null)
  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-5">
      <Field id={`${id}-name`} label={f.name} required maxLength={100} value={v.name} onChange={input('name')} error={errors.name ? ea.common.required : null} />
      <Field id={`${id}-slug`} label={f.slug} hint={slugLocked ? f.slugLocked : f.slugHint} maxLength={60} value={v.slug} readOnly={slugLocked}
        onChange={input('slug')} error={errors.slug ? f.slugHint : null} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Select id={`${id}-type`} label={f.type} value={v.property_type} onChange={(e) => set('property_type')(e.target.value as Values['property_type'])}>
          {Object.entries(f.types).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </Select>
        <Field id={`${id}-city`} label={f.city} required maxLength={80} value={v.city} onChange={input('city')} error={errors.city ? ea.common.required : null} />
        <Field id={`${id}-nb`} label={f.neighborhood} maxLength={80} value={v.neighborhood ?? ''} onChange={input('neighborhood')} />
        <Field id={`${id}-region`} label={f.region} maxLength={80} value={v.region ?? ''} onChange={input('region')} />
        <Field id={`${id}-guests`} label={f.maxGuests} type="number" inputMode="numeric" min={1} max={30} value={v.max_guests} onChange={input('max_guests')} error={rangeMsg('max_guests')} />
        <Field id={`${id}-bedrooms`} label={f.bedrooms} type="number" inputMode="numeric" min={0} value={v.bedrooms} onChange={input('bedrooms')} />
        <Field id={`${id}-beds`} label={f.beds} type="number" inputMode="numeric" min={0} value={v.beds} onChange={input('beds')} />
        <Field id={`${id}-baths`} label={f.bathrooms} type="number" inputMode="numeric" min={0} value={v.bathrooms} onChange={input('bathrooms')} />
        <Field id={`${id}-in`} label={f.checkIn} type="time" value={v.check_in_time} onChange={input('check_in_time')} />
        <Field id={`${id}-out`} label={f.checkOut} type="time" value={v.check_out_time} onChange={input('check_out_time')} />
        <Field id={`${id}-nights`} label={f.minNights} type="number" inputMode="numeric" min={1} max={60} value={v.min_nights} onChange={input('min_nights')} error={rangeMsg('min_nights')} />
        <Field id={`${id}-adv`} label={f.minAdvance} type="number" inputMode="numeric" min={0} max={720} value={v.min_advance_hours} onChange={input('min_advance_hours')} error={rangeMsg('min_advance_hours')} />
      </div>
      <Check label={f.selfCheckIn} checked={v.self_check_in} onChange={set('self_check_in')} />
      <TextArea id={`${id}-desc`} label={f.description} maxLength={5000} value={v.description ?? ''} onChange={input('description')} />
      <TextArea id={`${id}-rules`} label={f.houseRules} maxLength={3000} rows={4} value={v.house_rules ?? ''} onChange={input('house_rules')} />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-label uppercase tracking-widest text-ink">{f.amenities}</legend>
        <ul className="flex flex-wrap gap-2">
          {v.amenities.map((a) => (
            <li key={a} className="inline-flex items-center gap-2 rounded-pill border border-line bg-sand-50 pl-4 text-body-s text-ink">
              {a}
              <button type="button" className="inline-flex size-10 items-center justify-center rounded-pill hover:bg-sand-100"
                aria-label={f.amenityRemove(a)} onClick={() => set('amenities')(v.amenities.filter((x) => x !== a))}>
                <CloseIcon size={20} />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-3">
          <Field id={`${id}-amenity`} label={f.amenityAdd} hint={f.amenitiesHint} list={`${id}-vocab`} value={amenity} maxLength={60}
            onChange={(e) => setAmenity(e.target.value)} className="min-w-0 flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAmenity(amenity) } }} />
          <button type="button" className={buttonSecondary} onClick={() => addAmenity(amenity)}>{f.amenityAdd}</button>
        </div>
        <datalist id={`${id}-vocab`}>
          {vocabulary.filter((x) => !v.amenities.includes(x)).map((x) => <option key={x} value={x} />)}
        </datalist>
      </fieldset>

      <SaveBar saving={saving} message={message} stale={stale} onReload={onReload} />
    </form>
  )
}
