// Parámetros de búsqueda en la URL. Viajan del buscador al listado y del
// listado a la ficha de cada propiedad (la Sesión 6 los usa para el
// calendario y la cotización).

export interface StaySearch {
  destino: string
  llegada: string
  salida: string
  huespedes: number | null
}

export const MAX_GUESTS_OPTION = 10

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function readStaySearch(params: URLSearchParams): StaySearch {
  const guests = Number(params.get('huespedes'))
  return {
    destino: params.get('destino') ?? '',
    llegada: ISO_DATE.test(params.get('llegada') ?? '') ? params.get('llegada')! : '',
    salida: ISO_DATE.test(params.get('salida') ?? '') ? params.get('salida')! : '',
    huespedes: Number.isInteger(guests) && guests >= 1 && guests <= MAX_GUESTS_OPTION ? guests : null,
  }
}

export function toSearchParams(search: Partial<StaySearch>): URLSearchParams {
  const params = new URLSearchParams()
  if (search.destino) params.set('destino', search.destino)
  if (search.llegada) params.set('llegada', search.llegada)
  if (search.salida) params.set('salida', search.salida)
  if (search.huespedes) params.set('huespedes', String(search.huespedes))
  return params
}

// Fecha de hoy en Chile (las estadías se cuentan en America/Santiago).
export function todayInSantiago(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}
