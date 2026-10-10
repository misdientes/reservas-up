import { useEffect, useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Field } from '../../components/checkout/Field'
import { buttonPrimary, buttonSecondary } from '../../components/ui'
import { errorMessage, isStale, type OwnerRow, type PropertyRow, type RateGroupRow } from '../api'
import { SaveBar, Select } from '../ui'
import { ea } from '../../lib/i18n/es-admin'

// Dueño y tarifa. El dueño SOLO cambia con change_property_owner (la base
// rechaza un UPDATE directo); la tarifa del mismo dueño se cambia aquí y la
// FK compuesta impide elegir una de otro dueño.
export function OwnerSection({ property, onChanged, onSaved }: { property: PropertyRow; onChanged: () => void; onSaved: (p: PropertyRow) => void }) {
  const id = useId()
  const [owners, setOwners] = useState<Pick<OwnerRow, 'id' | 'legal_name'>[]>([])
  const [groups, setGroups] = useState<RateGroupRow[]>([])
  const [rateGroup, setRateGroup] = useState(property.rate_group_id ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [stale, setStale] = useState(false)
  const [changing, setChanging] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('owners').select('id, legal_name').order('legal_name'),
      supabase.from('rate_groups').select('id, owner_id, name').order('name'),
    ]).then(([o, g]) => {
      setOwners(o.data ?? [])
      setGroups((g.data as RateGroupRow[]) ?? [])
    })
  }, [])

  const owner = owners.find((o) => o.id === property.owner_id)
  const ownGroups = groups.filter((g) => g.owner_id === property.owner_id)

  async function saveGroup(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const { data, error } = await supabase.from('properties')
      .update({ rate_group_id: rateGroup || null, updated_at: property.updated_at }).eq('id', property.id).select('*').single()
    setSaving(false)
    setStale(isStale(error))
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    onSaved(data as PropertyRow)
    setMessage({ ok: true, text: ea.common.saved })
  }

  const o = ea.properties.owner
  return (
    <div className="flex flex-col gap-5">
      <p className="text-body text-ink"><span className="text-label uppercase tracking-widest text-earth">{o.current}</span><br />{owner?.legal_name ?? '—'}</p>
      <form onSubmit={saveGroup} className="flex flex-col gap-4">
        <Select id={`${id}-rg`} label={o.rateGroup} hint={o.rateGroupHint} value={rateGroup} onChange={(e) => setRateGroup(e.target.value)}>
          <option value="">{ea.common.none}</option>
          {ownGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
        <SaveBar saving={saving} message={message} stale={stale} onReload={onChanged} />
      </form>
      {!changing ? (
        <button type="button" className={`${buttonSecondary} self-start`} onClick={() => setChanging(true)}>{o.change}</button>
      ) : (
        <ChangeOwner property={property} owners={owners} groups={groups} onCancel={() => setChanging(false)} onDone={onChanged} />
      )}
    </div>
  )
}

function ChangeOwner({ property, owners, groups, onCancel, onDone }: {
  property: PropertyRow
  owners: Pick<OwnerRow, 'id' | 'legal_name'>[]
  groups: RateGroupRow[]
  onCancel: () => void
  onDone: () => void
}) {
  const id = useId()
  const [ownerId, setOwnerId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const o = ea.properties.owner

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ownerId || note.trim().length < 3) return setMessage(ea.common.required)
    setSending(true)
    const { data, error } = await supabase.rpc('change_property_owner', {
      p_property_id: property.id, p_new_owner_id: ownerId, p_new_rate_group_id: groupId || null, p_note: note.trim(),
    })
    setSending(false)
    if (error) return setMessage(errorMessage(error))
    window.alert(o.done(Number((data as { future_reservations_previous_owner?: number })?.future_reservations_previous_owner ?? 0)))
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-l border border-border-control bg-sand-50 p-4">
      <h3 className="text-title text-ink">{o.changeHeading}</h3>
      <p className="text-body-s text-ink-muted">{o.changeIntro}</p>
      <Select id={`${id}-owner`} label={o.newOwner} value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setGroupId('') }}>
        <option value="">{ea.common.none}</option>
        {owners.filter((x) => x.id !== property.owner_id).map((x) => <option key={x.id} value={x.id}>{x.legal_name}</option>)}
      </Select>
      <Select id={`${id}-group`} label={o.newRateGroup} value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={!ownerId}>
        <option value="">{ea.common.none}</option>
        {groups.filter((g) => g.owner_id === ownerId).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </Select>
      <Field id={`${id}-note`} label={o.note} required maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <p role="status" className="text-body-s text-danger">{message}</p>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={buttonPrimary} disabled={sending} aria-busy={sending}>{o.confirm}</button>
        <button type="button" className={buttonSecondary} onClick={onCancel}>{ea.common.cancel}</button>
      </div>
    </form>
  )
}
