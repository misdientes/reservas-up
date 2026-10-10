import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Field } from '../../components/checkout/Field'
import { buttonPrimary, buttonSecondary } from '../../components/ui'
import { errorMessage, isStale, type OwnerRow } from '../api'
import { validateOwner } from '../validation'
import { Check, SaveBar, Select, TextArea } from '../ui'
import { ea } from '../../lib/i18n/es-admin'

// Dueños: alta y edición. RUT validado en el formulario y en la base. No se
// borra un dueño en uso (la base lo impide con sus llaves foráneas).

const EMPTY: Omit<OwnerRow, 'id' | 'updated_at'> = {
  kind: 'empresa', legal_name: '', rut: '', email: null, phone: null, vat_applies: true,
  apply_avaluo_rebate: false, avaluo_rebate_rate: 0.11, avaluo_rebate_mode: 'precio_fijo', notes: null,
}

export function OwnersPage() {
  const [owners, setOwners] = useState<(OwnerRow & { properties: number })[] | null>(null)
  const [editing, setEditing] = useState<OwnerRow | 'new' | null>(null)

  const load = useCallback(async () => {
    const [{ data }, { data: props }] = await Promise.all([
      supabase.from('owners').select('*').order('legal_name'),
      supabase.from('properties').select('owner_id'),
    ])
    setOwners(((data as OwnerRow[]) ?? []).map((o) => ({ ...o, properties: (props ?? []).filter((p) => p.owner_id === o.id).length })))
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([supabase.from('owners').select('*').order('legal_name'), supabase.from('properties').select('owner_id')]).then(([o, p]) => {
      if (!cancelled) setOwners(((o.data as OwnerRow[]) ?? []).map((x) => ({ ...x, properties: (p.data ?? []).filter((y) => y.owner_id === x.id).length })))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const close = () => {
    setEditing(null)
    void load()
  }

  return (
    <div className="mt-7 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-heading-s text-ink">{ea.owners.heading}</h2>
        {editing === null && <button type="button" className={buttonPrimary} onClick={() => setEditing('new')}>{ea.owners.new}</button>}
      </div>
      {editing !== null && <OwnerForm owner={editing === 'new' ? null : editing} onDone={close} onCancel={() => setEditing(null)} />}
      {owners === null && <p className="text-body text-ink-muted">{ea.common.loading}</p>}
      {owners?.length === 0 && <p className="text-body text-ink-muted">{ea.owners.empty}</p>}
      <ul className="flex flex-col gap-3">
        {owners?.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
            <div>
              <p className="text-title text-ink">{o.legal_name}</p>
              <p className="text-body-s text-ink-muted">{ea.owners.kinds[o.kind]} · {o.rut} · {ea.owners.properties(o.properties)}</p>
            </div>
            <button type="button" className={buttonSecondary} onClick={() => setEditing(o)}>{ea.common.edit}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function OwnerForm({ owner, onDone, onCancel }: { owner: OwnerRow | null; onDone: () => void; onCancel: () => void }) {
  const id = useId()
  const [v, setV] = useState(() => ({ ...EMPTY, ...(owner ?? {}) }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [stale, setStale] = useState(false)
  const set = <K extends keyof typeof v>(k: K) => (value: (typeof v)[K]) => setV((s) => ({ ...s, [k]: value }))
  const input = (k: keyof typeof v) => (e: { target: { value: string } }) => set(k)(e.target.value as never)

  async function save(event: FormEvent) {
    event.preventDefault()
    const { rut_formatted, ...e } = validateOwner({ legal_name: v.legal_name, rut: v.rut, avaluo_rebate_rate: v.avaluo_rebate_rate })
    setErrors(e as Record<string, string>)
    if (Object.keys(e).length) return setMessage({ ok: false, text: e.rut ? ea.owners.rutInvalid : ea.common.genericError })
    setSaving(true)
    const values = {
      kind: v.kind, legal_name: v.legal_name.trim(), rut: rut_formatted!, email: v.email?.trim() || null, phone: v.phone?.trim() || null,
      vat_applies: v.vat_applies, apply_avaluo_rebate: v.apply_avaluo_rebate, avaluo_rebate_rate: Number(v.avaluo_rebate_rate),
      avaluo_rebate_mode: v.avaluo_rebate_mode, notes: v.notes?.trim() || null,
    }
    const { error } = owner
      ? await supabase.from('owners').update({ ...values, updated_at: owner.updated_at }).eq('id', owner.id)
      : await supabase.from('owners').insert(values)
    setSaving(false)
    setStale(isStale(error))
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    onDone()
  }

  async function remove() {
    if (!owner || !window.confirm(ea.owners.deleteConfirm)) return
    const { error } = await supabase.from('owners').delete().eq('id', owner.id)
    if (error) return setMessage({ ok: false, text: error.code === '23503' ? ea.owners.inUse : errorMessage(error) })
    onDone()
  }

  const o = ea.owners
  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-5 rounded-xl border border-border-control bg-sand-50 p-5">
      <Select id={`${id}-kind`} label={o.kind} value={v.kind} onChange={(e) => set('kind')(e.target.value as OwnerRow['kind'])}>
        {Object.entries(o.kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      <Field id={`${id}-name`} label={o.legalName} required maxLength={150} value={v.legal_name} onChange={input('legal_name')} error={errors.legal_name ? ea.common.required : null} />
      <Field id={`${id}-rut`} label={o.rut} hint={o.rutHint} required maxLength={14} value={v.rut} onChange={input('rut')} error={errors.rut ? o.rutInvalid : null} autoComplete="off" />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={`${id}-email`} label={o.email} type="email" maxLength={254} value={v.email ?? ''} onChange={input('email')} />
        <Field id={`${id}-phone`} label={o.phone} type="tel" maxLength={30} value={v.phone ?? ''} onChange={input('phone')} />
      </div>
      <Select id={`${id}-vat`} label={o.vat} value={String(v.vat_applies)} onChange={(e) => set('vat_applies')(e.target.value === 'null' ? null : e.target.value === 'true')}>
        {Object.entries(o.vatOptions).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      <Check label={o.rebate} checked={v.apply_avaluo_rebate} onChange={set('apply_avaluo_rebate')} />
      {v.apply_avaluo_rebate && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={`${id}-rate`} label={o.rebateRate} type="number" step="0.01" min={0} max={1} value={String(v.avaluo_rebate_rate)}
            onChange={(e) => set('avaluo_rebate_rate')(Number(e.target.value))} error={errors.avaluo_rebate_rate ? ea.common.genericError : null} />
          <Select id={`${id}-mode`} label={o.rebateMode} value={v.avaluo_rebate_mode} onChange={(e) => set('avaluo_rebate_mode')(e.target.value as OwnerRow['avaluo_rebate_mode'])}>
            {Object.entries(o.rebateModes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>
      )}
      <TextArea id={`${id}-notes`} label={o.notes} rows={3} maxLength={2000} value={v.notes ?? ''} onChange={input('notes')} />
      <SaveBar saving={saving} message={message} stale={stale} onReload={onDone} />
      <div className="flex flex-wrap gap-3">
        <button type="button" className={buttonSecondary} onClick={onCancel}>{ea.common.cancel}</button>
        {owner && <button type="button" className={buttonSecondary} onClick={remove}>{ea.common.delete}</button>}
      </div>
    </form>
  )
}
