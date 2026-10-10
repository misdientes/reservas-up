import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { supabase } from '../../lib/supabase'
import { Field } from '../../components/checkout/Field'
import { buttonPrimary, buttonSecondary } from '../../components/ui'
import { errorMessage, photoUrl, type OwnerRow, type PropertyRow } from '../api'
import { slugify, validatePropertyPublic } from '../validation'
import { Select } from '../ui'
import { ea } from '../../lib/i18n/es-admin'

// Lista de propiedades: portada, estado y cuánto falta para publicar.

interface Item {
  property: Pick<PropertyRow, 'id' | 'name' | 'city' | 'status' | 'slug'>
  cover: string | null
  missing: string[]
}

export function PropertiesList() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: e } = await supabase.from('properties').select('id, name, city, status, slug').order('name')
      if (e) return !cancelled && setError(true)
      const list = await Promise.all(
        (data ?? []).map(async (property) => {
          const [{ data: cover }, { data: missing }] = await Promise.all([
            supabase.from('property_photos').select('storage_path').eq('property_id', property.id).eq('is_cover', true).maybeSingle(),
            supabase.rpc('property_publish_check', { p_property_id: property.id }),
          ])
          return { property, cover: cover ? photoUrl(cover.storage_path) : null, missing: (missing as string[]) ?? [] } as Item
        }),
      )
      if (!cancelled) setItems(list)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mt-7 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-heading-s text-ink">{ea.properties.heading}</h2>
        {!creating && (
          <button type="button" className={buttonPrimary} onClick={() => setCreating(true)}>
            {ea.properties.new}
          </button>
        )}
      </div>
      {creating && <CreateProperty onCancel={() => setCreating(false)} />}
      {error && <p role="alert" className="text-body text-ink">{ea.common.loadError}</p>}
      {items === null && !error && <p className="text-body text-ink-muted">{ea.common.loading}</p>}
      {items?.length === 0 && <p className="text-body text-ink-muted">{ea.properties.empty}</p>}
      <ul className="grid gap-4 md:grid-cols-2">
        {items?.map(({ property, cover, missing }) => (
          <li key={property.id}>
            <Link to={`/admin/propiedades/${property.id}`} className="flex gap-4 rounded-xl border border-line bg-surface p-4 hover:bg-sand-50">
              <div className="aspect-square w-1/4 shrink-0 overflow-hidden rounded-l bg-sand-100">
                {cover ? <img src={cover} alt="" className="size-full object-cover" /> : <span className="sr-only">{ea.properties.noCover}</span>}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <p className="text-title text-ink">{property.name}</p>
                <p className="text-body-s text-ink-muted">{property.city} · {ea.properties.status[property.status]}</p>
                <p className={`text-body-s ${missing.length ? 'text-danger' : 'text-pacific'}`}>
                  {missing.length ? ea.properties.missingCount(missing.length) : property.status === 'publicada' ? ea.properties.complete : ea.properties.readyToPublish}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CreateProperty({ onCancel }: { onCancel: () => void }) {
  const id = useId()
  const navigate = useNavigate()
  const [owners, setOwners] = useState<Pick<OwnerRow, 'id' | 'legal_name'>[]>([])
  const [values, setValues] = useState({ name: '', slug: '', city: '', owner_id: '' })
  const [slugTouched, setSlugTouched] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('owners').select('id, legal_name').order('legal_name').then(({ data }) => {
      setOwners(data ?? [])
      if (data?.length === 1) setValues((v) => ({ ...v, owner_id: data[0].id }))
    })
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const e = validatePropertyPublic({ ...values, max_guests: null, min_nights: 1, min_advance_hours: 24, description: null }) as Record<string, string>
    if (!values.owner_id) e.owner_id = 'required'
    setErrors(e)
    if (Object.keys(e).length) return
    const { data, error } = await supabase
      .from('properties')
      .insert({ name: values.name.trim(), slug: values.slug, city: values.city.trim(), owner_id: values.owner_id, status: 'borrador' })
      .select('id')
      .single()
    if (error) return setMessage(errorMessage(error))
    navigate(`/admin/propiedades/${data.id}`)
  }

  const err = (k: string) => (errors[k] ? ea.common.required : null)
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-border-control bg-sand-50 p-5">
      <h3 className="text-title text-ink">{ea.properties.createHeading}</h3>
      <p className="text-body-s text-ink-muted">{ea.properties.createIntro}</p>
      <Field id={`${id}-name`} label={ea.properties.fields.name} required maxLength={100} value={values.name} error={err('name')}
        onChange={(e) => setValues((v) => ({ ...v, name: e.target.value, slug: slugTouched ? v.slug : slugify(e.target.value) }))} />
      <Field id={`${id}-slug`} label={ea.properties.fields.slug} hint={ea.properties.fields.slugHint} required maxLength={60} value={values.slug}
        error={errors.slug ? ea.properties.fields.slugHint : null}
        onChange={(e) => { setSlugTouched(true); setValues((v) => ({ ...v, slug: e.target.value })) }} />
      <Field id={`${id}-city`} label={ea.properties.fields.city} required maxLength={80} value={values.city} error={err('city')}
        onChange={(e) => setValues((v) => ({ ...v, city: e.target.value }))} />
      <Select id={`${id}-owner`} label={ea.owners.legalName} value={values.owner_id} onChange={(e) => setValues((v) => ({ ...v, owner_id: e.target.value }))}>
        <option value="">{ea.common.none}</option>
        {owners.map((o) => <option key={o.id} value={o.id}>{o.legal_name}</option>)}
      </Select>
      {errors.owner_id && <p className="text-body-s text-danger">{ea.common.required}</p>}
      <p role="status" className="text-body-s text-danger">{message}</p>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={buttonPrimary}>{ea.properties.create}</button>
        <button type="button" className={buttonSecondary} onClick={onCancel}>{ea.common.cancel}</button>
      </div>
    </form>
  )
}
