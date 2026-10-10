import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { formatDayShort } from '../../lib/dates/day'
import { Field } from '../../components/checkout/Field'
import { buttonPrimary, buttonSecondary } from '../../components/ui'
import { errorMessage, exportUrl, type ConflictRow, type ExternalCalendarRow } from '../api'
import { SaveBar, Select } from '../ui'
import { ea } from '../../lib/i18n/es-admin'

// Calendarios externos (Airbnb/Booking). La URL de importación es secreta:
// la lista la muestra enmascarada y el formulario nunca la recarga completa.
export function IcalPanel({ propertyId, onSynced }: { propertyId: string; onSynced: () => void }) {
  const [rows, setRows] = useState<ExternalCalendarRow[] | null>(null)
  const [conflicts, setConflicts] = useState<ConflictRow[]>([])
  const [editing, setEditing] = useState<ExternalCalendarRow | 'new' | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    const [c, k] = await Promise.all([
      supabase.rpc('admin_external_calendars', { p_property_id: propertyId }),
      supabase.rpc('admin_calendar_conflicts', { p_property_id: propertyId }),
    ])
    setRows((c.data as ExternalCalendarRow[]) ?? [])
    setConflicts((k.data as ConflictRow[]) ?? [])
  }, [propertyId])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.rpc('admin_external_calendars', { p_property_id: propertyId }),
      supabase.rpc('admin_calendar_conflicts', { p_property_id: propertyId }),
    ]).then(([c, k]) => {
      if (cancelled) return
      setRows((c.data as ExternalCalendarRow[]) ?? [])
      setConflicts((k.data as ConflictRow[]) ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [propertyId])

  // "Sincronizar ahora": misma importación que el job (Edge Function ical-import).
  async function syncNow() {
    setSyncing(true)
    setStatus(null)
    const { data, error } = await supabase.functions.invoke('ical-import', { body: { property_id: propertyId } })
    setSyncing(false)
    if (error) {
      let body: { reason?: string; retry_after_seconds?: number } = {}
      if (error instanceof FunctionsHttpError) body = await error.context.json().catch(() => ({}))
      if (body.reason === 'cooldown') return setStatus({ ok: false, text: ea.ical.cooldown(body.retry_after_seconds ?? 60) })
      if (body.reason === 'no_calendars') return setStatus({ ok: false, text: ea.ical.noCalendars })
      return setStatus({ ok: false, text: ea.ical.syncError })
    }
    const result = data as { calendars: number; ok: number }
    setStatus({ ok: result.ok === result.calendars, text: ea.ical.synced(result.ok, result.calendars) })
    void load()
    onSynced()
  }

  async function toggle(row: ExternalCalendarRow) {
    const { error } = await supabase.from('external_calendars').update({ is_active: !row.is_active }).eq('id', row.id)
    if (error) return setStatus({ ok: false, text: errorMessage(error) })
    void load()
  }

  async function copy(row: ExternalCalendarRow) {
    try {
      await navigator.clipboard.writeText(exportUrl(row.export_token))
      setStatus({ ok: true, text: ea.ical.copied })
    } catch {
      window.prompt(ea.ical.copyExport, exportUrl(row.export_token))
    }
  }

  const i = ea.ical
  return (
    <section aria-labelledby="ical-h" className="flex flex-col gap-4 border-t border-line pt-5">
      <h3 id="ical-h" className="text-title text-ink">{i.heading}</h3>
      <p className="text-body-s text-ink-muted">{i.intro} {i.exportHint}</p>
      <div className="flex flex-wrap gap-3">
        {editing === null && <button type="button" className={buttonPrimary} onClick={() => setEditing('new')}>{i.add}</button>}
        <button type="button" className={buttonSecondary} onClick={syncNow} disabled={syncing} aria-busy={syncing}>
          {syncing ? i.syncing : i.syncNow}
        </button>
      </div>
      <p role="status" aria-live="polite" className={`text-body-s ${status && !status.ok ? 'text-danger' : 'text-ink'}`}>{status?.text}</p>
      {editing !== null && (
        <CalendarForm propertyId={propertyId} calendar={editing === 'new' ? null : editing}
          onDone={() => { setEditing(null); void load() }} onCancel={() => setEditing(null)} />
      )}
      {rows?.length === 0 && <p className="text-body-s text-ink-muted">{i.empty}</p>}
      <ul className="flex flex-col gap-3">
        {rows?.map((row) => (
          <li key={row.id} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
            <div className="min-w-0">
              <p className="text-title text-ink">{row.name || i.channels[row.channel]}</p>
              <p className="break-all text-body-s text-ink-muted">{i.channels[row.channel]} · {row.url_masked}</p>
              <p className={`text-body-s ${row.status === 'error' || row.status === 'atrasado' ? 'text-danger' : 'text-ink'}`}>
                {i.status[row.status] ?? row.status}
                {row.status !== 'inactivo' && row.minutes_since_success !== null ? ` · ${i.ago(row.minutes_since_success)}` : ''}
                {row.status === 'error' && row.last_sync_error ? ` · ${row.last_sync_error}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" className={buttonSecondary} onClick={() => copy(row)}>{i.copyExport}</button>
              <button type="button" className={buttonSecondary} onClick={() => setEditing(row)}>{ea.common.edit}</button>
              <button type="button" className={buttonSecondary} onClick={() => toggle(row)}>{row.is_active ? i.deactivate : i.activate}</button>
            </div>
          </li>
        ))}
      </ul>
      <h4 className="text-label uppercase tracking-widest text-earth">{i.conflictsHeading}</h4>
      {conflicts.length === 0 && <p className="text-body-s text-ink-muted">{i.noConflicts}</p>}
      <ul className="flex flex-col gap-2">
        {conflicts.map((k) => (
          <li key={k.id} className="border-t border-line pt-2 text-body-s text-ink">
            <p>{i.conflict(i.channels[k.channel] ?? k.channel, formatDayShort(k.check_in), formatDayShort(k.check_out))}{k.reservation_code ? ` · ${k.reservation_code}` : ''}</p>
            <p className={k.conflict_type === 'reserva' ? 'text-danger' : 'text-ink-muted'}>{i.conflictTypes[k.conflict_type] ?? i.conflictTypes.otro}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function CalendarForm({ propertyId, calendar, onDone, onCancel }: {
  propertyId: string
  calendar: ExternalCalendarRow | null
  onDone: () => void
  onCancel: () => void
}) {
  const id = useId()
  const [channel, setChannel] = useState<string>(calendar?.channel ?? 'airbnb')
  const [name, setName] = useState(calendar?.name ?? '')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!calendar && !/^https:\/\//i.test(url.trim())) return setMessage({ ok: false, text: ea.ical.urlHint })
    setSaving(true)
    const values: Record<string, unknown> = { channel, name: name.trim() || null }
    if (url.trim()) values.import_url = url.trim()
    const { error } = calendar
      ? await supabase.from('external_calendars').update(values).eq('id', calendar.id)
      : await supabase.from('external_calendars').insert({ ...values, property_id: propertyId })
    setSaving(false)
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    onDone()
  }

  const i = ea.ical
  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-5 rounded-xl border border-border-control bg-sand-50 p-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Select id={`${id}-ch`} label={i.channel} value={channel} onChange={(e) => setChannel(e.target.value)}>
          {Object.entries(i.channels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Field id={`${id}-name`} label={i.name} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Field id={`${id}-url`} label={i.url} hint={calendar ? `${i.urlKeep} ${i.urlHint}` : i.urlHint} type="url" inputMode="url"
        autoComplete="off" maxLength={2000} required={!calendar} value={url} onChange={(e) => setUrl(e.target.value)} />
      <SaveBar saving={saving} message={message} />
      <button type="button" className={`${buttonSecondary} self-start`} onClick={onCancel}>{ea.common.cancel}</button>
    </form>
  )
}
