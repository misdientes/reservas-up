// Textos de la interfaz en español (Chile), de tú (guía Costa y Pampa).
// Todos los textos visibles viven aquí para poder agregar inglés después
// sin tocar los componentes.
export const es = {
  meta: {
    homeTitle: 'Reservas UP · Arriendo por noche con reserva directa',
    legalTitle: 'Reservas UP',
  },
  layout: {
    skipToContent: 'Saltar al contenido',
    brandWord: 'Reservas',
    brandPill: 'UP',
    brandHomeLabel: 'Reservas UP, ir al inicio',
    navLabel: 'Navegación principal',
    navProperties: 'Propiedades',
    navDirect: 'Reserva directo',
    navWork: 'Por trabajo',
    navWhatsapp: 'WhatsApp',
    menuOpen: 'Abrir menú',
    menuClose: 'Cerrar menú',
    fixturesBanner: 'Estás viendo datos de ejemplo (solo en desarrollo). No son propiedades reales.',
  },
  hero: {
    titleStart: 'Despierta',
    titleAccent: 'frente al Pacífico.',
    lead: 'Departamentos para arrendar por noche en el norte y el centro de Chile. Reservas directo con nosotros y pagas el precio final, sin cargos de plataforma.',
  },
  search: {
    heading: 'Busca tu estadía',
    destination: 'Destino',
    anyDestination: 'Todos los destinos',
    checkIn: 'Llegada',
    checkOut: 'Salida',
    guests: 'Huéspedes',
    guestsOption: (n: number) => (n === 1 ? '1 huésped' : `${n} huéspedes`),
    submit: 'Ver disponibilidad',
    checkOutError: 'La salida debe ser después de la llegada.',
  },
  listing: {
    heading: 'Propiedades',
    filtersLabel: 'Filtrar por destino',
    allDestinations: 'Todos',
    resultsCount: (n: number) => (n === 1 ? '1 propiedad' : `${n} propiedades`),
    noMatches: 'No hay propiedades para ese filtro. Prueba con otro destino o menos huéspedes.',
    clearFilters: 'Ver todas',
    loading: 'Cargando propiedades…',
    loadError: 'No pudimos cargar las propiedades. Revisa tu conexión e inténtalo de nuevo.',
    retry: 'Reintentar',
  },
  card: {
    capacity: (n: number) => (n === 1 ? 'Hasta 1 huésped' : `Hasta ${n} huéspedes`),
    priceFallback: 'Consultar fechas',
    photoAlt: (name: string) => `Foto de ${name}`,
  },
  direct: {
    heading: 'Reserva directo, sin intermediarios',
    lead: 'Cuando reservas aquí, tratas con nosotros desde el primer mensaje hasta el día de salida.',
    benefits: [
      { title: 'Sin cargos por servicio de plataforma', text: 'El precio que ves es el que pagas.' },
      { title: 'Precio final con IVA incluido', text: 'Desglosado antes de pagar, sin sorpresas.' },
      { title: 'Hablas directo con nosotros', text: 'Por WhatsApp, antes y durante tu estadía.' },
    ],
  },
  work: {
    heading: '¿Viajas por trabajo?',
    text: 'Si necesitas alojamiento para una estadía de trabajo o para tu empresa, escríbenos y lo coordinamos contigo.',
    cta: 'Escríbenos por WhatsApp',
  },
  empty: {
    heading: 'Muy pronto, nuestras primeras estadías',
    text: 'Estamos preparando los departamentos para recibirte. Si quieres reservar o tienes una consulta, escríbenos.',
    cta: 'Escríbenos por WhatsApp',
  },
  footer: {
    tagline: 'Reservas directas de departamentos por noche.',
    legalHeading: 'Información legal',
    terms: 'Términos y condiciones',
    privacy: 'Política de privacidad',
    cancellation: 'Política de cancelación',
    contactHeading: 'Contacto',
    whatsapp: 'Escríbenos por WhatsApp',
    rights: 'Reservas UP',
  },
  legal: {
    terms: 'Términos y condiciones',
    privacy: 'Política de privacidad',
    cancellation: 'Política de cancelación',
    pending: 'Estamos preparando este documento. Si tienes una consulta, escríbenos por WhatsApp.',
    backHome: 'Volver al inicio',
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
    text: 'La dirección que buscas no existe o cambió.',
    backHome: 'Volver al inicio',
  },
} as const

export type Messages = typeof es
