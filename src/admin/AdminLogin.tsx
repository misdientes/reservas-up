import { useId, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Field } from '../components/checkout/Field'
import { buttonPrimary } from '../components/ui'
import { t } from '../lib/i18n'

// Enlace mágico: Supabase envía un correo con un enlace de un solo uso.
// shouldCreateUser: false → nunca crea usuarios (solo entra el admin existente).
export function AdminLogin() {
  const id = useId()
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!email.trim()) return
    setState('sending')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/admin` },
    })
    setState(error ? 'error' : 'sent')
  }

  return (
    <form onSubmit={submit} className="mt-7 flex max-w-prose flex-col gap-5">
      <div>
        <h2 className="font-display text-heading-s text-ink">{t.admin.loginHeading}</h2>
        <p className="mt-2 text-body text-ink-muted">{t.admin.loginIntro}</p>
      </div>
      <Field id={`${id}-email`} label={t.admin.loginEmail} type="email" autoComplete="email" required
        value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit" className={`${buttonPrimary} self-start`} disabled={state === 'sending'} aria-busy={state === 'sending'}>
        {state === 'sending' ? t.admin.loginSending : t.admin.loginSend}
      </button>
      <p role="status" aria-live="polite" className="text-body text-ink">
        {state === 'sent' ? t.admin.loginSent : state === 'error' ? t.admin.loginError : ''}
      </p>
    </form>
  )
}
