import { useEffect, useRef, useState } from 'react'
import { t } from '../../lib/i18n'

// Verificación anti-bots de Cloudflare Turnstile (gratuita). Carga el script
// oficial una sola vez y entrega el token al formulario; el servidor lo
// valida con la clave secreta (create-booking). Sin clave pública
// configurada, el formulario no se puede enviar.

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<TurnstileApi> | null = null

function loadScript(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')))
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('turnstile'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

interface Props {
  // Cambia para pedir un token nuevo (cada token sirve una sola vez).
  resetKey: number
  onToken: (token: string | null) => void
}

export function Turnstile({ resetKey, onToken }: Props) {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY
  const box = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  const [failed, setFailed] = useState(!siteKey)

  useEffect(() => {
    onTokenRef.current = onToken
  }, [onToken])

  useEffect(() => {
    if (!siteKey || !box.current) return
    let widgetId: string | null = null
    let cancelled = false
    onTokenRef.current(null)
    loadScript()
      .then((api) => {
        if (cancelled || !box.current) return
        widgetId = api.render(box.current, {
          sitekey: siteKey,
          language: 'es',
          appearance: 'interaction-only',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        })
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      if (widgetId) window.turnstile?.remove(widgetId)
    }
  }, [siteKey, resetKey])

  return (
    <div>
      <div ref={box} />
      {failed && (
        <p role="alert" className="text-body-s text-ink">
          {t.checkout.securityUnavailable}
        </p>
      )}
    </div>
  )
}
