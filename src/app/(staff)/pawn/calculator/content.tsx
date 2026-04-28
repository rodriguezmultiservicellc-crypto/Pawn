'use client'

import { useActionState, useState } from 'react'
import { Calculator, Plus, Trash } from '@phosphor-icons/react'
import {
  calculateSuggestedLoanAction,
  type CalculatorState,
} from './actions'

type Row = {
  id: number
  metal: string
  karat: string
  weight_grams: string
  est_value: string
  appraised_value: string
}

let rowSeq = 1

function blankRow(): Row {
  return {
    id: rowSeq++,
    metal: 'gold',
    karat: '14',
    weight_grams: '',
    est_value: '',
    appraised_value: '',
  }
}

export default function CalculatorContent({
  tenantId,
}: {
  tenantId: string
}) {
  const [rows, setRows] = useState<Row[]>(() => [blankRow()])
  const [ltv, setLtv] = useState('50')
  const [state, formAction, pending] = useActionState<CalculatorState, FormData>(
    calculateSuggestedLoanAction,
    { status: 'idle' },
  )

  function addRow() {
    setRows((r) => [...r, blankRow()])
  }
  function removeRow(id: number) {
    setRows((r) => (r.length > 1 ? r.filter((x) => x.id !== id) : r))
  }
  function patchRow(id: number, patch: Partial<Row>) {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <Calculator size={22} weight="bold" />
            Loan calculator
          </h1>
          <p className="text-sm text-ash">
            Quick estimate combining melt, appraised, and operator-entered
            values. The system picks the highest available basis per row,
            then applies the LTV.
          </p>
        </div>
      </header>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="row_count" value={rows.length} />

        <section className="space-y-2">
          {rows.map((row, idx) => (
            <article
              key={row.id}
              className="rounded-lg border border-hairline bg-canvas p-3"
            >
              <input
                type="hidden"
                name={`row_${idx}_metal`}
                value={row.metal}
              />
              <input
                type="hidden"
                name={`row_${idx}_karat`}
                value={row.karat}
              />
              <input
                type="hidden"
                name={`row_${idx}_weight_grams`}
                value={row.weight_grams}
              />
              <input
                type="hidden"
                name={`row_${idx}_est_value`}
                value={row.est_value}
              />
              <input
                type="hidden"
                name={`row_${idx}_appraised_value`}
                value={row.appraised_value}
              />

              <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <Field label="Item">
                  <span className="block py-1.5 font-mono text-sm text-ash">
                    #{idx + 1}
                  </span>
                </Field>
                <Field label="Metal">
                  <select
                    value={row.metal}
                    onChange={(e) => patchRow(row.id, { metal: e.target.value })}
                    className="w-full rounded-md border border-hairline bg-canvas px-2 py-1.5 text-sm"
                  >
                    <option value="gold">gold</option>
                    <option value="silver">silver</option>
                    <option value="platinum">platinum</option>
                    <option value="palladium">palladium</option>
                    <option value="rose_gold">rose_gold</option>
                    <option value="white_gold">white_gold</option>
                    <option value="other">other</option>
                  </select>
                </Field>
                <Field label="Karat">
                  <input
                    type="text"
                    value={row.karat}
                    onChange={(e) => patchRow(row.id, { karat: e.target.value })}
                    placeholder="14"
                    className="w-full rounded-md border border-hairline bg-canvas px-2 py-1.5 text-sm font-mono"
                  />
                </Field>
                <Field label="Weight (g)">
                  <input
                    type="number"
                    step="0.01"
                    value={row.weight_grams}
                    onChange={(e) =>
                      patchRow(row.id, { weight_grams: e.target.value })
                    }
                    placeholder="0.00"
                    className="w-full rounded-md border border-hairline bg-canvas px-2 py-1.5 text-sm font-mono"
                  />
                </Field>
                <Field label="Est. value $">
                  <input
                    type="number"
                    step="0.01"
                    value={row.est_value}
                    onChange={(e) =>
                      patchRow(row.id, { est_value: e.target.value })
                    }
                    placeholder="0"
                    className="w-full rounded-md border border-hairline bg-canvas px-2 py-1.5 text-sm font-mono"
                  />
                </Field>
                <Field label="Appraised $">
                  <input
                    type="number"
                    step="0.01"
                    value={row.appraised_value}
                    onChange={(e) =>
                      patchRow(row.id, { appraised_value: e.target.value })
                    }
                    placeholder="0"
                    className="w-full rounded-md border border-hairline bg-canvas px-2 py-1.5 text-sm font-mono"
                  />
                </Field>
              </div>

              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  disabled={rows.length === 1}
                  className="inline-flex items-center gap-1 text-xs text-ash hover:text-error disabled:opacity-30"
                >
                  <Trash size={12} weight="bold" />
                  Remove
                </button>
              </div>
            </article>
          ))}

          <button
            type="button"
            onClick={addRow}
            disabled={rows.length >= 20}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-hairline px-3 py-2 text-sm text-ink hover:bg-cloud disabled:opacity-50"
          >
            <Plus size={14} weight="bold" />
            Add item
          </button>
        </section>

        <section className="rounded-lg border border-hairline bg-canvas p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="LTV %">
              <input
                type="number"
                name="ltv_percent"
                min={1}
                max={100}
                step={1}
                value={ltv}
                onChange={(e) => setLtv(e.target.value)}
                className="w-full rounded-md border border-hairline bg-canvas px-2 py-1.5 text-sm font-mono"
              />
              <p className="mt-1 text-[10px] text-ash">
                Loan-to-value as a percent of the value basis. 50% is the
                typical FL pawn default.
              </p>
            </Field>
            <div className="md:col-span-2 flex items-end">
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-rausch px-4 py-2 text-sm font-medium text-canvas hover:bg-rausch-deep disabled:opacity-50"
              >
                {pending ? 'Computing…' : 'Calculate'}
              </button>
            </div>
          </div>
        </section>
      </form>

      <Result state={state} />

      <p className="text-[11px] text-ash">
        Tenant: <span className="font-mono">{tenantId.slice(0, 8)}…</span>
      </p>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] uppercase tracking-wide text-ash">
        {label}
      </span>
      {children}
    </label>
  )
}

function Result({ state }: { state: CalculatorState }) {
  if (state.status === 'idle') return null
  if (state.status === 'error') {
    return (
      <div className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
        {state.error}
      </div>
    )
  }
  const r = state.result
  return (
    <section className="rounded-lg border border-hairline bg-canvas p-4">
      <div className="grid grid-cols-1 gap-4 border-b border-hairline pb-3 md:grid-cols-3">
        <Stat label="Suggested principal" value={fmt(r.totalSuggestedPrincipal)} highlight />
        <Stat label="Total value basis" value={fmt(r.totalValueBasis)} />
        <Stat label="LTV applied" value={`${r.ltvPercent}%`} />
      </div>

      <table className="mt-3 w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-ash">
          <tr>
            <th className="px-2 py-1">#</th>
            <th className="px-2 py-1">Melt</th>
            <th className="px-2 py-1">Appraised</th>
            <th className="px-2 py-1">Estimated</th>
            <th className="px-2 py-1">Basis</th>
            <th className="px-2 py-1 text-right">Suggested</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {r.rows.map((row, i) => (
            <tr key={i}>
              <td className="px-2 py-1 font-mono text-xs text-ash">{i + 1}</td>
              <td className="px-2 py-1 font-mono text-xs">
                {row.meltValue == null ? <span className="text-ash">—</span> : fmt(row.meltValue)}
              </td>
              <td className="px-2 py-1 font-mono text-xs">
                {row.appraisedValue == null ? (
                  <span className="text-ash">—</span>
                ) : (
                  fmt(row.appraisedValue)
                )}
              </td>
              <td className="px-2 py-1 font-mono text-xs">
                {row.estValue == null ? <span className="text-ash">—</span> : fmt(row.estValue)}
              </td>
              <td className="px-2 py-1 text-xs">
                <span className="rounded-md bg-cloud px-1.5 py-0.5 font-mono">
                  {fmt(row.valueBasis)}
                </span>
                <span className="ml-1 text-[10px] text-ash">
                  {row.valueBasisSource}
                </span>
                {row.warnings.length > 0 ? (
                  <span className="ml-1 text-[10px] text-warning">
                    ⚠ {row.warnings.join(', ')}
                  </span>
                ) : null}
              </td>
              <td className="px-2 py-1 text-right font-mono text-xs font-semibold">
                {fmt(row.suggestedPrincipal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ash">{label}</div>
      <div
        className={`mt-0.5 font-mono ${
          highlight ? 'text-2xl text-ink' : 'text-base text-ink'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  })
}
