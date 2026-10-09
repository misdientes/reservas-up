import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { buttonSecondary } from '../components/ui'
import { PaymentRow, type QueueItem } from './PaymentRow'
import { t } from '../lib/i18n'

// Cola de pagos (admin_payment_queue): reservas esperando pago manual, con
// saldo pendiente o vencido, y reembolsos pendientes.

type Group = 'waiting' | 'balance' | 'overdue' | 'refund'

function groupOf(item: QueueItem): Group {
  if (item.payment_state === 'reembolso_pendiente') return 'refund'
  if (item.status === 'hold') return 'waiting'
  if (item.payment_state === 'saldo_vencido') return 'overdue'
  return 'balance'
}

const ORDER: Group[] = ['waiting', 'overdue', 'balance', 'refund']

export function PaymentsQueue() {
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('admin_payment_queue')
    if (rpcError) {
      setError(true)
      return
    }
    setError(false)
    setItems(data as QueueItem[])
  }, [])

  useEffect(() => {
    let cancelled = false
    supabase.rpc('admin_payment_queue').then(({ data, error: rpcError }) => {
      if (cancelled) return
      if (rpcError) setError(true)
      else setItems(data as QueueItem[])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const done = (message: string) => {
    setNotice(message)
    void load()
  }

  return (
    <div className="mt-7 flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-heading-s text-ink">{t.admin.paymentsHeading}</h2>
        <button type="button" className={buttonSecondary} onClick={() => void load()}>
          {t.admin.refresh}
        </button>
      </div>

      <p role="status" aria-live="polite" className="text-body text-ink">
        {notice}
      </p>

      {error && <p role="alert" className="text-body text-ink">{t.admin.loadError}</p>}
      {!items && !error && <p className="text-body text-ink-muted">{t.admin.loading}</p>}
      {items && items.length === 0 && <p className="text-body text-ink-muted">{t.admin.empty}</p>}

      {items &&
        ORDER.map((group) => {
          const list = items.filter((item) => groupOf(item) === group)
          if (list.length === 0) return null
          return (
            <section key={group} aria-labelledby={`grupo-${group}`} className="flex flex-col gap-4">
              <h3 id={`grupo-${group}`} className="text-label uppercase tracking-widest text-earth">
                {t.admin.groups[group]} ({list.length})
              </h3>
              <ul className="flex flex-col gap-4">
                {list.map((item) => (
                  <li key={item.reservation_id}>
                    <PaymentRow item={item} onDone={done} />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
    </div>
  )
}
