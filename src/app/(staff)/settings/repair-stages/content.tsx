'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle,
  Plus,
  Trash,
} from '@phosphor-icons/react'
import { useI18n } from '@/lib/i18n/context'
import { serviceTypeLabel } from '@/components/repair/ServiceTypeBadge'
import { MAPPABLE_STATUSES, SERVICE_TYPES } from '@/lib/repair/stages'
import {
  resetRepairStagesAction,
  saveRepairNotifyAction,
  saveRepairStagesAction,
  type SaveNotifyState,
  type SaveStagesState,
} from './actions'
import type { RepairStatus, ServiceType } from '@/types/database-aliases'

export type StageEditRow = {
  /** null = new row, not yet saved. */
  id: string | null
  name_en: string
  name_es: string
  percent: number
  maps_to_statuses: RepairStatus[]
  is_active: boolean
}

export type StagesByTypeView = Partial<Record<ServiceType, StageEditRow[]>>

export default function RepairStagesContent({
  stagesByType,
  autoNotify,
}: {
  stagesByType: StagesByTypeView
  autoNotify: boolean
}) {
  const { t } = useI18n()
  const ts = t.settingsRepairStages
  const [type, setType] = useState<ServiceType>('repair')

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} weight="bold" />
          {t.common.back}
        </Link>
      </div>

      <header>
        <h1 className="font-display text-2xl font-bold text-foreground">{ts.title}</h1>
        <p className="mt-1 text-sm text-muted">{ts.subtitle}</p>
      </header>

      <AutoNotifyCard initial={autoNotify} />

      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap gap-1 border-b border-border p-2" role="tablist" aria-label={ts.serviceType}>
          {SERVICE_TYPES.map((st) => (
            <button
              key={st}
              type="button"
              role="tab"
              aria-selected={type === st}
              onClick={() => setType(st)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                type === st
                  ? 'bg-navy text-white'
                  : 'text-foreground hover:bg-background'
              }`}
            >
              {serviceTypeLabel(t, st)}
              <span className="ml-1.5 font-mono text-[10px] opacity-70">
                {(stagesByType[st] ?? []).filter((r) => r.is_active).length}
              </span>
            </button>
          ))}
        </div>
        {/* key resets the editor's local rows when the tab changes */}
        <StageEditor key={type} serviceType={type} initialRows={stagesByType[type] ?? []} />
      </section>
    </div>
  )
}

function AutoNotifyCard({ initial }: { initial: boolean }) {
  const { t } = useI18n()
  const ts = t.settingsRepairStages
  const [state, formAction, pending] = useActionState<SaveNotifyState, FormData>(
    saveRepairNotifyAction,
    {},
  )
  const [checked, setChecked] = useState(initial)
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">{ts.autoNotifyTitle}</h2>
      <p className="mt-1 text-xs text-muted">{ts.autoNotifyHelp}</p>
      <form action={formAction} className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="repair_ready_auto_notify"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-gold"
          />
          {ts.autoNotifyLabel}
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-gold px-3 py-1.5 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
        >
          {pending ? t.common.saving : t.common.save}
        </button>
        {state.ok ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <CheckCircle size={14} weight="fill" />
            {t.common.save} ✓
          </span>
        ) : null}
        {state.error ? (
          <span className="text-xs text-danger" role="alert">
            {state.error}
          </span>
        ) : null}
      </form>
    </section>
  )
}

function StageEditor({
  serviceType,
  initialRows,
}: {
  serviceType: ServiceType
  initialRows: StageEditRow[]
}) {
  const { t } = useI18n()
  const ts = t.settingsRepairStages
  const [rows, setRows] = useState<StageEditRow[]>(() =>
    initialRows.map((r) => ({ ...r, maps_to_statuses: [...r.maps_to_statuses] })),
  )
  const [saveState, saveAction, saving] = useActionState<SaveStagesState, FormData>(
    saveRepairStagesAction,
    {},
  )
  const [resetState, resetAction, resetting] = useActionState<SaveStagesState, FormData>(
    resetRepairStagesAction,
    {},
  )

  function patch(i: number, p: Partial<StageEditRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)))
  }
  function move(i: number, dir: -1 | 1) {
    setRows((rs) => {
      const j = i + dir
      if (j < 0 || j >= rs.length) return rs
      const next = [...rs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  function remove(i: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs))
  }
  function add() {
    setRows((rs) => [
      ...rs,
      {
        id: null,
        name_en: '',
        name_es: '',
        percent: Math.min(100, (rs[rs.length - 1]?.percent ?? 0) + 10),
        maps_to_statuses: [],
        is_active: true,
      },
    ])
  }
  function toggleStatus(i: number, s: RepairStatus) {
    setRows((rs) =>
      rs.map((r, idx) => {
        if (idx !== i) return r
        const has = r.maps_to_statuses.includes(s)
        return {
          ...r,
          maps_to_statuses: has
            ? r.maps_to_statuses.filter((x) => x !== s)
            : [...r.maps_to_statuses, s],
        }
      }),
    )
  }

  const errText = (code: string | undefined) =>
    code == null ? null : (ts.errors as Record<string, string>)[code] ?? code

  const statusLabels = t.repair.statusBadges as Record<string, string>

  return (
    <div className="p-4">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted">
              <th className="py-2 pr-2 font-semibold">{ts.columnOrder}</th>
              <th className="py-2 pr-2 font-semibold">{ts.nameEn}</th>
              <th className="py-2 pr-2 font-semibold">{ts.nameEs}</th>
              <th className="py-2 pr-2 font-semibold">{ts.percent}</th>
              <th className="py-2 pr-2 font-semibold">
                {ts.mapsTo}
                <span className="ml-1 block normal-case tracking-normal text-muted/80">
                  {ts.mapsToHelp}
                </span>
              </th>
              <th className="py-2 pr-2 font-semibold">{ts.active}</th>
              <th className="py-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const rowErr = saveState.rowErrors?.[i]
              return (
                <tr
                  key={r.id ?? `new-${i}`}
                  className={`border-b border-border/60 align-top ${rowErr ? 'bg-danger/5' : ''}`}
                >
                  <td className="py-2 pr-2 font-mono text-xs text-muted">
                    <div className="flex items-center gap-1">
                      {i + 1}
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title={ts.moveUp} aria-label={ts.moveUp} className="rounded p-0.5 text-muted hover:text-foreground disabled:opacity-30">
                        <ArrowUp size={12} weight="bold" />
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} title={ts.moveDown} aria-label={ts.moveDown} className="rounded p-0.5 text-muted hover:text-foreground disabled:opacity-30">
                        <ArrowDown size={12} weight="bold" />
                      </button>
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      value={r.name_en}
                      onChange={(e) => patch(i, { name_en: e.target.value })}
                      maxLength={60}
                      aria-label={ts.nameEn}
                      className="w-40 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      value={r.name_es}
                      onChange={(e) => patch(i, { name_es: e.target.value })}
                      maxLength={60}
                      aria-label={ts.nameEs}
                      className="w-40 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={r.percent}
                      onChange={(e) => patch(i, { percent: Number(e.target.value) })}
                      aria-label={ts.percent}
                      className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-sm text-foreground"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {MAPPABLE_STATUSES.map((s) => {
                        const on = r.maps_to_statuses.includes(s)
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => toggleStatus(i, s)}
                            aria-pressed={on}
                            className={`rounded-full border px-2 py-0.5 text-[11px] ${
                              on
                                ? 'border-gold bg-gold/15 text-foreground'
                                : 'border-border text-muted hover:text-foreground'
                            }`}
                          >
                            {statusLabels[s] ?? s}
                          </button>
                        )
                      })}
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      checked={r.is_active}
                      onChange={(e) => patch(i, { is_active: e.target.checked })}
                      aria-label={ts.active}
                      className="mt-1 h-4 w-4 rounded border-border accent-gold"
                    />
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      disabled={rows.length <= 1}
                      title={ts.remove}
                      aria-label={ts.remove}
                      className="rounded p-1 text-muted hover:text-danger disabled:opacity-30"
                    >
                      <Trash size={14} weight="bold" />
                    </button>
                    {rowErr ? (
                      <div className="mt-1 text-[11px] text-danger">{errText(rowErr)}</div>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={add}
          disabled={rows.length >= 30}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-foreground hover:bg-background disabled:opacity-50"
        >
          <Plus size={14} weight="bold" />
          {ts.addStage}
        </button>

        <form action={saveAction} className="inline-flex items-center gap-2">
          <input type="hidden" name="service_type" value={serviceType} />
          <input type="hidden" name="rows" value={JSON.stringify(rows)} />
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-gold px-3 py-1.5 text-sm font-medium text-navy hover:bg-gold-2 disabled:opacity-50"
          >
            {saving ? t.common.saving : ts.save}
          </button>
          {saveState.ok ? (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <CheckCircle size={14} weight="fill" />
              {ts.saved}
            </span>
          ) : null}
        </form>

        <form
          action={resetAction}
          onSubmit={(e) => {
            if (!window.confirm(ts.resetConfirm)) e.preventDefault()
          }}
          className="ml-auto"
        >
          <input type="hidden" name="service_type" value={serviceType} />
          <button
            type="submit"
            disabled={resetting}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background disabled:opacity-50"
          >
            {ts.resetDefaults}
          </button>
        </form>
      </div>

      {saveState.error && !saveState.ok ? (
        <p className="mt-2 text-sm text-danger" role="alert">
          {errText(saveState.error)}
        </p>
      ) : null}
      {resetState.error ? (
        <p className="mt-2 text-sm text-danger" role="alert">
          {resetState.error}
        </p>
      ) : null}
    </div>
  )
}
