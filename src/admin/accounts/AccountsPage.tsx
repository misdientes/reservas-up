import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { Field } from '../../components/checkout/Field'
import { buttonPrimary, buttonSecondary } from '../../components/ui'
import { CheckIcon, AlertIcon } from '../../components/icons'
import { errorMessage, isStale, type AccountRow, type AccountSummary, type OwnerRow } from '../api'
import { validateAccount } from '../validation'
import { formatRut } from '../../../supabase/functions/_shared/rut.ts'
import { Check, SaveBar, Select } from '../ui'
import { ea } from '../../lib/i18n/es-admin'

// Cuentas de cobro: en la lista el número va enmascarado; la ficha carga el
// dato completo solo para el admin. De la pasarela se guarda el NOMBRE del
// secreto con la clave, nunca la clave.

export function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('admin_payment_accounts')
    setAccounts((data as AccountSummary[]) ?? [])
  }, [])

  useEffect(() => {
    let cancelled = false
    supabase.rpc('admin_payment_accounts').then(({ data }) => !cancelled && setAccounts((data as AccountSummary[]) ?? []))
    return () => {
      cancelled = true
    }
  }, [])

  const a = ea.accounts
  return (
    <div className="mt-7 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-heading-s text-ink">{a.heading}</h2>
        {editing === null && <button type="button" className={buttonPrimary} onClick={() => setEditing('new')}>{a.new}</button>}
      </div>
      {editing !== null && (
        <AccountForm accountId={editing === 'new' ? null : editing} onDone={() => { setEditing(null); void load() }} onCancel={() => setEditing(null)} />
      )}
      {accounts === null && <p className="text-body text-ink-muted">{ea.common.loading}</p>}
      {accounts?.length === 0 && <p className="text-body text-ink-muted">{a.empty}</p>}
      <ul className="flex flex-col gap-3">
        {accounts?.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-col gap-2">
              <p className="text-title text-ink">{x.label}{!x.is_active && ` · ${ea.common.no} ${a.active.toLowerCase()}`}</p>
              <p className="text-body-s text-ink-muted">{x.owner_name}{x.bank_name ? ` · ${x.bank_name}` : ''}{x.account_number_masked ? ` ${x.account_number_masked}` : ''}</p>
              <p className="flex items-center gap-2 text-body-s text-ink">
                {!x.provider ? a.noGateway : x.gateway_ready
                  ? <><CheckIcon size={20} className="text-pacific" />{a.ready}</>
                  : <><AlertIcon size={20} className="text-danger" />{a.notReady}</>}
                {' · '}{a.usedBy(x.used_by)}
              </p>
            </div>
            <button type="button" className={buttonSecondary} onClick={() => setEditing(x.id)}>{ea.common.edit}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

type Form = Omit<AccountRow, 'id' | 'updated_at'>
const EMPTY: Form = {
  owner_id: '', label: '', provider: null, bank_name: null, account_type: null, account_number: null, holder_name: null,
  holder_rut: null, holder_email: null, gateway_account_id: null, gateway_environment: null, gateway_secret_name: null, is_active: true,
}

function AccountForm({ accountId, onDone, onCancel }: { accountId: string | null; onDone: () => void; onCancel: () => void }) {
  const id = useId()
  const [row, setRow] = useState<AccountRow | null>(null)
  const [v, setV] = useState<Form>(EMPTY)
  const [owners, setOwners] = useState<Pick<OwnerRow, 'id' | 'legal_name'>[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [stale, setStale] = useState(false)

  useEffect(() => {
    supabase.from('owners').select('id, legal_name').order('legal_name').then(({ data }) => setOwners(data ?? []))
    if (accountId) {
      supabase.from('payment_accounts').select('*').eq('id', accountId).single().then(({ data }) => {
        setRow(data as AccountRow)
        setV(data as AccountRow)
      })
    }
  }, [accountId])

  const set = <K extends keyof Form>(k: K) => (value: Form[K]) => setV((s) => ({ ...s, [k]: value }))
  const input = (k: keyof Form) => (e: { target: { value: string } }) => set(k)((e.target.value || null) as never)

  async function save(event: FormEvent) {
    event.preventDefault()
    const e = validateAccount({
      label: v.label ?? '', provider: v.provider ?? '', gateway_account_id: v.gateway_account_id ?? '',
      gateway_secret_name: v.gateway_secret_name ?? '', holder_rut: v.holder_rut ?? '',
    }) as Record<string, string>
    if (!v.owner_id) e.owner_id = 'required'
    setErrors(e)
    if (Object.keys(e).length) return setMessage({ ok: false, text: ea.common.genericError })
    setSaving(true)
    const values = {
      ...v,
      holder_rut: v.holder_rut ? formatRut(v.holder_rut) : null,
      gateway_account_id: v.provider === 'tuu' ? v.gateway_account_id : null,
      gateway_environment: v.provider === 'tuu' ? (v.gateway_environment ?? 'integration') : null,
      gateway_secret_name: v.provider ? v.gateway_secret_name : null,
    }
    const { error } = row
      ? await supabase.from('payment_accounts').update({ ...values, updated_at: row.updated_at }).eq('id', row.id)
      : await supabase.from('payment_accounts').insert(values)
    setSaving(false)
    setStale(isStale(error))
    if (error) return setMessage({ ok: false, text: errorMessage(error) })
    onDone()
  }

  if (accountId && !row) return <p className="text-body text-ink-muted">{ea.common.loading}</p>
  const a = ea.accounts
  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-5 rounded-xl border border-border-control bg-sand-50 p-5">
      <Select id={`${id}-owner`} label={a.owner} value={v.owner_id} onChange={(e) => set('owner_id')(e.target.value)}>
        <option value="">{ea.common.none}</option>
        {owners.map((o) => <option key={o.id} value={o.id}>{o.legal_name}</option>)}
      </Select>
      {errors.owner_id && <p className="text-body-s text-danger">{ea.common.required}</p>}
      <Field id={`${id}-label`} label={a.label} required maxLength={80} value={v.label ?? ''} onChange={(e) => set('label')(e.target.value)} error={errors.label ? ea.common.required : null} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={`${id}-bank`} label={a.bankName} maxLength={80} value={v.bank_name ?? ''} onChange={input('bank_name')} autoComplete="off" />
        <Field id={`${id}-type`} label={a.accountType} maxLength={60} value={v.account_type ?? ''} onChange={input('account_type')} autoComplete="off" />
        <Field id={`${id}-number`} label={a.accountNumber} maxLength={40} value={v.account_number ?? ''} onChange={input('account_number')} autoComplete="off" />
        <Field id={`${id}-holder`} label={a.holderName} maxLength={120} value={v.holder_name ?? ''} onChange={input('holder_name')} autoComplete="off" />
        <Field id={`${id}-hrut`} label={a.holderRut} maxLength={14} value={v.holder_rut ?? ''} onChange={input('holder_rut')} error={errors.holder_rut ? ea.owners.rutInvalid : null} autoComplete="off" />
        <Field id={`${id}-hemail`} label={a.holderEmail} type="email" maxLength={254} value={v.holder_email ?? ''} onChange={input('holder_email')} autoComplete="off" />
      </div>
      <Select id={`${id}-provider`} label={a.provider} value={v.provider ?? ''} onChange={(e) => set('provider')(e.target.value || null)}>
        {Object.entries(a.providers).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      {v.provider === 'tuu' && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={`${id}-gwid`} label={a.gatewayAccountId} maxLength={80} value={v.gateway_account_id ?? ''} onChange={input('gateway_account_id')} error={errors.gateway_account_id ? ea.common.required : null} autoComplete="off" />
          <Select id={`${id}-env`} label={a.gatewayEnvironment} value={v.gateway_environment ?? 'integration'} onChange={(e) => set('gateway_environment')(e.target.value)}>
            {Object.entries(a.environments).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Field id={`${id}-secret`} label={a.secretName} hint={a.secretHint} maxLength={64} value={v.gateway_secret_name ?? ''}
            onChange={(e) => set('gateway_secret_name')(e.target.value.toUpperCase() || null)} error={errors.gateway_secret_name ? a.secretInvalid : null} autoComplete="off" className="sm:col-span-2" />
        </div>
      )}
      <Check label={a.active} checked={v.is_active} onChange={set('is_active')} />
      <SaveBar saving={saving} message={message} stale={stale} onReload={onDone} />
      <button type="button" className={`${buttonSecondary} self-start`} onClick={onCancel}>{ea.common.cancel}</button>
    </form>
  )
}
