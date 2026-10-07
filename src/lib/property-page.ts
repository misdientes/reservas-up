import { useCallback, useEffect, useState } from 'react'
import { fetchAvailability, fetchPublicProperty, quoteStay } from './api/public'
import { availabilityWindow, type OccupiedRange } from './calendar/availability'
import { zonedNow, type Day } from './dates/day'
import type { Quote } from './pricing'
import type { PublicPropertyDetail } from '../types/public'

// Carga de la ficha: propiedad + fotos + disponibilidad (solo vistas
// públicas y get_property_availability).

export type PropertyPageState =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'error' }
  | { status: 'ok'; detail: PublicPropertyDetail; ranges: OccupiedRange[] }

async function loadDetail(slug: string): Promise<PublicPropertyDetail | null> {
  // Condición escrita aquí (no importada): así el build de producción la evalúa
  // como false y elimina el import() de los datos de ejemplo.
  if (import.meta.env.MODE === 'fixtures' || (import.meta.env.DEV && import.meta.env.VITE_USE_FIXTURES === 'true')) {
    const { fixtureDetail } = await import('./fixtures/properties')
    return fixtureDetail(slug)
  }
  return fetchPublicProperty(slug)
}

// Consulta la disponibilidad para la ventana completa desde hoy en Chile.
export async function loadAvailability(slug: string): Promise<OccupiedRange[]> {
  // Condición escrita aquí (no importada): así el build de producción la evalúa
  // como false y elimina el import() de los datos de ejemplo.
  if (import.meta.env.MODE === 'fixtures' || (import.meta.env.DEV && import.meta.env.VITE_USE_FIXTURES === 'true')) {
    const { fixtureAvailability } = await import('./fixtures/properties')
    return fixtureAvailability()
  }
  const { from, to } = availabilityWindow(zonedNow(new Date()).day)
  return fetchAvailability(slug, from, to)
}

export function usePropertyPage(slug: string) {
  const [state, setState] = useState<PropertyPageState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadDetail(slug), loadAvailability(slug)])
      .then(([detail, ranges]) => {
        if (cancelled) return
        setState(detail ? { status: 'ok', detail, ranges } : { status: 'notFound' })
      })
      .catch((error: unknown) => {
        console.warn('No se pudo cargar la propiedad', error)
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [slug, attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  // Disponibilidad fresca (al volver a la pestaña o antes de contactar).
  // Devuelve los rangos nuevos para que quien llama revise su selección.
  const refreshAvailability = useCallback(async (): Promise<OccupiedRange[] | null> => {
    try {
      const ranges = await loadAvailability(slug)
      setState((current) => (current.status === 'ok' ? { ...current, ranges } : current))
      return ranges
    } catch (error) {
      console.warn('No se pudo actualizar la disponibilidad', error)
      return null
    }
  }, [slug])

  return { state, retry, refreshAvailability }
}

// Cotización (quote_stay). En desarrollo con datos de ejemplo, una réplica
// de las reglas; la condición va escrita aquí para que el build de
// producción la elimine.
export async function loadQuote(
  property: PublicPropertyDetail['property'],
  checkIn: Day,
  checkOut: Day,
  guests: number,
): Promise<Quote> {
  if (import.meta.env.MODE === 'fixtures' || (import.meta.env.DEV && import.meta.env.VITE_USE_FIXTURES === 'true')) {
    const [{ fixtureQuote }, { fixtureAvailability }] = await Promise.all([
      import('./fixtures/pricing'),
      import('./fixtures/properties'),
    ])
    return fixtureQuote(property, checkIn, checkOut, guests, fixtureAvailability())
  }
  return quoteStay(property.slug, checkIn, checkOut, guests)
}
