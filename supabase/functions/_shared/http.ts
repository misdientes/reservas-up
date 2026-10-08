// Utilidades HTTP de las Edge Functions públicas: CORS acotado a los
// orígenes del sitio (ALLOWED_ORIGINS) y respuestas JSON.

export function corsHeaders(request: Request, allowedCsv: string | undefined): Record<string, string> {
  const origin = request.headers.get('origin') ?? ''
  const allowed = (allowedCsv ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
  if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  })
}

// IP del cliente según el proxy de Supabase/Cloudflare (solo para el HMAC).
export function clientIp(request: Request): string | null {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null
  )
}
