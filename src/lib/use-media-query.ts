import { useSyncExternalStore } from 'react'

// Escritorio = ancho del breakpoint md de Tailwind (48rem).
export const DESKTOP_QUERY = '(min-width: 48rem)'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
