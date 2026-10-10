import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDeadline } from '../lib/payments'
import type { AuditRow } from './api'
import { ea } from '../lib/i18n/es-admin'

// Historial del panel (admin_audit_log): quién, cuándo y QUÉ CAMPOS cambiaron.
// Nunca valores (datos bancarios, accesos, RUT).
export function AuditList({ recordId, limit = 30 }: { recordId?: string; limit?: number }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    let query = supabase.from('admin_audit_log').select('*').order('at', { ascending: false }).limit(limit)
    if (recordId) query = query.eq('record_id', recordId)
    query.then(({ data }) => !cancelled && setRows((data as AuditRow[]) ?? []))
    return () => {
      cancelled = true
    }
  }, [recordId, limit])

  return (
    <section aria-labelledby="historial" className="mt-7 flex flex-col gap-3">
      {!recordId && (
        <h2 id="historial" className="font-display text-heading-s text-ink">
          {ea.history.heading}
        </h2>
      )}
      {rows === null && <p className="text-body-s text-ink-muted">{ea.common.loading}</p>}
      {rows?.length === 0 && <p className="text-body-s text-ink-muted">{ea.history.empty}</p>}
      <ul className="flex flex-col gap-2">
        {rows?.map((row) => (
          <li key={row.id} className="border-t border-line pt-2 text-body-s text-ink">
            <span className="text-ink-muted">{formatDeadline(row.at)}</span> · {ea.history.tables[row.table_name] ?? row.table_name}{' '}
            {ea.history.ops[row.operation]}
            {row.changed_fields.length > 0 && <span className="text-ink-muted"> · {ea.history.fields(row.changed_fields)}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
