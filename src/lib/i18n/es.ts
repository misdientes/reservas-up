// Textos de la interfaz en español (Chile).
// Todos los textos visibles viven aquí para poder agregar inglés después
// sin tocar los componentes.
export const es = {
  layout: {
    brandFallback: 'Reservas UP',
    navHome: 'Inicio',
    navAdmin: 'Panel',
    footer: 'Reservas directas · Iquique y Santiago',
  },
  home: {
    loading: 'Cargando…',
    loadError: 'No pudimos cargar la información del sitio.',
    subtitle: 'Arriendo de departamentos por noche, con reserva y pago directo.',
  },
  property: {
    title: 'Propiedad',
    placeholder: 'Aquí irá el detalle y el calendario de la propiedad.',
  },
  admin: {
    title: 'Panel de administración',
    placeholder: 'Aquí irá el panel para administrar propiedades, tarifas y reservas.',
  },
  notFound: {
    title: 'Página no encontrada',
    backHome: 'Volver al inicio',
  },
} as const

export type Messages = typeof es
