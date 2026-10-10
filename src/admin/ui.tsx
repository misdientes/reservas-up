import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { AlertIcon } from '../components/icons'
import { buttonPrimary, buttonSecondary } from '../components/ui'
import { FieldError, fieldClass, labelClass } from '../components/checkout/Field'
import { ea } from '../lib/i18n/es-admin'

// Piezas compartidas del panel (solo tokens Costa y Pampa).

export function Section({ id, title, children, defaultOpen = true }: { id: string; title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-xl border border-line bg-surface">
      <summary className="flex min-h-10 cursor-pointer items-center px-5 py-4 font-display text-heading-s text-ink" id={id}>
        {title}
      </summary>
      <div className="flex flex-col gap-5 border-t border-line p-5">{children}</div>
    </details>
  )
}

export function TextArea({ id, label, hint, error, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { id: string; label: string; hint?: string; error?: string | null }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <textarea id={id} rows={5} aria-invalid={error ? true : undefined} aria-describedby={hint ? `${id}-ayuda` : undefined}
        className={`${fieldClass} py-2 ${error ? 'border-danger' : 'border-border-control'}`} {...props} />
      {hint && <p id={`${id}-ayuda`} className="text-body-s text-ink-muted">{hint}</p>}
      <FieldError message={error} />
    </div>
  )
}

export function Select({ id, label, hint, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select id={id} className={`${fieldClass} border-border-control`} aria-describedby={hint ? `${id}-ayuda` : undefined} {...props}>
        {children}
      </select>
      {hint && <p id={`${id}-ayuda`} className="text-body-s text-ink-muted">{hint}</p>}
    </div>
  )
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-10 items-center gap-3 text-body text-ink">
      <input type="checkbox" className="size-5 shrink-0 accent-pacific" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

// Barra de guardado con mensaje (y "Recargar" si la ficha cambió en otro dispositivo).
export function SaveBar({ saving, message, stale, onReload, label = ea.common.save }: {
  saving: boolean
  message: { ok: boolean; text: string } | null
  stale?: boolean
  onReload?: () => void
  label?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" className={buttonPrimary} disabled={saving} aria-busy={saving}>
        {saving ? ea.common.saving : label}
      </button>
      <p role="status" aria-live="polite" className={`flex items-start gap-2 text-body-s ${message && !message.ok ? 'text-danger' : 'text-ink'}`}>
        {message && !message.ok && <AlertIcon size={20} className="shrink-0" />}
        {message?.text}
      </p>
      {stale && onReload && (
        <button type="button" className={buttonSecondary} onClick={onReload}>
          {ea.common.reload}
        </button>
      )}
    </div>
  )
}

// Campo numérico con "usar valor global" (null = global de app_settings).
export function OverrideNumber({ id, label, value, globalValue, onChange, min, max }: {
  id: string
  label: string
  value: number | null
  globalValue: string
  onChange: (v: number | null) => void
  min: number
  max: number
}) {
  const useGlobal = value === null
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input id={id} type="number" inputMode="numeric" min={min} max={max} disabled={useGlobal}
          value={useGlobal ? globalValue : value} onChange={(e) => onChange(e.target.value === '' ? min : Number(e.target.value))}
          className={`${fieldClass} w-1/3 border-border-control disabled:opacity-50`} />
        <Check label={ea.common.useGlobal} checked={useGlobal} onChange={(v) => onChange(v ? null : Number(globalValue) || min)} />
      </div>
      <p className="text-body-s text-ink-muted">{ea.common.globalValue(globalValue)}</p>
    </div>
  )
}
