import type { BookingRequest } from '../../../supabase/functions/_shared/booking-input.ts'

// Llamadas a las Edge Functions del checkout. Solo la clave pública: el
// servidor decide el precio, la disponibilidad y el cobro.

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1`
const PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export type CreateBookingResponse =
  | { ok: true; payment_url: string; public_code: string; total_clp: number }
  | { ok: false; reason: string; total_clp?: number; errors?: Partial<Record<string, string>> }

async function post<T>(fn: string, body: unknown): Promise<T> {
  const response = await fetch(`${FUNCTIONS_URL}/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: PUBLIC_KEY },
    body: JSON.stringify(body),
  })
  try {
    return (await response.json()) as T
  } catch {
    throw new Error(`${fn}: respuesta inválida (${response.status})`)
  }
}

export function createBooking(request: BookingRequest): Promise<CreateBookingResponse> {
  return post<CreateBookingResponse>('create-booking', request)
}

// Solo entorno local (la función no existe en producción).
export function sendMockGatewayAction(
  paymentId: string,
  action: 'approve' | 'reject' | 'abandon',
): Promise<{ ok: boolean; outcome?: string; public_code?: string }> {
  return post('mock-gateway', { payment_id: paymentId, action })
}
