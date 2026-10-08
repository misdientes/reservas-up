import type { InputHTMLAttributes } from 'react'
import { AlertIcon } from '../icons'

// Campo de formulario con label real, ayuda y error asociados por
// aria-describedby (el lector de pantalla los lee al enfocar el campo).

export const fieldClass = 'min-h-10 w-full rounded-m border bg-sand-50 px-3 text-body text-ink'
export const labelClass = 'text-label uppercase tracking-widest text-ink'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  label: string
  hint?: string
  error?: string | null
}

export function Field({ id, label, hint, error, className, ...input }: Props) {
  const hintId = hint ? `${id}-ayuda` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
        className={`${fieldClass} ${error ? 'border-danger' : 'border-border-control'}`}
        {...input}
      />
      {hint && (
        <p id={hintId} className="text-body-s text-ink-muted">
          {hint}
        </p>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  )
}

export function FieldError({ id, message }: { id?: string; message?: string | null }) {
  if (!message) return null
  return (
    <p id={id} className="flex items-start gap-2 text-body-s text-danger">
      <AlertIcon size={20} className="shrink-0 text-danger" />
      {message}
    </p>
  )
}
