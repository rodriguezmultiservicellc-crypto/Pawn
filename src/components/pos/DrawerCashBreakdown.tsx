'use client'

import { useI18n } from '@/lib/i18n/context'
import {
  DRAWER_LINES_IN,
  DRAWER_LINES_OUT,
  drawerCashNet,
  type DrawerCashLines,
} from '@/lib/pos/drawer-cash'

const fmt = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

/**
 * Where the drawer's cash came from and went to, one line per kind
 * (loadDrawerCash). Lines with nothing on them are left out; the net is
 * always shown.
 */
export function DrawerCashBreakdown({ cash }: { cash: DrawerCashLines }) {
  const { t } = useI18n()
  const d = t.pos.drawerCash
  const label = d.lines as Record<keyof DrawerCashLines, string>
  const ins = DRAWER_LINES_IN.filter((k) => cash[k] !== 0)
  const outs = DRAWER_LINES_OUT.filter((k) => cash[k] !== 0)
  return (
    <div className="text-sm">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{d.title}</div>
      <ul className="divide-y divide-border">
        {ins.map((k) => (
          <li key={k} className="flex justify-between gap-3 py-1">
            <span className="text-foreground">{label[k]}</span>
            <span className="font-mono text-foreground">+ {fmt(cash[k])}</span>
          </li>
        ))}
        {outs.map((k) => (
          <li key={k} className="flex justify-between gap-3 py-1">
            <span className="text-foreground">{label[k]}</span>
            <span className="font-mono text-foreground">− {fmt(cash[k])}</span>
          </li>
        ))}
        <li className="flex justify-between gap-3 py-1 font-semibold">
          <span className="text-foreground">{d.net}</span>
          <span className="font-mono text-navy">{fmt(drawerCashNet(cash))}</span>
        </li>
      </ul>
    </div>
  )
}
