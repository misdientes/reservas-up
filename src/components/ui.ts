import { useEffect } from 'react'

// Clases compartidas, construidas SOLO con tokens Costa y Pampa.

// Contenedor: margen space-5 en celular; 1200px máx. y 24px en escritorio.
export const container = 'mx-auto w-full max-w-page px-5 md:px-gutter'

// Acción principal (una por pantalla): terracota con texto blanco, píldora, 44px.
export const buttonPrimary =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-pill bg-terracotta px-7 text-button text-surface ' +
  'transition-colors hover:bg-earth disabled:opacity-50'

// Acción secundaria: borde border-control (3:1), píldora, 44px.
export const buttonSecondary =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-pill border border-border-control px-7 text-button text-ink ' +
  'transition-colors hover:bg-sand-50'

// Etiqueta en mayúsculas con espaciado amplio (eyebrow), color earth.
export const eyebrow = 'text-label uppercase tracking-widest text-earth'

// Enlace de texto en azul Pacífico.
export const textLink = 'text-pacific underline underline-offset-4 hover:text-ink'

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title
  }, [title])
}
