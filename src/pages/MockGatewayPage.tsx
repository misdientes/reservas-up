import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { sendMockGatewayAction } from '../lib/api/booking'
import { fetchBookingStatus } from '../lib/api/public'
import { useDocumentMeta } from '../lib/document-meta'
import { formatCLP } from '../lib/money'
import { AlertIcon } from '../components/icons'
import { buttonPrimary, buttonSecondary, container } from '../components/ui'
import { t } from '../lib/i18n'
import { esLocal } from '../lib/i18n/es-local'

// Pasarela de prueba (SOLO entorno local, modo 'localdb'): el router la
// carga con import() dentro de una condición que el build de producción
// elimina. Imita a un proveedor real: el botón envía un aviso de pago
// firmado al webhook (mock-gateway → payment-webhook) y vuelve a
// /reserva/:code, igual que la redirección de un proveedor.

type Action = 'approve' | 'reject' | 'abandon'

export function MockGatewayPage() {
  const { paymentId = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const publicCode = params.get('reserva') ?? ''
  const [amount, setAmount] = useState<number | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(false)

  useDocumentMeta(`${esLocal.mockGateway.metaTitle} · ${t.meta.legalTitle}`)

  useEffect(() => {
    if (!publicCode) return
    fetchBookingStatus(publicCode)
      .then((booking) => setAmount(booking?.total_clp ?? null))
      .catch(() => setAmount(null))
  }, [publicCode])

  async function act(action: Action) {
    setSending(true)
    setError(false)
    try {
      const result = await sendMockGatewayAction(paymentId, action)
      const code = result.public_code ?? publicCode
      if (!result.ok && !code) throw new Error('mock-gateway')
      navigate(`/reserva/${code}`)
    } catch {
      setSending(false)
      setError(true)
    }
  }

  return (
    <section className={`${container} py-10`}>
      <div className="mx-auto flex max-w-prose flex-col gap-5 rounded-xl border border-border-control bg-surface p-7">
        <p role="note" className="flex items-start gap-2 rounded-l bg-dawn p-4 text-body-s text-ink">
          <AlertIcon size={20} className="shrink-0" />
          {esLocal.mockGateway.warning}
        </p>
        <h1 className="font-display text-heading text-ink">{esLocal.mockGateway.title}</h1>
        <div>
          <p className="text-label uppercase tracking-widest text-earth">{esLocal.mockGateway.amount}</p>
          <p className="mt-2 font-display text-heading-s text-ink">{amount === null ? '—' : formatCLP(amount)}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" className={buttonPrimary} disabled={sending} onClick={() => act('approve')}>
            {esLocal.mockGateway.approve}
          </button>
          <button type="button" className={buttonSecondary} disabled={sending} onClick={() => act('reject')}>
            {esLocal.mockGateway.reject}
          </button>
          <button type="button" className={buttonSecondary} disabled={sending} onClick={() => act('abandon')}>
            {esLocal.mockGateway.abandon}
          </button>
        </div>
        <p role="status" aria-live="polite" className="text-body-s text-ink">
          {sending ? esLocal.mockGateway.sending : error ? esLocal.mockGateway.error : ''}
        </p>
      </div>
    </section>
  )
}
