import { useId } from 'react'
import { formatCLP } from '../../lib/money'
import { depositAvailable, formatDeadline } from '../../lib/payments'
import type { PaymentMethod, PaymentPlan, PaymentPlanQuote } from '../../types/public'
import { labelClass } from './Field'
import { t } from '../../lib/i18n'

interface Props {
  plan: PaymentPlanQuote
  method: PaymentMethod
  payPlan: PaymentPlan
  onMethod: (method: PaymentMethod) => void
  onPayPlan: (plan: PaymentPlan) => void
}

const option =
  'flex cursor-pointer items-start gap-3 rounded-l border border-border-control bg-surface p-4 has-[:checked]:border-pacific has-[:checked]:bg-sand-50'

export function PaymentOptions({ plan, method, payPlan, onMethod, onPayPlan }: Props) {
  const base = useId()
  const methods = plan.allowed_payment_methods ?? []
  const deposit = depositAvailable(plan, method)

  return (
    <section aria-labelledby={`${base}-title`} className="flex flex-col gap-5">
      <h2 id={`${base}-title`} className="font-display text-heading-s text-ink">
        {t.checkout.paymentHeading}
      </h2>

      <fieldset className="flex flex-col gap-3">
        <legend className={`${labelClass} mb-2`}>{t.checkout.methodLegend}</legend>
        {methods.map((m) => (
          <label key={m} className={option}>
            <input type="radio" name={`${base}-method`} value={m} checked={method === m} onChange={() => onMethod(m)}
              className="mt-1 size-5 shrink-0 accent-pacific" />
            <span>
              <span className="block text-body text-ink">{t.checkout.methods[m]?.label ?? m}</span>
              <span className="mt-1 block text-body-s text-ink-muted">{t.checkout.methods[m]?.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className={`${labelClass} mb-2`}>{t.checkout.planLegend}</legend>
        {deposit && (
          <label className={option}>
            <input type="radio" name={`${base}-plan`} value="deposit" checked={payPlan === 'deposit'} onChange={() => onPayPlan('deposit')}
              className="mt-1 size-5 shrink-0 accent-pacific" />
            <span>
              <span className="block text-body text-ink">{t.checkout.planDeposit(formatCLP(plan.deposit_clp ?? 0))}</span>
              <span className="mt-1 block text-body-s text-ink-muted">
                {t.checkout.planDepositHint(formatCLP(plan.balance_clp ?? 0), formatDeadline(plan.balance_due_at ?? ''))}
              </span>
            </span>
          </label>
        )}
        <label className={option}>
          <input type="radio" name={`${base}-plan`} value="full" checked={payPlan === 'full' || !deposit} onChange={() => onPayPlan('full')}
            className="mt-1 size-5 shrink-0 accent-pacific" />
          <span>
            <span className="block text-body text-ink">{t.checkout.planFull(formatCLP(plan.total_clp ?? 0))}</span>
            <span className="mt-1 block text-body-s text-ink-muted">{t.checkout.planFullHint}</span>
          </span>
        </label>
        {plan.requires_full && method !== 'gateway' && <p className="text-body-s text-ink-muted">{t.checkout.fullRequired}</p>}
      </fieldset>

      {method !== 'gateway' && plan.manual_payment_window_hours && (
        <p className="text-body-s text-ink">{t.checkout.manualWindow(plan.manual_payment_window_hours)}</p>
      )}
    </section>
  )
}
