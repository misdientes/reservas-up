import { useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Field } from '../../components/checkout/Field'
import { errorMessage, isStale, type ArrivalInfoRow } from '../api'
import { SaveBar, TextArea } from '../ui'
import { ea } from '../../lib/i18n/es-admin'

// Datos privados de llegada (property_arrival_info): solo admin; salen en
// el correo de instrucciones de llegada, nunca en el sitio.
export function PrivateSection({ propertyId, arrival, onSaved, onReload }: {
  propertyId: string
  arrival: ArrivalInfoRow | null
  onSaved: (a: ArrivalInfoRow) => void
  onReload: () => void
}) {
  const id = useId()
  const [v, setV] = useState({
    exact_address: arrival?.exact_address ?? '', access_instructions: arrival?.access_instructions ?? '',
    wifi_name: arrival?.wifi_name ?? '', wifi_password: arrival?.wifi_password ?? '', parking: arrival?.parking ?? '', notes: arrival?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [stale, setStale] = useState(false)
  const input = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }))

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const values = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() || null]))
    const { data, error } = arrival
      ? await supabase.from('property_arrival_info').update({ ...values, updated_at: arrival.updated_at }).eq('property_id', propertyId).select('*').single()
      : await supabase.from('property_arrival_info').insert({ ...values, property_id: propertyId }).select('*').single()
    setSaving(false)
    setStale(isStale(error))
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    onSaved(data as ArrivalInfoRow)
    setMessage({ ok: true, text: ea.common.saved })
  }

  const f = ea.properties.fields
  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <p className="text-body-s text-ink-muted">{ea.properties.privateNote}</p>
      <Field id={`${id}-addr`} label={f.exactAddress} maxLength={200} value={v.exact_address} onChange={input('exact_address')} autoComplete="off" />
      <TextArea id={`${id}-access`} label={f.access} rows={4} maxLength={2000} value={v.access_instructions} onChange={input('access_instructions')} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={`${id}-wifi`} label={f.wifiName} maxLength={80} value={v.wifi_name} onChange={input('wifi_name')} autoComplete="off" />
        <Field id={`${id}-wifipw`} label={f.wifiPassword} maxLength={80} value={v.wifi_password} onChange={input('wifi_password')} autoComplete="off" />
      </div>
      <Field id={`${id}-parking`} label={f.parking} maxLength={200} value={v.parking} onChange={input('parking')} />
      <TextArea id={`${id}-notes`} label={f.notes} rows={3} maxLength={2000} value={v.notes} onChange={input('notes')} />
      <SaveBar saving={saving} message={message} stale={stale} onReload={onReload} />
    </form>
  )
}
