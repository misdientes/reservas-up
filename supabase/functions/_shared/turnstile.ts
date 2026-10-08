// Cloudflare Turnstile (anti-bots, gratuito). La clave secreta vive solo como
// secreto de Supabase (TURNSTILE_SECRET_KEY); la pública, en el frontend.
// En local se usan las claves de prueba oficiales de Cloudflare.

export async function verifyTurnstile(
  token: string,
  secret: string | undefined,
  remoteIp: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!secret || !token) return false
  const body = new URLSearchParams({ secret, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)
  try {
    const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
    if (!response.ok) return false
    const result = (await response.json()) as { success?: boolean }
    return result.success === true
  } catch {
    return false
  }
}
