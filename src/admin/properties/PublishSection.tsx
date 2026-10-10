import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { buttonPrimary, buttonSecondary, textLink } from '../../components/ui'
import { AlertIcon, CheckIcon } from '../../components/icons'
import { errorMessage, type PropertyRow } from '../api'
import { ea } from '../../lib/i18n/es-admin'

// Publicar (publish_property valida TODO en el servidor y explica lo que
// falta) y volver a borrador (pide confirmación si hay reservas futuras;
// nunca las cancela).
export function PublishSection({ property, onChanged }: { property: PropertyRow; onChanged: () => void }) {
  const [missing, setMissing] = useState<string[] | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const published = property.status === 'publicada'

  useEffect(() => {
    supabase.rpc('property_publish_check', { p_property_id: property.id }).then(({ data }) => setMissing((data as string[]) ?? []))
  }, [property.id])

  async function publish() {
    setBusy(true)
    const { data, error } = await supabase.rpc('publish_property', { p_property_id: property.id })
    setBusy(false)
    const result = data as { ok: boolean; missing?: string[] } | null
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    if (!result?.ok) return setMissing(result?.missing ?? [])
    setMessage({ ok: true, text: ea.properties.publish.published })
    onChanged()
  }

  async function unpublish(confirmed = false) {
    setBusy(true)
    const { data, error } = await supabase.rpc('unpublish_property', { p_property_id: property.id, p_confirm: confirmed })
    setBusy(false)
    const result = data as { ok: boolean; needs_confirmation?: boolean; future_reservations?: number } | null
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    if (result?.needs_confirmation) {
      if (window.confirm(ea.properties.publish.confirmUnpublish(result.future_reservations ?? 0))) await unpublish(true)
      return
    }
    setMessage({ ok: true, text: ea.properties.publish.unpublished })
    onChanged()
  }

  const p = ea.properties.publish
  return (
    <section aria-labelledby="publicacion" className="flex flex-col gap-4 rounded-xl border border-line bg-sand-50 p-5">
      <h3 id="publicacion" className="text-title text-ink">{ea.properties.sections.publish}: {ea.properties.status[property.status]}</h3>
      {!published && missing && missing.length > 0 && (
        <div>
          <p className="text-body-s text-ink">{p.missingHeading}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {missing.map((m) => (
              <li key={m} className="flex items-start gap-2 text-body-s text-ink"><AlertIcon size={20} className="shrink-0 text-danger" />{m}</li>
            ))}
          </ul>
        </div>
      )}
      {!published && missing?.length === 0 && (
        <p className="flex items-center gap-2 text-body-s text-ink"><CheckIcon size={20} className="text-pacific" />{p.ready}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!published ? (
          <button type="button" className={buttonPrimary} onClick={publish} disabled={busy || !missing || missing.length > 0} aria-busy={busy}>{p.publish}</button>
        ) : (
          <>
            <a href={`/propiedades/${property.slug}`} target="_blank" rel="noopener noreferrer" className={`${textLink} inline-flex min-h-10 items-center`}>{p.view}</a>
            <button type="button" className={buttonSecondary} onClick={() => unpublish(false)} disabled={busy} aria-busy={busy}>{p.unpublish}</button>
          </>
        )}
      </div>
      <p role="status" aria-live="polite" className={`text-body-s ${message && !message.ok ? 'text-danger' : 'text-ink'}`}>{message?.text}</p>
    </section>
  )
}
