import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { supabase } from '../../lib/supabase'
import { Field } from '../../components/checkout/Field'
import { buttonSecondary } from '../../components/ui'
import { ArrowLeftIcon } from '../../components/icons'
import { errorMessage, isStale, type OwnerRow, type RateGroupFull } from '../api'
import { SaveBar, Section, Select } from '../ui'
import { AuditList } from '../AuditList'
import { dowFromDb, dowToDb, parseClp, validateRate, type RateValues } from './rules'
import { DowInputs } from './DowInputs'
import { DiscountsSection } from './DiscountsSection'
import { SeasonsSection } from './SeasonsSection'
import { ea } from '../../lib/i18n/es-admin'

// Ficha de una tarifa: precios, descuentos, temporadas e historial. Cada
// parte guarda por separado; la base valida todo (límites, prioridad,
// fechas) y nunca toca reservas ya creadas.

function fromRow(g: RateGroupFull | null): RateValues {
  return {
    name: g?.name ?? '',
    base: g ? String(g.base_nightly_gross_clp) : '',
    dow: dowFromDb(g?.dow_gross_clp ?? null),
    cleaning: g ? String(g.cleaning_fee_gross_clp) : '0',
    includedGuests: g ? String(g.included_guests) : '2',
    extraGuest: g ? String(g.extra_guest_gross_clp) : '0',
    minNights: g?.min_nights ? String(g.min_nights) : '',
  }
}

export function RateEditor() {
  const { id = '' } = useParams()
  const isNew = id === 'nueva'
  const [group, setGroup] = useState<RateGroupFull | null>(null)
  const [error, setError] = useState(false)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    if (isNew) return
    let cancelled = false
    supabase.from('rate_groups').select('*').eq('id', id).single().then(({ data, error: e }) => {
      if (cancelled) return
      if (e) return setError(true)
      setGroup(data as RateGroupFull)
    })
    return () => {
      cancelled = true
    }
  }, [id, isNew, version])

  if (error) return <p role="alert" className="mt-7 text-body text-ink">{ea.common.loadError}</p>
  if (!isNew && !group) return <p className="mt-7 min-h-screen text-body text-ink-muted">{ea.common.loading}</p>

  return (
    <div className="mt-7 flex flex-col gap-5">
      <Link to="/admin/tarifas" className="inline-flex min-h-10 items-center gap-2 self-start text-body-s text-ink hover:text-pacific">
        <ArrowLeftIcon size={20} />
        {ea.rates.heading}
      </Link>
      <h2 className="font-display text-heading text-ink">{isNew ? ea.rates.new : group!.name}</h2>
      <Section id="tarifa" title={ea.rates.heading}>
        <RateForm key={`r-${version}`} group={group} onSaved={setGroup} onReload={reload} />
      </Section>
      {group && (
        <>
          <Section id="descuentos" title={ea.discounts.heading}>
            <DiscountsSection key={`d-${version}`} groupId={group.id} />
          </Section>
          <Section id="temporadas" title={ea.seasons.heading}>
            <SeasonsSection key={`s-${version}`} groupId={group.id} />
          </Section>
          <Section id="cambios" title={ea.properties.sections.history} defaultOpen={false}>
            <AuditList key={`h-${version}-${group.updated_at}`} recordId={group.id} limit={20} />
          </Section>
        </>
      )}
    </div>
  )
}

function RateForm({ group, onSaved, onReload }: { group: RateGroupFull | null; onSaved: (g: RateGroupFull) => void; onReload: () => void }) {
  const id = useId()
  const navigate = useNavigate()
  const [v, setV] = useState<RateValues>(() => fromRow(group))
  const [ownerId, setOwnerId] = useState('')
  const [owners, setOwners] = useState<Pick<OwnerRow, 'id' | 'legal_name'>[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [stale, setStale] = useState(false)

  useEffect(() => {
    if (group) return
    supabase.from('owners').select('id, legal_name').order('legal_name').then(({ data }) => {
      setOwners(data ?? [])
      if (data?.length) setOwnerId(data[0].id)
    })
  }, [group])

  const set = (k: keyof RateValues) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }))

  async function save(event: FormEvent) {
    event.preventDefault()
    const e = validateRate(v)
    setErrors(e)
    if (Object.keys(e).length) return setMessage({ ok: false, text: ea.common.genericError })
    setSaving(true)
    const values = {
      name: v.name.trim(),
      base_nightly_gross_clp: parseClp(v.base),
      dow_gross_clp: dowToDb(v.dow),
      cleaning_fee_gross_clp: parseClp(v.cleaning) ?? 0,
      included_guests: Number(v.includedGuests),
      extra_guest_gross_clp: parseClp(v.extraGuest) ?? 0,
      min_nights: v.minNights.trim() === '' ? null : Number(v.minNights),
    }
    const { data, error } = group
      ? await supabase.from('rate_groups').update({ ...values, updated_at: group.updated_at }).eq('id', group.id).select('*').single()
      : await supabase.from('rate_groups').insert({ ...values, owner_id: ownerId }).select('*').single()
    setSaving(false)
    setStale(isStale(error))
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    if (!group) return navigate(`/admin/tarifas/${(data as RateGroupFull).id}`, { replace: true })
    onSaved(data as RateGroupFull)
    setV(fromRow(data as RateGroupFull))
    setMessage({ ok: true, text: ea.common.saved })
  }

  async function remove() {
    if (!group || !window.confirm(ea.rates.deleteConfirm)) return
    const { error } = await supabase.from('rate_groups').delete().eq('id', group.id)
    if (error) return setMessage({ ok: false, text: error.code === '23503' ? ea.rates.inUse : errorMessage(error) })
    navigate('/admin/tarifas', { replace: true })
  }

  const r = ea.rates
  const err = (k: string) => (errors[k] ? (errors[k] === 'price' ? r.priceError : errors[k] === 'name' ? r.nameError : r.rangeError) : null)
  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-5">
      {!group && (
        <Select id={`${id}-owner`} label={r.owner} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.legal_name}</option>)}
        </Select>
      )}
      <Field id={`${id}-name`} label={r.name} required maxLength={80} value={v.name} onChange={set('name')} error={err('name')} />
      <Field id={`${id}-base`} label={r.base} hint={r.priceHint} required inputMode="numeric" value={v.base} onChange={set('base')} error={err('base')} />
      <DowInputs idPrefix={`${id}-dow`} legend={r.dowHeading} hint={r.dowHint} values={v.dow} errors={errors}
        onChange={(dow) => setV((s) => ({ ...s, dow }))} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={`${id}-clean`} label={r.cleaning} inputMode="numeric" value={v.cleaning} onChange={set('cleaning')} error={err('cleaning')} />
        <Field id={`${id}-min`} label={r.minNights} hint={r.minNightsHint} type="number" inputMode="numeric" min={1} max={60}
          value={v.minNights} onChange={set('minNights')} error={err('minNights')} />
        <Field id={`${id}-incl`} label={r.includedGuests} type="number" inputMode="numeric" min={1} max={30}
          value={v.includedGuests} onChange={set('includedGuests')} error={err('includedGuests')} />
        <Field id={`${id}-extra`} label={r.extraGuest} inputMode="numeric" value={v.extraGuest} onChange={set('extraGuest')} error={err('extraGuest')} />
      </div>
      <SaveBar saving={saving} message={message} stale={stale} onReload={onReload} label={group ? ea.common.save : r.create} />
      {group && <button type="button" className={`${buttonSecondary} self-start`} onClick={remove}>{ea.common.delete}</button>}
    </form>
  )
}
