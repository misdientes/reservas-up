import type { PublicPhoto, PublicProperty, PublicPropertyDetail } from '../../types/public'
import type { OccupiedRange } from '../calendar/availability'
import { addDays, zonedNow } from '../dates/day'
import { fixturePriceFrom } from './pricing'
import costa from './photos/01-costa.svg'
import living from './photos/02-living.svg'
import dormitorio from './photos/03-dormitorio.svg'
import pampa from './photos/04-pampa.svg'
import terraza from './photos/05-terraza.svg'

// DATOS DE EJEMPLO SOLO PARA DESARROLLO (VITE_USE_FIXTURES=true en .env.local,
// o el build local "npm run build:fixtures"). Ficticios y marcados como
// ejemplo: no son propiedades reales ni contienen datos del negocio. En el
// build de producción este archivo no se incluye en el sitio.

const PHOTOS_COAST: PublicPhoto[] = [
  { url: costa, alt: 'Ilustración de ejemplo: el mar al atardecer' },
  { url: living, alt: 'Ilustración de ejemplo: living con ventana al mar' },
  { url: dormitorio, alt: 'Ilustración de ejemplo: dormitorio' },
  { url: terraza, alt: 'Ilustración de ejemplo: terraza' },
  { url: pampa, alt: 'Ilustración de ejemplo: la pampa' },
]

const BASE = {
  region: 'Tarapacá',
  house_rules: 'Ejemplo: no se permiten fiestas ni eventos.\nEjemplo: no se fuma dentro del departamento.',
  check_in_time: '15:00:00',
  check_out_time: '11:00:00',
  min_advance_hours: 24,
  self_check_in: true,
}

export const FIXTURE_PROPERTIES: PublicProperty[] = [
  {
    ...BASE,
    id: 'ejemplo-1',
    slug: 'ejemplo-departamento-costero',
    price_from_clp: fixturePriceFrom('ejemplo-departamento-costero'),
    name: 'Ejemplo · Departamento costero',
    description:
      'Texto de ejemplo. Departamento ficticio frente al mar para ver cómo se ve una ficha completa.\nEste párrafo también es de ejemplo.',
    city: 'Iquique',
    neighborhood: 'Sector de ejemplo',
    max_guests: 4,
    bedrooms: 2,
    beds: 2,
    bathrooms: 1,
    amenities: ['Wifi', 'Cocina equipada', 'Lavadora', 'Estacionamiento', 'Ropa de cama', 'Toallas', 'Agua caliente', 'Televisor'],
    min_nights: 2,
    property_type: 'departamento',
    cover: PHOTOS_COAST[0],
  },
  {
    ...BASE,
    id: 'ejemplo-2',
    slug: 'ejemplo-departamento-centro',
    price_from_clp: fixturePriceFrom('ejemplo-departamento-centro'),
    name: 'Ejemplo · Departamento en el centro',
    description: 'Texto de ejemplo. Departamento ficticio en el centro de la ciudad.',
    city: 'Santiago',
    region: 'Metropolitana',
    neighborhood: 'Sector de ejemplo',
    max_guests: 2,
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,
    amenities: ['Wifi', 'Cocina equipada'],
    min_nights: 1,
    property_type: 'departamento',
    self_check_in: false,
    cover: null,
  },
  {
    ...BASE,
    id: 'ejemplo-3',
    slug: 'ejemplo-cabana-pampa',
    price_from_clp: null, // sin tarifa: "Consultar precio"
    name: 'Ejemplo · Cabaña en la pampa',
    description: null,
    city: 'La Huayca',
    neighborhood: null,
    max_guests: 6,
    bedrooms: 3,
    beds: null, // dato faltante: la ficha debe omitirlo
    bathrooms: 0, // 0 también se omite
    amenities: [],
    house_rules: null,
    check_in_time: null,
    check_out_time: null,
    min_nights: 2,
    property_type: 'cabana',
    cover: null,
  },
]

export function fixtureDetail(slug: string): PublicPropertyDetail | null {
  const property = FIXTURE_PROPERTIES.find((p) => p.slug === slug)
  if (!property) return null
  return { property, photos: property.cover ? PHOTOS_COAST : [] }
}

// Ocupaciones ficticias relativas a hoy (en Chile), ya "unidas" como las
// devuelve get_property_availability.
export function fixtureAvailability(): OccupiedRange[] {
  const today = zonedNow(new Date()).day
  const at = (n: number) => addDays(today, n)
  return [
    { start: at(4), end: at(7) },
    { start: at(12), end: at(15) },
    { start: at(15), end: at(16) }, // contigua a la anterior: llegada el día de salida
    { start: at(27), end: at(31) },
    { start: at(45), end: at(48) },
  ]
}
