import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { fetchPublicProperties, fetchPublicSettings } from './api/public'
import { SiteDataContext, type PropertiesState } from './site-data-context'
import type { PublicProperty, PublicSettings } from '../types/public'

// Datos públicos del sitio, cargados una vez y compartidos por la plantilla
// (WhatsApp del encabezado y del pie) y las páginas.

// Solo existe en desarrollo: en el build de producción import.meta.env.DEV
// es false y el import() de los datos de ejemplo se elimina del sitio.
const USE_FIXTURES = import.meta.env.DEV && import.meta.env.VITE_USE_FIXTURES === 'true'

async function loadProperties(): Promise<PublicProperty[]> {
  if (import.meta.env.DEV && USE_FIXTURES) {
    const { FIXTURE_PROPERTIES } = await import('./fixtures/properties')
    return FIXTURE_PROPERTIES
  }
  return fetchPublicProperties()
}

export function SiteDataProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [properties, setProperties] = useState<PropertiesState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchPublicSettings()
      .then((value) => !cancelled && setSettings(value))
      .catch((error: unknown) => console.warn('No se pudo leer app_settings', error))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadProperties()
      .then((list) => !cancelled && setProperties({ status: 'ok', properties: list }))
      .catch((error: unknown) => {
        console.warn('No se pudieron leer las propiedades', error)
        if (!cancelled) setProperties({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const reload = useCallback(() => {
    setProperties({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  return (
    <SiteDataContext.Provider value={{ settings, properties, usingFixtures: USE_FIXTURES, reload }}>
      {children}
    </SiteDataContext.Provider>
  )
}
