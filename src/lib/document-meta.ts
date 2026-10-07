import { useEffect } from 'react'

// <title> y meta description por página (el SEO con pre-render llega en la
// Sesión 16). Al salir de la página se restaura la descripción general.
export function useDocumentMeta(title: string, description?: string) {
  useEffect(() => {
    document.title = title
    if (!description) return
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (!meta) return
    const previous = meta.content
    meta.content = description
    return () => {
      meta.content = previous
    }
  }, [title, description])
}
