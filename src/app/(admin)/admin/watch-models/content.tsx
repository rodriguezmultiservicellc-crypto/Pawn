'use client'

import { useActionState, useMemo, useState } from 'react'
import {
  CheckCircle,
  PencilSimple,
  Plus,
  Trash,
  Warning,
  Watch,
} from '@phosphor-icons/react'
import {
  saveWatchModelAction,
  deleteWatchModelAction,
  type WatchModelState,
} from './actions'

export type WatchModelRow = {
  id: string
  brand: string
  model: string
  reference_no: string | null
  nickname: string | null
  year_start: number | null
  year_end: number | null
  est_value_min: number
  est_value_max: number
  notes: string | null
  created_at: string
  updated_at: string
}

export default function WatchModelsContent({
  rows,
}: {
  rows: WatchModelRow[]
}) {
  const [editing, setEditing] = useState<WatchModelRow | 'new' | null>(null)
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.brand, r.model, r.reference_no, r.nickname]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    )
  }, [rows, filter])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Watch size={22} weight="bold" />
            Watch models
          </h1>
          <p className="mt-1 text-sm text-muted">
            Curated reference table used by the suggested-loan
            calculator. Pre-owned wholesale floor ranges in USD —
            operators see these in the typeahead at intake.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1 rounded-md bg-gold px-3 py-2 text-sm font-medium text-navy hover:bg-gold-2"
        >
          <Plus size={14} weight="bold" />
          Add model
        </button>
      </header>

      <input
        type="search"
        placeholder="Filter by brand, model, ref…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full max-w-sm rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
      />

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-background text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Brand</th>
              <th className="px-3 py-2 text-left font-medium">Model</th>
              <th className="px-3 py-2 text-left font-medium">Ref / nickname</th>
              <th className="px-3 py-2 text-left font-medium">Years</th>
              <th className="px-3 py-2 text-right font-medium">Range (USD)</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 font-medium text-foreground">{r.brand}</td>
                <td className="px-3 py-2 text-foreground">{r.model}</td>
                <td className="px-3 py-2 text-xs">
                  {r.reference_no ? (
                    <span className="font-mono text-foreground">{r.reference_no}</span>
                  ) : null}
                  {r.nickname ? (
                    <span className="ml-2 italic text-muted">{r.nickname}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-xs text-muted">
                  {r.year_start ?? '—'}{' – '}{r.year_end ?? 'present'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                  {usd(r.est_value_min)} – {usd(r.est_value_max)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setEditing(r)}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:border-foreground"
                  >
                    <PencilSimple size={11} weight="bold" />
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-sm text-muted"
                >
                  No models match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {editing ? (
        <EditDialog
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  )
}

function EditDialog({
  row,
  onClose,
}: {
  row: WatchModelRow | null
  onClose: () => void
}) {
  const [state, formAction, pending] = useActionState<
    WatchModelState,
    FormData
  >(saveWatchModelAction, {})
  const [delState, delAction, delPending] = useActionState<
    { ok?: boolean; error?: string },
    FormData
  >(deleteWatchModelAction, {})

  const fe = (k: string) => state.fieldErrors?.[k]

  // Auto-close on success.
  if (state.ok || delState.ok) {
    setTimeout(onClose, 300)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
    >
      <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-5 shadow-lg">
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">
            {row ? 'Edit watch model' : 'Add watch model'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground"
            aria-label="close"
          >
            ×
          </button>
        </header>

        {state.error || delState.error ? (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            <Warning size={14} weight="bold" />
            <span>{state.error ?? delState.error}</span>
          </div>
        ) : null}
        {state.ok || delState.ok ? (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
            <CheckCircle size={14} weight="bold" />
            <span>Saved.</span>
          </div>
        ) : null}

        <form action={formAction} className="space-y-3">
          {row ? <input type="hidden" name="id" value={row.id} /> : null}
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Brand"
              name="brand"
              defaultValue={row?.brand ?? ''}
              required
              error={fe('brand')}
            />
            <Field
              label="Model"
              name="model"
              defaultValue={row?.model ?? ''}
              required
              error={fe('model')}
            />
            <Field
              label="Reference no."
              name="reference_no"
              defaultValue={row?.reference_no ?? ''}
              error={fe('reference_no')}
            />
            <Field
              label="Nickname"
              name="nickname"
              defaultValue={row?.nickname ?? ''}
              error={fe('nickname')}
              hint="Hulk / Pepsi / James Bond / etc."
            />
            <Field
              label="Year start"
              name="year_start"
              type="number"
              defaultValue={row?.year_start?.toString() ?? ''}
              error={fe('year_start')}
            />
            <Field
              label="Year end"
              name="year_end"
              type="number"
              defaultValue={row?.year_end?.toString() ?? ''}
              error={fe('year_end')}
            />
            <Field
              label="Est. value min (USD)"
              name="est_value_min"
              type="number"
              required
              defaultValue={row?.est_value_min?.toString() ?? ''}
              error={fe('est_value_min')}
            />
            <Field
              label="Est. value max (USD)"
              name="est_value_max"
              type="number"
              required
              defaultValue={row?.est_value_max?.toString() ?? ''}
              error={fe('est_value_max')}
            />
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-foreground">Notes</span>
            <textarea
              name="notes"
              rows={3}
              defaultValue={row?.notes ?? ''}
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10"
            />
          </label>

          <div className="flex items-center justify-between gap-3">
            {row ? (
              <form action={delAction}>
                <input type="hidden" name="id" value={row.id} />
                <button
                  type="submit"
                  disabled={delPending}
                  className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                >
                  <Trash size={12} weight="bold" />
                  {delPending ? 'Deleting…' : 'Delete'}
                </button>
              </form>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:border-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-gold px-3 py-2 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
              >
                {pending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({
  label,
  name,
  type = 'text',
  required,
  defaultValue,
  error,
  hint,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  defaultValue?: string
  error?: string
  hint?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-foreground">
        {label}
        {required ? ' *' : null}
      </span>
      <input
        type={type}
        name={name}
        required={required}
        defaultValue={defaultValue}
        className={`block w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/10 ${
          error ? 'border-danger/60' : 'border-border'
        }`}
      />
      {error ? (
        <span className="block text-[10px] text-danger">{error}</span>
      ) : hint ? (
        <span className="block text-[10px] text-muted">{hint}</span>
      ) : null}
    </label>
  )
}

function usd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}
