'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { X } from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { formatMoney, shortDateTime } from '@/lib/format/money'
import {
  CALC_METALS,
  CALC_ROWS,
  CALC_UNITS,
  calcValue,
  isCalcMetal,
  parseAmount,
} from '@/lib/spot-prices/calculator'
import type { SpotMetal } from '@/lib/spot-prices/sources/types'
import type { WeightUnit } from '@/lib/bench/weight'
import type { MetalType } from '@/types/database-aliases'

type CalcMetal = { metal: MetalType; pureOz: number | null }

/**
 * Live metals popup: type a weight per purity, read the value at a percent
 * of market. Display only — nothing is saved; the percent starts at the
 * shop's dashboard display percent and can be changed for this quote.
 */
export function MetalCalculator({
  metals,
  initialMetal,
  displayPct,
  updatedAt,
  onClose,
}: {
  metals: ReadonlyArray<CalcMetal>
  initialMetal: MetalType
  /** Shop display fraction (1 = spot). */
  displayPct: number
  updatedAt: string | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const c = t.dashboard.calc
  const [metal, setMetal] = useState<SpotMetal>(isCalcMetal(initialMetal) ? initialMetal : 'gold')
  const [unit, setUnit] = useState<WeightUnit>('ozt')
  const [pctRaw, setPctRaw] = useState(String(Math.round(displayPct * 10000) / 100))
  // Weight per metal + row key, so switching tabs keeps what was typed.
  const [weights, setWeights] = useState<Record<string, string>>({})

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const available = CALC_METALS.filter((m) => metals.some((x) => x.metal === m))
  const pureOz = metals.find((x) => x.metal === metal)?.pureOz ?? null
  const pct = parseAmount(pctRaw)
  const rows = CALC_ROWS[metal]

  const values = useMemo(
    () =>
      rows.map((r) =>
        calcValue(parseAmount(weights[`${metal}:${r.key}`] ?? ''), unit, pureOz, r.fineness, pct),
      ),
    [rows, weights, metal, unit, pureOz, pct],
  )
  const total = values.reduce<number>((s, v) => s + (v ?? 0), 0)
  const anyValue = values.some((v) => v != null)

  const inputCls =
    'h-11 rounded-xl border border-border bg-card px-3 font-mono text-sm text-foreground tabular-nums focus:border-blue focus:outline-none focus-visible:outline-3 focus-visible:outline-blue'

  // Portal to <body>: the widget sits in a sticky rail, which would trap a
  // fixed overlay under the page's cards.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={c.title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-lg">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-display text-xl font-bold text-foreground">{c.title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={c.close}
            className="grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-background hover:text-foreground"
          >
            <X size={18} weight="bold" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div role="tablist" aria-label={c.metal} className="flex flex-wrap gap-2">
            {available.map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={metal === m}
                onClick={() => setMetal(m)}
                className={`h-11 rounded-xl border px-4 text-sm font-bold ${
                  metal === m
                    ? 'border-foreground bg-foreground text-white'
                    : 'border-border bg-card text-foreground hover:bg-background'
                }`}
              >
                {t.spotPrices.metals[m] ?? m}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl bg-background/60 px-4 py-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{c.spot}</div>
              <div className="font-mono text-2xl font-bold tabular-nums text-foreground">
                {formatMoney(pureOz)}
                <span className="ml-1 text-xs font-normal text-muted">{t.dashboard.metalsPerOz}</span>
              </div>
              {updatedAt ? (
                <div className="text-[11px] text-muted">
                  {t.dashboard.metalsUpdated.replace('{when}', shortDateTime(updatedAt))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-sm">
                <span className="block text-[11px] font-semibold text-muted">{c.percent}</span>
                <span className="inline-flex items-center gap-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={pctRaw}
                    onChange={(e) => setPctRaw(e.target.value)}
                    className={`${inputCls} w-24 text-right`}
                  />
                  <span className="text-sm text-muted">%</span>
                </span>
              </label>
              <label className="block text-sm">
                <span className="block text-[11px] font-semibold text-muted">{c.unit}</span>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as WeightUnit)}
                  className={`${inputCls} font-sans`}
                >
                  {CALC_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {c.units[u as keyof typeof c.units]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-background text-left text-[11px] font-bold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">{c.colWeight}</th>
                  <th className="px-3 py-2">{c.colPurity}</th>
                  <th className="px-3 py-2 text-right">{c.colValue}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const key = `${metal}:${r.key}`
                  return (
                    <tr key={key} className="border-t border-border">
                      <td className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-2">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            min="0"
                            value={weights[key] ?? ''}
                            placeholder="0"
                            aria-label={`${c.rows[r.key as keyof typeof c.rows]} — ${c.colWeight}`}
                            onChange={(e) => setWeights((w) => ({ ...w, [key]: e.target.value }))}
                            className={`${inputCls} w-28 text-right`}
                          />
                          <span className="text-xs text-muted">{c.unitShort[unit as keyof typeof c.unitShort]}</span>
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-foreground">
                        {c.rows[r.key as keyof typeof c.rows]}
                        <span className="ml-1 font-mono text-[11px] text-muted">
                          {(r.fineness * 1000).toFixed(1).replace(/\.0$/, '')}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-foreground">
                        {values[i] == null ? '—' : formatMoney(values[i])}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-foreground">
                  <td className="px-3 py-2 text-sm font-bold text-foreground" colSpan={2}>
                    {c.total}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-lg font-bold tabular-nums text-foreground">
                    {anyValue ? formatMoney(Math.round(total * 100) / 100) : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-[11px] text-muted">{c.note}</p>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => setWeights({})}
            className="h-11 rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-background"
          >
            {c.clear}
          </button>
          <Link href="/inventory/spot-prices" className="text-sm font-semibold text-blue hover:text-blue-2">
            {t.dashboard.metalsOpenSpot}
          </Link>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
