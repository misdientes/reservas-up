import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { supabase } from '../../lib/supabase'
import { loadSettings, type ArrivalInfoRow, type PropertyRow } from '../api'
import { PublicSection } from './PublicSection'
import { PrivateSection } from './PrivateSection'
import { OwnerSection } from './OwnerSection'
import { PaymentSection } from './PaymentSection'
import { PhotosSection } from './PhotosSection'
import { PublishSection } from './PublishSection'
import { AuditList } from '../AuditList'
import { CalendarSection } from '../calendar/CalendarSection'
import { Section } from '../ui'
import { ArrowLeftIcon } from '../../components/icons'
import { ea } from '../../lib/i18n/es-admin'

// Ficha de una propiedad: secciones independientes, cada una con su
// "Guardar" (concurrencia optimista por updated_at).

export interface EditorState {
  property: PropertyRow
  arrival: ArrivalInfoRow | null
  settings: Record<string, string>
}

export function PropertyEditor() {
  const { id = '' } = useParams()
  const [state, setState] = useState<EditorState | null>(null)
  const [error, setError] = useState(false)
  const [version, setVersion] = useState(0)

  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('properties').select('*').eq('id', id).single(),
      supabase.from('property_arrival_info').select('*').eq('property_id', id).maybeSingle(),
      loadSettings(),
    ]).then(([p, a, settings]) => {
      if (cancelled) return
      if (p.error) return setError(true)
      setState({ property: p.data as PropertyRow, arrival: (a.data as ArrivalInfoRow) ?? null, settings })
    })
    return () => {
      cancelled = true
    }
  }, [id, version])

  const setProperty = (property: PropertyRow) => setState((s) => (s ? { ...s, property } : s))
  const setArrival = (arrival: ArrivalInfoRow) => setState((s) => (s ? { ...s, arrival } : s))

  if (error) return <p role="alert" className="mt-7 text-body text-ink">{ea.common.loadError}</p>
  if (!state) return <p className="mt-7 min-h-screen text-body text-ink-muted">{ea.common.loading}</p>
  const { property } = state

  return (
    <div className="mt-7 flex flex-col gap-5">
      <Link to="/admin/propiedades" className="inline-flex min-h-10 items-center gap-2 self-start text-body-s text-ink hover:text-pacific">
        <ArrowLeftIcon size={20} />
        {ea.properties.heading}
      </Link>
      <div>
        <h2 className="font-display text-heading text-ink">{property.name}</h2>
        <p className="mt-2 text-body-s text-ink-muted">{ea.properties.status[property.status]} · /propiedades/{property.slug}</p>
      </div>

      <PublishSection key={`pub-${version}-${property.updated_at}`} property={property} onChanged={reload} />
      <Section id="publica" title={ea.properties.sections.public}>
        <PublicSection key={`p-${version}`} property={property} onSaved={setProperty} onReload={reload} />
      </Section>
      <Section id="fotos" title={ea.properties.sections.photos}>
        <PhotosSection key={`f-${version}`} property={property} />
      </Section>
      <Section id="privada" title={ea.properties.sections.private} defaultOpen={false}>
        <PrivateSection key={`a-${version}`} propertyId={property.id} arrival={state.arrival} onSaved={setArrival} onReload={reload} />
      </Section>
      <Section id="dueno" title={ea.properties.sections.owner} defaultOpen={false}>
        <OwnerSection key={`o-${version}`} property={property} onChanged={reload} onSaved={setProperty} />
      </Section>
      <Section id="cobro" title={ea.properties.sections.payment} defaultOpen={false}>
        <PaymentSection key={`c-${version}`} property={property} settings={state.settings} onSaved={setProperty} onReload={reload} />
      </Section>
      <Section id="calendario" title={ea.properties.sections.calendar} defaultOpen={false}>
        <CalendarSection key={`cal-${version}`} property={property} />
      </Section>
      <Section id="cambios" title={ea.properties.sections.history} defaultOpen={false}>
        <AuditList key={`h-${version}-${property.updated_at}`} recordId={property.id} limit={15} />
      </Section>
    </div>
  )
}
