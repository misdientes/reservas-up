import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { supabase } from '../../lib/supabase'
import { formatCLP } from '../../lib/money'
import { buttonPrimary, buttonSecondary } from '../../components/ui'
import type { RateGroupFull } from '../api'
import { ea } from '../../lib/i18n/es-admin'

// Lista de tarifas agrupadas por dueño (Sesión 13).
interface Row extends RateGroupFull {
  owners: { legal_name: string } | null
}

export function RatesPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [props, setProps] = useState<{ name: string; rate_group_id: string | null }[]>([])
  const [seasons, setSeasons] = useState<{ rate_group_id: string }[]>([])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('rate_groups').select('*, owners(legal_name)').order('name'),
      supabase.from('properties').select('name, rate_group_id').order('name'),
      supabase.from('rate_seasons').select('rate_group_id'),
    ]).then(([g, p, s]) => {
      if (cancelled) return
      setRows((g.data as Row[]) ?? [])
      setProps(p.data ?? [])
      setSeasons(s.data ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const owners = [...new Set((rows ?? []).map((r) => r.owners?.legal_name ?? '—'))]
  const r = ea.rates
  return (
    <div className="mt-7 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-heading-s text-ink">{r.heading}</h2>
        <Link to="/admin/tarifas/nueva" className={buttonPrimary}>{r.new}</Link>
      </div>
      <p className="text-body-s text-ink-muted">{r.intro}</p>
      {rows === null && <p className="text-body text-ink-muted">{ea.common.loading}</p>}
      {rows?.length === 0 && <p className="text-body text-ink-muted">{r.empty}</p>}
      {owners.map((owner) => (
        <section key={owner} className="flex flex-col gap-3">
          <h3 className="text-label uppercase tracking-widest text-earth">{owner}</h3>
          <ul className="flex flex-col gap-3">
            {rows!.filter((g) => (g.owners?.legal_name ?? '—') === owner).map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
                <div className="min-w-0">
                  <p className="text-title text-ink">{g.name}</p>
                  <p className="text-body-s text-ink">
                    {formatCLP(g.base_nightly_gross_clp)} {r.perNight} · {r.seasonsCount(seasons.filter((s) => s.rate_group_id === g.id).length)}
                  </p>
                  <p className="text-body-s text-ink-muted">{r.usedBy(props.filter((p) => p.rate_group_id === g.id).map((p) => p.name))}</p>
                </div>
                <Link to={`/admin/tarifas/${g.id}`} className={buttonSecondary}>{ea.common.edit}</Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
