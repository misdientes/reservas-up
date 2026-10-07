import { createContext, useContext } from 'react'
import type { PublicProperty, PublicSettings } from '../types/public'

// Contexto de los datos públicos del sitio (el proveedor está en site-data.tsx).

export type PropertiesState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ok'; properties: PublicProperty[] }

export interface SiteData {
  settings: PublicSettings | null
  properties: PropertiesState
  usingFixtures: boolean
  reload: () => void
}

export const SiteDataContext = createContext<SiteData | null>(null)

export function useSiteData(): SiteData {
  const value = useContext(SiteDataContext)
  if (!value) throw new Error('useSiteData debe usarse dentro de SiteDataProvider')
  return value
}
