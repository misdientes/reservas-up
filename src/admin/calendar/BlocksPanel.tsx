import { useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { addDays, diffDays, formatDayShort, type Day } from '../../lib/dates/day'
import { Field } from '../../components/checkout/Field'
import { buttonSecondary } from '../../components/ui'
import { errorMessage, type CalendarDayRow } from '../api'
import { SaveBar, Select } from '../ui'
import { ea } from '../../lib/i18n/es-admin'

// Bloqueos manuales: crear (create_manual_block) y quitar (remove_manual_block).
// La restricción de exclusión de la base decide; si choca con una reserva o
// un pago en curso, la base devuelve un mensaje claro que se muestra tal cual.

interface Block {
  id: string
  from: Day
  to: Day
  reason: string | null
  note: string | null
}

// Los bloqueos vigentes salen del mismo calendario (definición única).
function blocksOf(days: CalendarDayRow[]): Block[] {
  const map = new Map<string, Block>()
  for (const d of days) {
    if (d.occupancy_kind !== 'manual_block' || !d.occupancy_id) continue
    const block = map.get(d.occupancy_id)
    if (block) block.to = addDays(d.day, 1)
    else map.set(d.occupancy_id, { id: d.occupancy_id, from: d.day, to: addDays(d.day, 1), reason: d.block_reason, note: d.block_note })
  }
  return [...map.values()]
}

export function BlocksPanel({ propertyId, days, minDay, maxDay, onChanged }: {
  propertyId: string
  days: CalendarDayRow[]
  minDay: Day
  maxDay: Day
  onChanged: () => void
}) {
  const id = useId()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('mantencion')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const blocks = blocksOf(days)

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!from || !to || to <= from) return setMessage({ ok: false, text: ea.seasons.dateError })
    setSaving(true)
    const { error } = await supabase.rpc('create_manual_block', {
      p_property_id: propertyId, p_from: from, p_to: to, p_note: note.trim() || null, p_reason: reason,
    })
    setSaving(false)
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    setFrom('')
    setTo('')
    setNote('')
    setMessage({ ok: true, text: ea.blocks.created })
    onChanged()
  }

  async function remove(block: Block) {
    if (!window.confirm(ea.blocks.removeConfirm)) return
    const { error } = await supabase.rpc('remove_manual_block', { p_id: block.id })
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    setMessage({ ok: true, text: ea.blocks.removed })
    onChanged()
  }

  const b = ea.blocks
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-4 border-t border-line pt-5">
      <h3 id={`${id}-h`} className="text-title text-ink">{b.heading}</h3>
      <p className="text-body-s text-ink-muted">{b.intro}</p>
      <form onSubmit={create} noValidate className="flex flex-col gap-4">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={`${id}-from`} label={b.from} type="date" min={minDay} max={maxDay} required value={from} onChange={(e) => setFrom(e.target.value)} />
          <Field id={`${id}-to`} label={b.to} type="date" min={minDay} max={maxDay} required value={to} onChange={(e) => setTo(e.target.value)} />
          <Select id={`${id}-reason`} label={b.reason} value={reason} onChange={(e) => setReason(e.target.value)}>
            {Object.entries(b.reasons).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Field id={`${id}-note`} label={b.note} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <SaveBar saving={saving} message={message} label={b.create} />
      </form>
      <h4 className="text-label uppercase tracking-widest text-earth">{b.active}</h4>
      {blocks.length === 0 && <p className="text-body-s text-ink-muted">{b.none}</p>}
      <ul className="flex flex-col gap-2">
        {blocks.map((block) => (
          <li key={block.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2">
            <span className="text-body-s text-ink">
              {ea.seasons.nights(formatDayShort(block.from), formatDayShort(block.to), diffDays(block.from, block.to))}
              {' · '}{b.reasons[block.reason ?? 'otro']}{block.note ? ` · ${block.note}` : ''}
            </span>
            <button type="button" className={buttonSecondary} onClick={() => remove(block)}>{b.remove}</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
